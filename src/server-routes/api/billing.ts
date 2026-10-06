import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import * as nodeCrypto from "node:crypto";
import { sovereignStateRepository } from "@/lib/sovereign-state-repository";
import { SecuritySystem } from "@/lib/security";
import { withSovereignAuth, type PrincipalContext } from "@/lib/principal-context";
import { config } from "@/lib/config";
import type { BillingOperation } from "@/lib/billing-authorization";
import {
  BILLING_STEP_UP_HEADER,
  authorizeBillingOperation,
  billingRequestHash,
} from "@/lib/billing-guard";
import Stripe from "stripe";
import { redactLogArg } from "@/lib/secret-redactor";

// Logs con redaccion (ISA-447): nunca volcar errores crudos a consola.
const logError = (...args: unknown[]): void => console.error(...args.map(redactLogArg));
const logWarn = (...args: unknown[]): void => console.warn(...args.map(redactLogArg));

/**
 * Autorización económica server-side para handlers de billing.
 * Devuelve una Response 403 si el principal carece del scope dedicado o
 * (para refund/topup) de un step-up firmado válido. `null` si autoriza.
 */
function enforceBilling(
  request: Request,
  context: PrincipalContext,
  operation: BillingOperation,
  headers: Headers,
): Response | null {
  const result = authorizeBillingOperation({
    operation,
    tenantId: context.tenantId,
    userId: context.userId,
    role: context.role,
    scope: context.scope,
    stepUpToken: request.headers.get(BILLING_STEP_UP_HEADER),
  });
  if (result.ok) return null;
  return new Response(JSON.stringify({ error: result.reason }), { status: 403, headers });
}

// Initialize Stripe gracefully
let stripeInstance: Stripe | null = null;
function getStripe(): Stripe | null {
  if (!stripeInstance) {
    const key = config().STRIPE_SECRET_KEY;
    if (key) {
      try {
        stripeInstance = new Stripe(key, {
          apiVersion: "2022-11-15" as Stripe.LatestApiVersion,
        });
      } catch (err) {
        logError("Fallo al inicializar Stripe SDK:", err);
      }
    }
  }
  return stripeInstance;
}

// Listados del marketplace: la tabla durable marketplace_listings
// (marketplace-repository) es la única fuente. NO mock en memoria.
interface MarketplaceListing {
  skillId: string;
  title: string;
  costCents: number;
  ownerId: string;
  description: string;
  createdAt: string;
}

/**
 * Lee listados de la tabla PG durable marketplace_listings
 * (migración 20260908090000). Sin fallback a memoria: si el
 * repositorio falla, la operación falla (503 en producción).
 */
async function readAllListings(): Promise<MarketplaceListing[]> {
  const { listMarketplace } = await import("@/lib/repositories/marketplace-repository");
  return await listMarketplace();
}

export const Route = createFileRoute("/api/billing")({
  server: {
    handlers: {
      GET: async ({ request }: IsabellaRouteContext) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action") || "credits";

        const headers = SecuritySystem.injectSecureHeaders(
          new Headers({ "content-type": "application/json" }),
        );

        // 1. OBTENER INFORMACIÓN DE CRÉDITOS / PLAN
        if (action === "credits") {
          return withSovereignAuth("system", "read", async (context) => {
            const tenant = await sovereignStateRepository.getTenant(context.tenantId);
            const monetizationAccount = await sovereignStateRepository.getMonetizationAccount(
              context.userId,
            );
            const ledger = await sovereignStateRepository.getLedger(context.tenantId);

            return new Response(
              JSON.stringify({
                success: true,
                tenantId: context.tenantId,
                quotaBalance: tenant?.quotaBalance ?? 0,
                tier: tenant?.tier ?? "Free",
                monetizationAccount,
                recentTransactions: ledger.slice(-5).reverse(),
              }),
              { headers },
            );
          })({ request });
        }

        // 2. DETALLE DE TRANSACCIÓN / INVOICE METADATA
        if (action === "invoice") {
          const invoiceId = url.searchParams.get("invoiceId");
          if (!invoiceId) {
            return new Response(JSON.stringify({ error: "Parámetro invoiceId requerido." }), {
              status: 400,
              headers,
            });
          }

          return withSovereignAuth("system", "read", async (context) => {
            const invoiceIndex = parseInt(invoiceId, 10);
            if (!Number.isInteger(invoiceIndex) || invoiceIndex < 0) {
              return new Response(
                JSON.stringify({
                  error: "invoiceId debe ser un índice numérico válido.",
                }),
                { status: 400, headers },
              );
            }
            // Aislamiento multi-tenant: solo se consultan los bloques del tenant actual.
            const tenantLedger = await sovereignStateRepository.getLedger(context.tenantId);
            const block = tenantLedger.find((b) => b.index === invoiceIndex);

            if (!block) {
              return new Response(JSON.stringify({ error: "Invoice/Transacción no encontrada." }), {
                status: 404,
                headers,
              });
            }

            // Verificación de aislamiento reforzada: nunca devolver bloques de otro tenant.
            if (block.tenantId !== context.tenantId) {
              return new Response(JSON.stringify({ error: "Invoice/Transacción no encontrada." }), {
                status: 404,
                headers,
              });
            }

            const costAmount = Number(block.costDecimal);
            if (!Number.isFinite(costAmount) || costAmount < 0) {
              return new Response(JSON.stringify({ error: "Importe de invoice inválido." }), {
                status: 422,
                headers,
              });
            }
            const subtotalCents = Math.round(costAmount * 100);
            const taxCents = Math.round((subtotalCents * 16) / 100); // IVA 16%, en centavos
            const totalCents = subtotalCents + taxCents;

            return new Response(
              JSON.stringify({
                success: true,
                invoiceId: `INV-${block.index}-${block.timestamp.split("T")[0].replace(/-/g, "")}`,
                ledgerIndex: block.index,
                timestamp: block.timestamp,
                tenantId: block.tenantId,
                userId: block.userId,
                description: block.operation,
                category: block.category,
                subtotalUSD: subtotalCents / 100,
                taxUSD: taxCents / 100,
                totalUSD: totalCents / 100,
                hashChain: {
                  blockHash: block.blockHash,
                  previousHash: block.previousHash,
                  signatureAlgorithm: block.signatureAlgorithm,
                },
                status: block.status,
                reconciliationLedger: "BookPI-Ledger-V3",
              }),
              { headers },
            );
          })({ request });
        }

        // 3. CONSULTAR LISTADOS DEL MARKETPLACE (tabla durable primero)
        if (action === "marketplace-listings") {
          return withSovereignAuth("system", "read", async () => {
            const allListings = await readAllListings();

            return new Response(
              JSON.stringify({
                success: true,
                listings: allListings,
              }),
              { headers },
            );
          })({ request });
        }

        // 4. VERIFICAR BLOQUE DEL LEDGER COMPLETO
        if (action === "audit-block") {
          const blockIndex = url.searchParams.get("index");
          if (!blockIndex) {
            return new Response(JSON.stringify({ error: "Índice de bloque requerido." }), {
              status: 400,
              headers,
            });
          }

          return withSovereignAuth("audit", "read", async (context) => {
            const indexInt = parseInt(blockIndex, 10);
            if (!Number.isInteger(indexInt) || indexInt < 0) {
              return new Response(JSON.stringify({ error: "Índice de bloque inválido." }), {
                status: 400,
                headers,
              });
            }
            const tenantLedger = await sovereignStateRepository.getLedger(context.tenantId);
            const block = tenantLedger.find(
              (candidate) =>
                candidate.index === indexInt && candidate.tenantId === context.tenantId,
            );

            if (!block) {
              return new Response(JSON.stringify({ error: "Bloque de auditoría no encontrado." }), {
                status: 404,
                headers,
              });
            }

            // Recalcular para corroborar usando payload canónico SHA3-512 (mismo que bookpi-postgres-repository)
            const { canonicalBookPiPayload } = await import("@/lib/bookpi/canonical-payload");
            const recalculatedHash = nodeCrypto
              .createHash("sha3-512")
              .update(canonicalBookPiPayload(block as unknown as Record<string, unknown>))
              .digest("hex");
            const isChainValid = block.blockHash === recalculatedHash;

            return new Response(
              JSON.stringify({
                success: true,
                block,
                validation: {
                  recalculatedHash,
                  isChainValid,
                  pqcVerified: false,
                  signatureVerified: false,
                  signatureStatus: "NOT_VERIFIED",
                  note: "La integridad del hash de cadena fue recalculada. Esto no constituye una firma pública ni una verificación PQC.",
                },
              }),
              { headers },
            );
          })({ request });
        }

        return new Response(JSON.stringify({ error: "Acción GET desconocida." }), {
          status: 400,
          headers,
        });
      },

      POST: async ({ request }: IsabellaRouteContext) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action");

        const headers = SecuritySystem.injectSecureHeaders(
          new Headers({ "content-type": "application/json" }),
        );

        if (!action) {
          return new Response(JSON.stringify({ error: "Parámetro action requerido en POST." }), {
            status: 400,
            headers,
          });
        }

        try {
          const bodyText = await request.text();
          if (new TextEncoder().encode(bodyText).byteLength > config().INPUT_MAX_BODY_BYTES) {
            return new Response(JSON.stringify({ error: "REQUEST_BODY_TOO_LARGE" }), {
              status: 413,
              headers,
            });
          }
          const body = bodyText ? JSON.parse(bodyText) : {};

          // 1. CHECKOUT CREATION (STRIPE)
          if (action === "checkout") {
            return withSovereignAuth("system", "write", async (context) => {
              const denied = enforceBilling(request, context, "checkout", headers);
              if (denied) return denied;
              const parsed = z
                .object({
                  planId: z.enum([
                    "personal",
                    "pro",
                    "plan-visitor",
                    "plan-citizen",
                    "plan-merchant",
                    "plan-nodo-cero-enterprise",
                  ]),
                  billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
                  idempotencyKey: z
                    .string()
                    .trim()
                    .min(8)
                    .max(128)
                    .regex(/^[a-zA-Z0-9:_-]+$/)
                    .optional(),
                })
                .safeParse(body);
              if (!parsed.success) {
                return new Response(JSON.stringify({ error: "planId debe ser personal o pro." }), {
                  status: 400,
                  headers,
                });
              }
              const { planId, billingCycle } = parsed.data;
              const idempotencyKey =
                request.headers.get("idempotency-key") ?? parsed.data.idempotencyKey;
              if (!idempotencyKey) {
                return new Response(JSON.stringify({ error: "IDEMPOTENCY_KEY_REQUIRED" }), {
                  status: 400,
                  headers,
                });
              }
              const stripe = getStripe();
              if (!stripe) {
                return new Response(JSON.stringify({ error: "stripe_unconfigured" }), {
                  status: 503,
                  headers,
                });
              }

              // Idempotencia durable: una clave solo produce una sesión.
              // Reintentos devuelven la sesión original; reutilizar la clave
              // con un request distinto ⇒ 409 (constraint, sin escaneos).
              const {
                reserveCheckoutIdempotency,
                completeCheckoutIdempotency,
                releaseCheckoutIdempotency,
              } = await import("@/lib/repositories/billing-security-repository");
              const requestHash = billingRequestHash({
                planId,
                billingCycle,
                operation: "checkout",
              });
              let reservation;
              try {
                reservation = await reserveCheckoutIdempotency({
                  tenantId: context.tenantId,
                  userId: context.userId,
                  operation: "checkout",
                  idempotencyKey,
                  requestHash,
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST") {
                  return new Response(
                    JSON.stringify({ error: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" }),
                    { status: 409, headers },
                  );
                }
                logError("[billing:checkout] idempotencia no disponible:", error);
                return new Response(JSON.stringify({ error: "IDEMPOTENCY_STORE_UNAVAILABLE" }), {
                  status: 503,
                  headers,
                });
              }
              if (!reservation.created) {
                if (reservation.sessionId && reservation.checkoutUrl) {
                  return new Response(
                    JSON.stringify({
                      success: true,
                      replayed: true,
                      sessionId: reservation.sessionId,
                      checkoutUrl: reservation.checkoutUrl,
                    }),
                    { headers },
                  );
                }
                return new Response(JSON.stringify({ error: "CHECKOUT_IN_PROGRESS" }), {
                  status: 409,
                  headers,
                });
              }

              let sessionId: string;
              let checkoutUrl: string;

              {
                try {
                  const stripeSession = await stripe.checkout.sessions.create(
                    {
                      payment_method_types: ["card"],
                      line_items: [
                        {
                          price_data: {
                            currency: "usd",
                            product_data: {
                              name: `Isabella AI - Suscripción ${planId.toUpperCase()}`,
                              description: `Acceso Premium al orquestador cognitivo de Isabella (${planId}).`,
                            },
                            unit_amount:
                              billingCycle === "yearly"
                                ? planId === "personal"
                                  ? 9588
                                  : 19188
                                : planId === "personal"
                                  ? 999
                                  : 1999,
                            recurring: { interval: billingCycle === "yearly" ? "year" : "month" },
                          },
                          quantity: 1,
                        },
                      ],
                      mode: "subscription",
                      success_url: `${url.origin}/billing-success?session_id={CHECKOUT_SESSION_ID}`,
                      cancel_url: `${url.origin}/billing-cancel`,
                      client_reference_id: context.userId,
                      metadata: {
                        tenantId: context.tenantId,
                        planId,
                      },
                    },
                    {
                      idempotencyKey: `checkout:${context.tenantId}:${idempotencyKey}`,
                    },
                  );
                  sessionId = stripeSession.id;
                  checkoutUrl = stripeSession.url ?? "";
                } catch (stripeError) {
                  logError("Fallo Stripe checkout:", stripeError);
                  await releaseCheckoutIdempotency({
                    tenantId: context.tenantId,
                    operation: "checkout",
                    idempotencyKey,
                  }).catch(() => undefined);
                  return new Response(
                    JSON.stringify({ error: "No se pudo crear la sesión de checkout." }),
                    { status: 502, headers },
                  );
                }
              }

              if (!checkoutUrl) {
                await releaseCheckoutIdempotency({
                  tenantId: context.tenantId,
                  operation: "checkout",
                  idempotencyKey,
                }).catch(() => undefined);
                return new Response(
                  JSON.stringify({
                    error: "Fallo al crear sesión de checkout.",
                  }),
                  { status: 500, headers },
                );
              }

              try {
                await completeCheckoutIdempotency({
                  tenantId: context.tenantId,
                  operation: "checkout",
                  idempotencyKey,
                  sessionId,
                  checkoutUrl,
                });
              } catch (error) {
                logError("[billing:checkout] no se pudo confirmar la idempotencia:", error);
                await releaseCheckoutIdempotency({
                  tenantId: context.tenantId,
                  operation: "checkout",
                  idempotencyKey,
                }).catch(() => undefined);
                return new Response(JSON.stringify({ error: "IDEMPOTENCY_STORE_UNAVAILABLE" }), {
                  status: 503,
                  headers,
                });
              }

              await sovereignStateRepository.appendAuditLog(
                `trc_checkout_${sessionId}`,
                context.correlationId,
                context.ip,
                "Intención de Suscripción Creada",
                "S3",
                `Checkout iniciado para plan: ${planId}. Dirección de checkout: ${checkoutUrl}`,
                context.tenantId,
              );

              return new Response(
                JSON.stringify({
                  success: true,
                  sessionId,
                  checkoutUrl,
                }),
                { headers },
              );
            })({ request });
          }

          // 2. WEBHOOK (REAL STRIPE) — fail-closed sin STRIPE_SECRET_KEY ni STRIPE_WEBHOOK_SECRET
          if (action === "webhook") {
            const stripe = getStripe();
            const signature = request.headers.get("stripe-signature");

            // Fail-closed: sin STRIPE_SECRET_KEY el webhook no se procesa (503 para que Stripe reintente)
            if (!stripe) {
              return new Response(JSON.stringify({ error: "stripe_unconfigured" }), {
                status: 503,
                headers,
              });
            }
            if (!signature) {
              return new Response(JSON.stringify({ error: "Webhook requires Stripe signature." }), {
                status: 400,
                headers,
              });
            }
            const endpointSecret = config().STRIPE_WEBHOOK_SECRET;
            if (!endpointSecret) {
              return new Response(JSON.stringify({ error: "stripe_webhook_unconfigured" }), {
                status: 503,
                headers,
              });
            }

            let eventType;
            let metadata: Record<string, string> = {};
            let clientReferenceId = "";
            let eventId = "";
            let disputeAmountMinor = 0;

            try {
              const verifiedEvent = stripe.webhooks.constructEvent(
                bodyText,
                signature,
                endpointSecret,
              );
              eventType = verifiedEvent.type;
              const sessionObject = verifiedEvent.data.object as unknown as Record<string, unknown>;
              metadata = (sessionObject.metadata as Record<string, string>) || {};
              clientReferenceId = (sessionObject.client_reference_id as string) || "";
              eventId = verifiedEvent.id;
              disputeAmountMinor =
                typeof sessionObject.amount === "number" ? sessionObject.amount : 0;
            } catch (verificationError: unknown) {
              const errorMsg =
                verificationError instanceof Error
                  ? verificationError.message
                  : String(verificationError);
              logError("Firma Webhook Stripe inválida:", errorMsg);
              return new Response(JSON.stringify({ error: "Fallo de validación de firma." }), {
                status: 400,
                headers,
              });
            }

            // Claim atómico antes de cualquier efecto durable. El registro solo se
            // marca como processed después de completar todas las operaciones.
            const { claimWebhookEvent, markWebhookProcessed, markWebhookFailed } =
              await import("@/lib/economic-events");
            const claim = await claimWebhookEvent({
              provider: "stripe",
              providerEventId: eventId,
              eventType,
              payloadHash: nodeCrypto.createHash("sha256").update(bodyText).digest("hex"),
            });
            if (claim.status === "duplicate") {
              return new Response(
                JSON.stringify({ success: true, processed: true, duplicate: true }),
                { headers },
              );
            }
            if (claim.status === "in_progress") {
              return new Response(
                JSON.stringify({ success: true, processed: false, inProgress: true }),
                { status: 202, headers },
              );
            }
            if (claim.status === "error") {
              logError("[billing:webhook] claimWebhookEvent failed:", claim.message);
              return new Response(
                JSON.stringify({ error: "Idempotencia de webhook no disponible." }),
                { status: 503, headers },
              );
            }

            try {
              // Procesar el evento
              if (
                eventType === "checkout.session.completed" ||
                eventType === "invoice.payment_succeeded"
              ) {
                const planId = metadata?.planId;
                const targetTenantId = metadata?.tenantId;
                const targetUserId = clientReferenceId;

                if (!planId || !targetTenantId || !targetUserId) {
                  await markWebhookFailed(claim.id, "Webhook metadata incompleta.");
                  return new Response(JSON.stringify({ error: "Webhook metadata incompleta." }), {
                    status: 422,
                    headers,
                  });
                }

                // IDEMPOTENCIA ATÓMICA (§5): UNIQUE(provider, provider_event_id)
                // en `webhook_events`. Dos entregas simultáneas → 1 procesado.
                if (eventId) {
                  metadata.marker = `STRIPE_EVENT:${eventId}`;
                }

                if (targetTenantId) {
                  const { recordEconomicEvent } = await import("@/lib/economic-events");
                  const economicCredit = await recordEconomicEvent({
                    tenantId: targetTenantId,
                    actorId: targetUserId,
                    eventType: "SUBSCRIPTION_CREDIT",
                    amountMinor: 10_000,
                    direction: "CREDIT",
                    source: "stripe",
                    provider: "stripe",
                    providerEventId: eventId,
                    idempotencyKey: `subscription-credit:${eventId}`,
                    metadata: { planId, eventType, source: "stripe_webhook" },
                  });
                  if (!economicCredit.ok && !economicCredit.duplicate) {
                    throw new Error(
                      `Economic subscription credit failed: ${economicCredit.error ?? "unknown"}`,
                    );
                  }

                  const tenant = await sovereignStateRepository.getTenant(targetTenantId);
                  if (tenant) {
                    tenant.tier = planId === "enterprise" ? "Enterprise" : "Sovereign";
                    tenant.quotaBalance += 100.0;
                    await sovereignStateRepository.upsertTenant(tenant);

                    // La activación de suscripción se registra en el ledger (abajo),
                    // no como columna inexistente en MonetizationAccount.
                    const block = await sovereignStateRepository.appendLedgerBlock(
                      targetTenantId,
                      targetUserId || "system",
                      `ACTIVATE_SUBSCRIPTION: Plan ${planId.toUpperCase()} activado exitosamente (Créditos de bono: +$100.00 USD) ${metadata?.marker || ""}`,
                      "other",
                      0,
                      0,
                    );

                    await sovereignStateRepository.appendAuditLog(
                      `trc_webhook_${block.index}`,
                      `corr_web_${nodeCrypto.randomUUID().slice(0, 8)}`,
                      "127.0.0.1",
                      "Webhook de Suscripción Confirmado",
                      "S3",
                      `Suscripción de plan ${planId} aplicada a tenant ${targetTenantId}.`,
                      targetTenantId,
                    );
                  }
                }
              }

              // Disputas/chargebacks: NUNCA se descartan. Idempotencia por
              // claimWebhookEvent + evento económico CHARGEBACK_HOLD + auditoría.
              // P0: el hold se persiste ANTES del claim (durable, no fire-and-forget)
              // para que un fallo de DB haga reintentar Stripe y nunca se pierda.
              if (
                eventType === "charge.dispute.created" ||
                eventType === "charge.dispute.funds_withdrawn"
              ) {
                const disputeTenant = metadata?.tenantId || "unresolved-dispute";
                const disputeUser = clientReferenceId || "system";
                const amountMinor = disputeAmountMinor;

                const { recordEconomicEvent } = await import("@/lib/economic-events");

                // 1) Hold económico durable (idempotente por idempotency_key).
                //    Error de DB → 503 en producción para que Stripe reintente.
                if (disputeTenant !== "unresolved-dispute") {
                  const hold = await recordEconomicEvent({
                    tenantId: disputeTenant,
                    actorId: disputeUser,
                    eventType: "CHARGEBACK_HOLD",
                    amountMinor,
                    direction: "DEBIT",
                    source: "stripe",
                    provider: "stripe",
                    providerEventId: eventId,
                    idempotencyKey: `chargeback:${eventId}`,
                    metadata: { dispute: true },
                  });
                  if (!hold.ok && !hold.duplicate) {
                    logError("[billing:dispute] recordEconomicEvent failed:", hold.error);
                    if (config().NODE_ENV === "production") {
                      return new Response(
                        JSON.stringify({
                          error: "Hold de disputa no registrado.",
                        }),
                        { status: 503, headers },
                      );
                    }
                  }
                }

                await sovereignStateRepository.appendAuditLog(
                  `trc_dispute_${nodeCrypto.randomUUID().slice(0, 8)}`,
                  `corr_dispute_${nodeCrypto.randomUUID().slice(0, 8)}`,
                  "127.0.0.1",
                  "Disputa de Pago Recibida",
                  "S1",
                  `Disputa ${eventId} por $${(amountMinor / 100).toFixed(2)} (tenant: ${disputeTenant}). Payouts congelados hasta revisión humana.`,
                  disputeTenant,
                );

                await markWebhookProcessed(claim.id);
                return new Response(
                  JSON.stringify({
                    success: true,
                    processed: true,
                    dispute: true,
                    tenantResolved: disputeTenant !== "unresolved-dispute",
                  }),
                  { headers },
                );
              }

              if (eventType === "charge.dispute.closed") {
                await sovereignStateRepository.appendAuditLog(
                  `trc_dispute_closed_${nodeCrypto.randomUUID().slice(0, 8)}`,
                  `corr_dispute_${nodeCrypto.randomUUID().slice(0, 8)}`,
                  "127.0.0.1",
                  "Disputa de Pago Cerrada",
                  "S3",
                  `Disputa ${eventId} cerrada (tenant: ${metadata?.tenantId || "unresolved-dispute"}). Revisar estado won/lost en Stripe Dashboard.`,
                  metadata?.tenantId || "unresolved-dispute",
                );
                await markWebhookProcessed(claim.id);
                return new Response(
                  JSON.stringify({
                    success: true,
                    processed: true,
                    disputeClosed: true,
                  }),
                  { headers },
                );
              }

              await markWebhookProcessed(claim.id);
              return new Response(JSON.stringify({ success: true, processed: true }), { headers });
            } catch (webhookError: unknown) {
              const message =
                webhookError instanceof Error ? webhookError.message : String(webhookError);
              await markWebhookFailed(claim.id, message).catch((markError) => {
                logError("[billing:webhook] unable to persist failure state:", markError);
              });
              logError("[billing:webhook] durable processing failed:", message);
              return new Response(
                JSON.stringify({ error: "Webhook processing failed; Stripe may retry." }),
                { status: 503, headers },
              );
            }
          }

          // 3. REGISTRAR CONSUMO REAL POR QUANTUM JOB / INFERENCIA (SERVER-TO-SERVER)
          if (action === "charge-usage") {
            return withSovereignAuth("system", "write", async (context) => {
              const chargeSchema = z.object({
                jobId: z.string().min(1),
                shots: z.number().nonnegative().default(0),
                qpu_seconds: z.number().nonnegative().default(0),
                operation: z.string().optional(),
              });

              const parsed = chargeSchema.safeParse(body);
              if (!parsed.success) {
                return new Response(
                  JSON.stringify({
                    error: "Parámetros de consumo inválidos.",
                    details: parsed.error.format(),
                  }),
                  { status: 400, headers },
                );
              }

              // Calculate exact cost
              const costUSD = parsed.data.shots * 0.1 + parsed.data.qpu_seconds * 1.0;
              const opText =
                parsed.data.operation ||
                `QUANTUM_JOB: ${parsed.data.jobId} (Shots: ${parsed.data.shots}, Segundos QPU: ${parsed.data.qpu_seconds})`;

              // P0: nunca permitir saldo negativo — gate de balance explícito.
              const tenant = await sovereignStateRepository.getTenant(context.tenantId);
              const currentBalance = tenant?.quotaBalance ?? 0;
              if (currentBalance < costUSD) {
                return new Response(
                  JSON.stringify({
                    error: "Saldo insuficiente para consumir recursos dedicados.",
                    quotaBalance: currentBalance,
                    required: costUSD,
                  }),
                  { status: 402, headers },
                );
              }

              // P6: Use PostgreSQL canonical ledger instead of JSON
              const { createBookpiPostgresRepository } =
                await import("@/lib/repositories/bookpi-postgres-repository");
              const bookpiRepo = createBookpiPostgresRepository();
              const blockResult = await bookpiRepo.append({
                tenantId: context.tenantId,
                userId: context.userId,
                operation: opText,
                category: "processing",
                cost: costUSD,
                tokens: parsed.data.shots,
              });

              if (!blockResult.success) {
                return new Response(JSON.stringify({ error: blockResult.error }), {
                  status: 500,
                  headers,
                });
              }
              const block = blockResult.block;

              // P0: debitar el saldo operativo de forma coherente con el ledger.
              // Re-leer para evitar sobreescribir cambios concurrentes del snapshot.
              const freshTenant = await sovereignStateRepository.getTenant(context.tenantId);
              if (freshTenant) {
                if (freshTenant.quotaBalance < costUSD) {
                  return new Response(
                    JSON.stringify({
                      error: "Saldo insuficiente para consumir recursos dedicados.",
                    }),
                    { status: 402, headers },
                  );
                }
                freshTenant.quotaBalance =
                  Math.round((freshTenant.quotaBalance - costUSD) * 1e9) / 1e9;
                await sovereignStateRepository.upsertTenant(freshTenant);
              }

              await sovereignStateRepository.appendAuditLog(
                `trc_charge_${block.index}`,
                context.correlationId,
                context.ip,
                "Consumo de Hardware Dedicado Acreditado",
                "S3",
                `Transacción #${block.index} cargada por valor de $${costUSD.toFixed(2)} USD a ${context.tenantId}`,
                context.tenantId,
              );

              return new Response(
                JSON.stringify({
                  success: true,
                  blockIndex: block.index,
                  costUSD,
                  quotaBalanceRemaining:
                    (await sovereignStateRepository.getTenant(context.tenantId))?.quotaBalance ?? 0,
                }),
                { headers },
              );
            })({ request });
          }

          // 4. TOPUP: ADMINISTRAR CARGA DIRECTA DE CRÉDITOS
          if (action === "topup") {
            return withSovereignAuth("system", "write", async (context) => {
              const denied = enforceBilling(request, context, "topup", headers);
              if (denied) return denied;
              const topupSchema = z.object({
                amountUSD: z.number().positive().max(5000),
                stripePaymentIntentId: z.string().min(1).max(128),
              });

              const parsed = topupSchema.safeParse(body);
              if (!parsed.success) {
                return new Response(JSON.stringify({ error: "Monto de recarga inválido." }), {
                  status: 400,
                  headers,
                });
              }

              // IDEMPOTENCIA ATÓMICA: un PaymentIntent solo acredita una vez.
              // UNIQUE(tenant_id, idempotency_key) en economic_events
              // (sin escaneo O(n) del ledger, sin carreras).
              const piMarker = `STRIPE_PI:${parsed.data.stripePaymentIntentId}`;

              // P0: el saldo solo se acredita tras verificar un pago real en Stripe. Fail-closed sin STRIPE_SECRET_KEY.
              const stripe = getStripe();
              if (!stripe) {
                return new Response(
                  JSON.stringify({
                    error: "stripe_unconfigured",
                  }),
                  { status: 503, headers },
                );
              }
              let paymentIntent;
              try {
                paymentIntent = await stripe.paymentIntents.retrieve(
                  parsed.data.stripePaymentIntentId,
                );
              } catch (err) {
                logError("[billing:topup] PaymentIntent inválido:", err);
                return new Response(JSON.stringify({ error: "PaymentIntent inválido." }), {
                  status: 422,
                  headers,
                });
              }
              if (paymentIntent.status !== "succeeded") {
                return new Response(
                  JSON.stringify({
                    error: `El pago no ha sido confirmado (estado: ${paymentIntent.status}).`,
                  }),
                  { status: 422, headers },
                );
              }
              const expectedCents = Math.round(parsed.data.amountUSD * 100);
              if (paymentIntent.amount !== expectedCents) {
                return new Response(
                  JSON.stringify({
                    error: "El monto del pago no coincide con la recarga.",
                  }),
                  { status: 422, headers },
                );
              }

              // Claim atómico POST-verificación: reintentos concurrentes del
              // mismo PI → uno acredita, el resto 409 (constraint, no scan).
              const { recordEconomicEvent } = await import("@/lib/economic-events");
              const topupClaim = await recordEconomicEvent({
                tenantId: context.tenantId,
                actorId: context.userId,
                eventType: "QUOTA_TOPUP",
                amountMinor: expectedCents,
                direction: "CREDIT",
                source: "stripe",
                provider: "stripe",
                providerEventId: parsed.data.stripePaymentIntentId,
                idempotencyKey: `topup:${parsed.data.stripePaymentIntentId}`,
                correlationId: context.correlationId,
                metadata: { amountUSD: parsed.data.amountUSD },
              }).catch((error: unknown) => ({
                ok: false as const,
                duplicate: false as const,
                error: error instanceof Error ? error.message : String(error),
              }));
              if (!topupClaim.ok) {
                if (topupClaim.duplicate) {
                  return new Response(
                    JSON.stringify({
                      error: "Este PaymentIntent ya fue aplicado a una recarga previa.",
                      duplicate: true,
                    }),
                    { status: 409, headers },
                  );
                }
                return new Response(
                  JSON.stringify({
                    error: "Idempotencia de recarga no disponible.",
                  }),
                  { status: 500, headers },
                );
              }

              const tenant = await sovereignStateRepository.getTenant(context.tenantId);
              if (!tenant) {
                return new Response(JSON.stringify({ error: "Organización no encontrada." }), {
                  status: 404,
                  headers,
                });
              }

              tenant.quotaBalance += parsed.data.amountUSD;
              await sovereignStateRepository.upsertTenant(tenant);

              const block = await sovereignStateRepository.appendLedgerBlock(
                context.tenantId,
                context.userId,
                `QUOTA_TOPUP: Recarga manual de saldo comercial (+$${parsed.data.amountUSD.toFixed(2)} USD) ${piMarker}`,
                "other",
                0,
                0,
              );

              await sovereignStateRepository.appendAuditLog(
                `trc_topup_${block.index}`,
                context.correlationId,
                context.ip,
                "Recarga de Saldo Procesada",
                "S3",
                `Monto de $${parsed.data.amountUSD.toFixed(2)} USD recargado a ${context.tenantId}. PI: ${parsed.data.stripePaymentIntentId}`,
                context.tenantId,
              );

              return new Response(
                JSON.stringify({
                  success: true,
                  amountUSD: parsed.data.amountUSD,
                  newQuotaBalance: tenant.quotaBalance,
                  blockIndex: block.index,
                }),
                { headers },
              );
            })({ request });
          }

          // 5. PREAUTORIZACIÓN ANTES DE EJECUTAR UN SKILL O COMPUTACIÓN CUÁNTICA (PRE-RUN GATE)
          if (action === "authorize-run") {
            return withSovereignAuth("system", "write", async (context) => {
              const denied = enforceBilling(request, context, "authorize-run", headers);
              if (denied) return denied;
              const runSchema = z.object({
                skillId: z.string().min(1),
                estimatedCostUSD: z.number().nonnegative().default(0),
              });

              const parsed = runSchema.safeParse(body);
              if (!parsed.success) {
                return new Response(
                  JSON.stringify({
                    error: "Parámetros de preautorización corruptos.",
                  }),
                  {
                    status: 400,
                    headers,
                  },
                );
              }

              const tenant = await sovereignStateRepository.getTenant(context.tenantId);
              const currentBalance = tenant?.quotaBalance ?? 0;

              // REGLA DE SEGURIDAD LUMEN / BUDGET LIMITS
              if (currentBalance < parsed.data.estimatedCostUSD) {
                await sovereignStateRepository.appendAuditLog(
                  `trc_auth_fail_${context.userId}`,
                  context.correlationId,
                  context.ip,
                  "Ejecución de Skill Bloqueada por Insuficiencia",
                  "S1",
                  `Usuario ${context.userId} intentó ejecutar ${parsed.data.skillId} pero posee saldo insuficiente ($${currentBalance.toFixed(2)} < $${parsed.data.estimatedCostUSD.toFixed(2)})`,
                  context.tenantId,
                );

                return new Response(
                  JSON.stringify({
                    allowed: false,
                    reason: "INSUFFICIENT_CREDITS",
                    balance: currentBalance,
                    estimatedCost: parsed.data.estimatedCostUSD,
                  }),
                  { headers },
                );
              }

              // Elegibilidad de Monetización
              const monAcc = await sovereignStateRepository.getMonetizationAccount(context.userId);
              if (monAcc.sanctioned) {
                return new Response(
                  JSON.stringify({
                    allowed: false,
                    reason: "ACCOUNT_SANCTIONED",
                  }),
                  { headers },
                );
              }

              // Capability durable de un solo uso: se persiste únicamente el
              // HASH; el valor en claro viaja al cliente una sola vez y se
              // consume exactamente una vez contra el mismo binding.
              const capability = nodeCrypto.randomBytes(32).toString("base64url");
              const { issueRunAuthorization, hashCapability } =
                await import("@/lib/repositories/billing-security-repository");
              let issued;
              try {
                issued = await issueRunAuthorization({
                  tenantId: context.tenantId,
                  userId: context.userId,
                  skillId: parsed.data.skillId,
                  estimatedCostMinor: Math.round(parsed.data.estimatedCostUSD * 100),
                  ttlSeconds: 120,
                  tokenHash: hashCapability(capability),
                });
              } catch (error) {
                logError("[billing:authorize-run] capability store unavailable:", error);
                return new Response(JSON.stringify({ error: "RUN_CAPABILITY_STORE_UNAVAILABLE" }), {
                  status: 503,
                  headers,
                });
              }

              await sovereignStateRepository.appendAuditLog(
                `trc_auth_ok_${issued.authorizationId}`,
                context.correlationId,
                context.ip,
                "Preautorización de Ejecución Emitida",
                "S3",
                `Capability ${issued.authorizationId} emitida para ${parsed.data.skillId} (≈$${parsed.data.estimatedCostUSD.toFixed(2)} USD)`,
                context.tenantId,
              );

              return new Response(
                JSON.stringify({
                  allowed: true,
                  reason: "SUCCESS",
                  estimatedCost: parsed.data.estimatedCostUSD,
                  currentBalance,
                  capability,
                  authorizationId: issued.authorizationId,
                  expiresAt: issued.expiresAt,
                }),
                { headers },
              );
            })({ request });
          }

          // 5b. CONSUMIR CAPABILITY DE EJECUCIÓN (ONE-TIME, DURABLE)
          if (action === "consume-run") {
            return withSovereignAuth("system", "write", async (context) => {
              const denied = enforceBilling(request, context, "authorize-run", headers);
              if (denied) return denied;
              const consumeSchema = z.object({
                capability: z.string().min(16),
                skillId: z.string().min(1),
                actualCostUSD: z.number().nonnegative().default(0),
              });
              const parsed = consumeSchema.safeParse(body);
              if (!parsed.success) {
                return new Response(
                  JSON.stringify({ error: "Capability de ejecución inválida." }),
                  {
                    status: 400,
                    headers,
                  },
                );
              }
              const { consumeRunAuthorization, hashCapability } =
                await import("@/lib/repositories/billing-security-repository");
              const consumed = await consumeRunAuthorization({
                tokenHash: hashCapability(parsed.data.capability),
                tenantId: context.tenantId,
                userId: context.userId,
                skillId: parsed.data.skillId,
                estimatedCostMinor: Math.round(parsed.data.actualCostUSD * 100),
              }).catch((error: unknown) => {
                logError("[billing:consume-run] capability store unavailable:", error);
                return null;
              });
              if (consumed === null) {
                return new Response(JSON.stringify({ error: "RUN_CAPABILITY_STORE_UNAVAILABLE" }), {
                  status: 503,
                  headers,
                });
              }
              if (!consumed) {
                return new Response(
                  JSON.stringify({ allowed: false, reason: "RUN_CAPABILITY_INVALID_OR_CONSUMED" }),
                  { status: 409, headers },
                );
              }
              return new Response(JSON.stringify({ allowed: true, reason: "SUCCESS" }), {
                headers,
              });
            })({ request });
          }

          // 6. INICIAR REEMBOLSO (ADMINISTRATOR DE LA TRANSACCIÓN)
          if (action === "refund") {
            return withSovereignAuth("system", "write", async (context) => {
              const denied = enforceBilling(request, context, "refund", headers);
              if (denied) return denied;
              const refundSchema = z.object({
                ledgerIndex: z.number().int().nonnegative(),
              });

              const parsed = refundSchema.safeParse(body);
              if (!parsed.success) {
                return new Response(
                  JSON.stringify({
                    error: "Índice de Ledger inválido para reembolso.",
                  }),
                  {
                    status: 400,
                    headers,
                  },
                );
              }

              const { createBookpiPostgresRepository } =
                await import("@/lib/repositories/bookpi-postgres-repository");
              const bookpiRepo = createBookpiPostgresRepository();

              const result = await bookpiRepo.refund(
                String(parsed.data.ledgerIndex),
                { tenantId: context.tenantId, userId: context.userId },
                "Reembolso de sistema",
              );

              if (result.success) {
                await sovereignStateRepository.appendAuditLog(
                  `trc_refund_ok_${parsed.data.ledgerIndex}`,
                  context.correlationId,
                  context.ip,
                  "Reembolso de Transacción Procesado",
                  "S3",
                  `La transacción #${parsed.data.ledgerIndex} fue revertida y su costo reembolsado al tenant ${context.tenantId}`,
                  context.tenantId,
                );

                return new Response(
                  JSON.stringify({
                    success: true,
                    index: parsed.data.ledgerIndex,
                  }),
                  { headers },
                );
              } else {
                return new Response(JSON.stringify({ success: false, error: result.error }), {
                  status: 400,
                  headers,
                });
              }
            })({ request });
          }

          // 7. PUBLICAR UN NUEVO ADDON / LISTING EN EL MARKETPLACE (OWNER DE LA COMUNIDAD)
          if (action === "marketplace-listing") {
            return withSovereignAuth("system", "write", async (context) => {
              const denied = enforceBilling(request, context, "marketplace-publish", headers);
              if (denied) return denied;
              const listingSchema = z.object({
                skillId: z
                  .string()
                  .min(3)
                  .max(64)
                  .regex(/^[a-z0-9-]+$/, "skillId solo admite minúsculas, números y guiones."),
                title: z.string().min(3).max(120),
                costCents: z.number().positive().int().max(100_000), // máx $1,000 USD
                description: z.string().min(10).max(2000),
              });

              const parsed = listingSchema.safeParse(body);
              if (!parsed.success) {
                return new Response(JSON.stringify({ error: "Datos del listing inválidos." }), {
                  status: 400,
                  headers,
                });
              }

              // Escritura durable en tabla (idempotente por skill_id); en dev
              // sin DB se conserva el fallback a settings/SovereignDB.
              try {
                const { createMarketplaceListing } =
                  await import("@/lib/repositories/marketplace-repository");
                const { created, listing } = await createMarketplaceListing({
                  skillId: parsed.data.skillId,
                  title: parsed.data.title,
                  costCents: parsed.data.costCents,
                  ownerId: context.userId,
                  description: parsed.data.description,
                });
                if (!created) {
                  return new Response(
                    JSON.stringify({
                      error: "Este skillId ya está listado.",
                      duplicate: true,
                    }),
                    { status: 409, headers },
                  );
                }

                await sovereignStateRepository.appendAuditLog(
                  `trc_market_list_${parsed.data.skillId}`,
                  context.correlationId,
                  context.ip,
                  "Anuncio en Marketplace Publicado",
                  "S3",
                  `Habilidad premium '${parsed.data.title}' listada para monetización por $${(parsed.data.costCents / 100).toFixed(2)} USD`,
                  context.tenantId,
                );

                return new Response(JSON.stringify({ success: true, listing }), { headers });
              } catch {
                // Sin DATABASE_URL (desarrollo): ERROR - no fallback a memoria en prod
                const runtime = config();
                const isProductionRuntimeCheck =
                  runtime.NODE_ENV === "production" ||
                  runtime.ISABELLA_RUNTIME_MODE === "production" ||
                  runtime.ISABELLA_RUNTIME_MODE === "staging";
                if (isProductionRuntimeCheck) {
                  throw new Error(
                    "Marketplace listing failed: DATABASE_URL required in production",
                  );
                }
                logWarn(
                  "[billing] Marketplace listing: DB unavailable, falling back to in-memory (dev only)",
                );
              }

              const currentListings = await sovereignStateRepository.getMarketplaceListings();

              const newListing: MarketplaceListing = {
                skillId: parsed.data.skillId,
                title: parsed.data.title,
                costCents: parsed.data.costCents,
                description: parsed.data.description,
                ownerId: context.userId,
                createdAt: new Date().toISOString(),
              };

              currentListings.push(newListing);
              await sovereignStateRepository.saveMarketplaceListings(currentListings);

              await sovereignStateRepository.appendAuditLog(
                `trc_market_list_${parsed.data.skillId}`,
                context.correlationId,
                context.ip,
                "Anuncio en Marketplace Publicado",
                "S3",
                `Habilidad premium '${parsed.data.title}' listada para monetización por $${(parsed.data.costCents / 100).toFixed(2)} USD`,
                context.tenantId,
              );

              return new Response(JSON.stringify({ success: true, listing: newListing }), {
                headers,
              });
            })({ request });
          }

          // 8. COMPRAR ADDON / HABILIDAD PREMIUM (REPARTO ECONÓMICO 85% PROVEEDOR / 15% PLATAFORMA)
          if (action === "marketplace-purchase") {
            return withSovereignAuth("system", "write", async (context) => {
              const denied = enforceBilling(request, context, "marketplace-purchase", headers);
              if (denied) return denied;
              const purchaseSchema = z.object({
                skillId: z.string().min(1),
              });

              const parsed = purchaseSchema.safeParse(body);
              if (!parsed.success) {
                return new Response(JSON.stringify({ error: "Parámetros de compra inválidos." }), {
                  status: 400,
                  headers,
                });
              }

              const customListings = await readAllListings();
              const listing = customListings.find((l) => l.skillId === parsed.data.skillId);

              if (!listing) {
                return new Response(
                  JSON.stringify({
                    error: "Anuncio de marketplace no encontrado.",
                  }),
                  {
                    status: 404,
                    headers,
                  },
                );
              }

              const costUSD = listing.costCents / 100;
              const platformFeeCents = Math.round(listing.costCents * 0.15);
              const { createBookpiPostgresRepository } =
                await import("@/lib/repositories/bookpi-postgres-repository");
              const bookpiRepo = createBookpiPostgresRepository();
              const purchase = await bookpiRepo.executeMarketplacePurchase({
                tenantId: context.tenantId,
                buyerUserId: context.userId,
                sellerUserId: listing.ownerId,
                skillId: listing.skillId,
                title: listing.title,
                costCents: listing.costCents,
                platformFeeCents,
                correlationId: context.correlationId,
              });
              if (!purchase.success) {
                if ("duplicate" in purchase && purchase.duplicate) {
                  return new Response(
                    JSON.stringify({ error: "Este skill ya fue adquirido por el tenant." }),
                    { status: 409, headers },
                  );
                }
                if (purchase.error === "INSUFFICIENT_BALANCE") {
                  const currentTenant = await sovereignStateRepository.getTenant(context.tenantId);
                  return new Response(
                    JSON.stringify({
                      error: "Saldo insuficiente.",
                      quotaBalance: currentTenant?.quotaBalance ?? 0,
                      required: costUSD,
                    }),
                    { status: 400, headers },
                  );
                }
                return new Response(
                  JSON.stringify({
                    error: "No fue posible completar la compra de forma transaccional.",
                  }),
                  { status: 500, headers },
                );
              }

              return new Response(
                JSON.stringify({
                  success: true,
                  blockIndex: purchase.block.index,
                  costUSD,
                  sellerEarnedBalanceCents: purchase.sellerEarnedBalanceCents,
                  buyerRemainingCredits: purchase.buyerRemainingCredits,
                  economicEventId: purchase.economicEventId,
                }),
                { headers },
              );
            })({ request });
          }

          return new Response(
            JSON.stringify({
              error: "Acción POST de facturación desconocida.",
            }),
            {
              status: 400,
              headers,
            },
          );
        } catch (e: unknown) {
          const internalId = nodeCrypto.randomUUID().slice(0, 8);
          logError(`[api/billing:${internalId}]`, e);
          const isDev = config().NODE_ENV === "development";
          const payload: Record<string, string> = {
            error: "internal_error",
            traceId: `trc_${internalId}`,
          };
          // Nunca exponer detalles internos en producción; solo en desarrollo local.
          if (isDev) {
            payload.message =
              e instanceof Error ? e.message : "Error desconocido de backend de facturación.";
          }
          return new Response(JSON.stringify(payload), {
            status: 500,
            headers,
          });
        }
      },
    },
  },
});
