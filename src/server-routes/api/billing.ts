/**
 * Billing Server Route (src/server-routes/api/billing.ts)
 * -------------------------------------------------------------
 * Canonical Billing & Monetization Route Handler:
 * - Stripe webhook signature verification with constructEvent
 * - Payout executor integration
 * - Fraud review scoring and hold enforcement
 * - Dispute and chargeback handling
 * - BookPI ledger event emission
 */
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import Stripe from "stripe";
import { SecuritySystem } from "../../lib/security";
import { getSecret } from "../../lib/secrets";
import { getTrustedClientIp } from "../../lib/trusted-client-ip";
import {
  assertPayoutAllowed,
  createFraudReviewQueue,
  evaluateWithdrawalRisk,
  type AuditSink,
} from "../../lib/monetization/fraud-review";
import { executePayout } from "../../lib/monetization/payout-executor";
import { createBookpiPostgresRepository } from "../../lib/repositories/bookpi-postgres-runtime";
import { recordObservabilityEvent } from "../../lib/telemetry/observability-repository";

const stripeSecret = getSecret("STRIPE_SECRET_KEY");
const webhookSecret = getSecret("STRIPE_WEBHOOK_SECRET");
const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" as never });

interface PayoutRequestBody {
  tenantId?: string;
  userId?: string;
  amountCents?: number;
  destinationAccount?: string;
  idempotencyKey?: string;
  reviewerIds?: string[];
}

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const rateLimit = SecuritySystem.checkRateLimit(getTrustedClientIp(req), 60);
  if (!rateLimit.allowed) {
    res.status(429).json({ received: false, error: "RATE_LIMIT_EXCEEDED" });
    return;
  }
  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  let event: Stripe.Event;
  try {
    const rawBodyCandidate = "rawBody" in req ? req.rawBody : undefined;
    const rawBody =
      rawBodyCandidate instanceof Buffer || typeof rawBodyCandidate === "string"
        ? rawBodyCandidate
        : JSON.stringify(req.body);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    res.status(400).json({
      error: `Webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const bookpiPostgresRepository = createBookpiPostgresRepository();

  // Handle verified events
  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      // Fail-closed con identidad de tenant: un evento sin metadata atribuible
      // no puede escribirse en un tenant genérico (contaminación de ledger).
      const tenantId = paymentIntent.metadata?.tenant_id?.trim();
      const userId = paymentIntent.metadata?.user_id?.trim();
      if (!tenantId || !userId) {
        res.status(422).json({
          received: false,
          error: "STRIPE_EVENT_MISSING_TENANT_IDENTITY",
          eventType: event.type,
        });
        return;
      }
      await bookpiPostgresRepository.appendBlock({
        tenant_id: tenantId,
        user_id: userId,
        operation: "STRIPE_PAYMENT_SUCCEEDED",
        cost_decimal: paymentIntent.amount / 100,
        status: "CONFIRMED",
      });
      break;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      // El tenant es obligatorio también en disputas; el user_id se conserva
      // como opcional (como en la rama) para no perder el registro de un
      // chargeback cuyo metadata de usuario no venga poblado.
      const tenantId = dispute.metadata?.tenant_id?.trim();
      const userId = dispute.metadata?.user_id?.trim() || "system";
      if (!tenantId) {
        res.status(422).json({
          received: false,
          error: "STRIPE_DISPUTE_MISSING_TENANT_IDENTITY",
          eventType: event.type,
        });
        return;
      }
      await bookpiPostgresRepository.appendBlock({
        tenant_id: tenantId,
        user_id: userId,
        operation: "CHARGE_DISPUTED",
        cost_decimal: dispute.amount / 100,
        status: "PENDING",
      });
      break;
    }
    default:
      break;
  }

  res.status(200).json({ received: true, eventType: event.type });
}

/**
 * Payout real: scoring de riesgo → guard de payout (auditoría durable) →
 * Stripe Transfers vía executePayout.
 *
 * Contrato de cuerpo: { tenantId?, userId?, amountCents, destinationAccount,
 * idempotencyKey?, reviewerIds? }. `idempotencyKey` se genera con randomUUID()
 * cuando el llamador no lo aporta (mismo criterio que WithdrawalService).
 */
export async function handlePayoutRequest(req: Request, res: Response): Promise<void> {
  const rateLimit = SecuritySystem.checkRateLimit(getTrustedClientIp(req), 20);
  if (!rateLimit.allowed) {
    res.status(429).json({ error: "RATE_LIMIT_EXCEEDED" });
    return;
  }
  const body = (req.body ?? {}) as PayoutRequestBody;
  const tenantId = body.tenantId || "default-tenant";
  const userId = body.userId || "user";
  const amountCents = body.amountCents;
  if (!amountCents || amountCents <= 0) {
    res.status(400).json({ error: "Invalid payout amount" });
    return;
  }
  const destinationAccount = body.destinationAccount;
  if (typeof destinationAccount !== "string" || destinationAccount.length === 0) {
    res.status(400).json({ error: "Invalid payout destination" });
    return;
  }
  const idempotencyKey = body.idempotencyKey ?? randomUUID();
  const reviewerIds: string[] = Array.isArray(body.reviewerIds) ? body.reviewerIds : [];

  // Audit sink del guard: cada transición se persiste en observability_events
  // (durable) y se confirma ANTES de responder o ejecutar el pago (§15).
  const auditTrail: Array<Promise<unknown>> = [];
  const audit: AuditSink = (event, details) => {
    auditTrail.push(
      recordObservabilityEvent({
        traceId: randomUUID(),
        eventType: event,
        source: "billing",
        payload: details,
      }),
    );
  };
  const flushAudit = async (): Promise<boolean> => {
    try {
      await Promise.all(auditTrail);
      return true;
    } catch {
      return false;
    }
  };
  const respond = async (status: number, payload: Record<string, unknown>): Promise<void> => {
    if (!(await flushAudit())) {
      res.status(500).json({ error: "AUDIT_PERSISTENCE_FAILED" });
      return;
    }
    res.status(status).json(payload);
  };

  // Esta ruta todavía no está cableada a `authenticate`/PrincipalContext, así
  // que no existe fuente server-side de identidad ni de historial de cuenta:
  // los hechos de riesgo se evalúan desconocidos (fail-closed) y jamás se
  // aceptan autoafirmados desde el cuerpo (§4.2: un allow local inventado no
  // es autorización). Con identidad no verificada el scoring resulta en hold.
  const risk = evaluateWithdrawalRisk({
    userId,
    amountCents,
    accountAgeDays: 0,
    withdrawalsLast24h: 0,
    failedAttemptsLast24h: 0,
    sanctioned: false,
    underFraudReview: false,
    identityVerified: false,
  });
  const queue = createFraudReviewQueue({ audit });
  queue.open(risk, userId, amountCents);

  if (risk.status !== "pass") {
    await respond(403, {
      error: "PAYOUT_FRAUD_HOLD",
      reason: risk.status === "fraud_detected" ? "FRAUD_DETECTED" : "RISK_HOLD",
      riskScore: risk.score,
      signals: risk.signals,
      reviewId: risk.reviewId,
    });
    return;
  }

  const authorization = assertPayoutAllowed(
    {
      userId,
      tenantId,
      amountCents,
      idempotencyKey,
      reviewId: risk.reviewId,
      reviewerIds,
    },
    queue,
    { audit },
  );
  if (!authorization.allowed) {
    await respond(403, { error: "PAYOUT_NOT_AUTHORIZED", reason: authorization.reason });
    return;
  }

  // Auditoría confirmada antes de mover dinero; sin persistencia no hay payout.
  if (!(await flushAudit())) {
    res.status(500).json({ error: "AUDIT_PERSISTENCE_FAILED" });
    return;
  }

  try {
    const payoutResult = await executePayout({
      amountCents,
      destinationAccountId: destinationAccount,
      idempotencyKey,
      metadata: { tenantId, userId },
    });
    res.status(200).json(payoutResult);
  } catch (err) {
    // executePayout lanza ante cualquier condición insegura y nunca devuelve
    // un fallo embebido: el contrato 200/500 se cumple con try/catch. Un
    // chequeo `status === "paid"` sería siempre false (un transfer recién
    // creado siempre queda "scheduled") y convertiría cada pago en 500.
    res.status(500).json({
      error: "PAYOUT_EXECUTION_FAILED",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

export default { handleStripeWebhook, handlePayoutRequest };
