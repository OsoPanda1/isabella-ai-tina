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
import type { Request, Response } from "express";
import Stripe from "stripe";
import { getSecret } from "../../lib/secrets";
import { fraudReviewEngine } from "../../lib/monetization/fraud-review";
import { executePayout } from "../../lib/monetization/payout-executor";
import { createBookpiPostgresRepository } from "../../lib/repositories/bookpi-postgres-runtime";

const stripeSecret = getSecret("STRIPE_SECRET_KEY");
const webhookSecret = getSecret("STRIPE_WEBHOOK_SECRET");
const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" as any });

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  let event: Stripe.Event;
  try {
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    res.status(400).json({ error: `Webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  const bookpiPostgresRepository = createBookpiPostgresRepository();

  // Handle verified events
  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await bookpiPostgresRepository.appendBlock({
        tenant_id: (paymentIntent.metadata?.tenant_id as string) || "default-tenant",
        user_id: (paymentIntent.metadata?.user_id as string) || "system",
        operation: "STRIPE_PAYMENT_SUCCEEDED",
        cost_decimal: paymentIntent.amount / 100,
        status: "CONFIRMED",
      });
      break;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      await bookpiPostgresRepository.appendBlock({
        tenant_id: "default-tenant",
        user_id: "system",
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

export async function handlePayoutRequest(req: Request, res: Response): Promise<void> {
  const { tenantId, userId, amountCents, destinationAccount } = req.body;
  if (!amountCents || amountCents <= 0) {
    res.status(400).json({ error: "Invalid payout amount" });
    return;
  }

  const fraudAssessment = await fraudReviewEngine.assessTransaction({
    tenantId: tenantId || "default-tenant",
    userId: userId || "user",
    amountCents,
  });

  if (fraudAssessment.action === "REJECT" || fraudAssessment.action === "HOLD") {
    res.status(403).json({
      error: "PAYOUT_FRAUD_HOLD",
      reason: fraudAssessment.reason,
      riskScore: fraudAssessment.riskScore,
    });
    return;
  }

  const payoutResult = await executePayout({
    tenantId: tenantId || "default-tenant",
    userId: userId || "user",
    amountCents,
    destinationAccount,
  });

  res.status(payoutResult.success ? 200 : 500).json(payoutResult);
}

export default { handleStripeWebhook, handlePayoutRequest };
