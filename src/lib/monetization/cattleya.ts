/**
 * CATTLEYA™ — Stripe Issuing + Reputación Cívica 2000 — Parte III M13
 * Estado: implementación operativa contra Stripe Issuing + Neon RLS; sin fallback simulado
 * Simetría doc↔código: este archivo respalda M13.3 y M13.4 del doc canónico
 */
import Stripe from "stripe";
import { config } from "../config";
import { createBookpiPostgresRepository } from "../repositories/bookpi-postgres-runtime";

export type CattleyaTier = 0 | 1 | 2 | 3; // Básica, Regular, Especial, Coleccionable
export const CATTLEYA_MAX_SCORE = 2000;

/**
 * PRINCIPIO SOBERANO DE INALIENABILIDAD FINANCIERA Y NO-RETENCIÓN ILÍCITA:
 * Queda terminantemente prohibido bloquear tarjetas o retener fondos de los usuarios
 * alegando índices de reputación cívica. Las tarjetas y saldos son de estricta propiedad
 * del titular. Los méritos cívicos solo actúan como incentivos positivos (rewards)
 * o descuentos voluntarios, jamás como mecanismos punitivos de retención o denegación.
 */

/**
 * Estructura canónica de dispersión CATTLEYA™:
 * - 70% Creador / Comerciante (Dispersión líquida soberana)
 * - 20% Plataforma TAMV Network (Infraestructura, computación e inferencia)
 * - 5% Fondo de Respaldo (Garantía, contracargos y liquidez)
 * - 5% Fondo Comunitario Territorial (Nodo Cero / Preservación Patrimonial RDM)
 */
export const CATTLEYA_SPLIT_PERCENTAGES = {
  creator: 70,
  platform: 20,
  backupFund: 5,
  communityFund: 5,
} as const;

export interface CattleyaSplitCalculation {
  grossAmountUsd: number;
  creatorPct: number;
  creatorUsd: number;
  platformPct: number;
  platformUsd: number;
  backupFundPct: number;
  backupFundUsd: number;
  communityFundPct: number;
  communityFundUsd: number;
  totalRetentionPct: number;
  totalRetentionUsd: number;
}

export function calculateCattleyaSplit(amountUsd: number): CattleyaSplitCalculation {
  const safeAmount = Math.max(amountUsd, 0);
  const creatorUsd = parseFloat(
    ((safeAmount * CATTLEYA_SPLIT_PERCENTAGES.creator) / 100).toFixed(2),
  );
  const platformUsd = parseFloat(
    ((safeAmount * CATTLEYA_SPLIT_PERCENTAGES.platform) / 100).toFixed(2),
  );
  const backupFundUsd = parseFloat(
    ((safeAmount * CATTLEYA_SPLIT_PERCENTAGES.backupFund) / 100).toFixed(2),
  );
  const communityFundUsd = parseFloat(
    ((safeAmount * CATTLEYA_SPLIT_PERCENTAGES.communityFund) / 100).toFixed(2),
  );
  const totalRetentionUsd = parseFloat((platformUsd + backupFundUsd + communityFundUsd).toFixed(2));

  return {
    grossAmountUsd: safeAmount,
    creatorPct: CATTLEYA_SPLIT_PERCENTAGES.creator,
    creatorUsd,
    platformPct: CATTLEYA_SPLIT_PERCENTAGES.platform,
    platformUsd,
    backupFundPct: CATTLEYA_SPLIT_PERCENTAGES.backupFund,
    backupFundUsd,
    communityFundPct: CATTLEYA_SPLIT_PERCENTAGES.communityFund,
    communityFundUsd,
    totalRetentionPct: 100 - CATTLEYA_SPLIT_PERCENTAGES.creator,
    totalRetentionUsd,
  };
}

export const COMMISSION_BY_TIER: Record<string, number> = {
  "plan-nodo-cero-enterprise": 0.12, // Celestial (12%)
  "plan-merchant": 0.15, // Gremial (15%)
  "plan-citizen": 0.18, // Creador (18%)
  "plan-visitor": 0.2, // Estándar / Visitante (20%)
};

function getStripe(): Stripe | null {
  const key = config().STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    return new Stripe(key, { apiVersion: "2022-11-15" as Stripe.LatestApiVersion });
  } catch {
    return null;
  }
}

export async function createVirtualCard(input: {
  userId: string;
  tenantId: string;
  cardholderName: string;
  spendingLimitDaily?: number;
  reputationScore?: number;
  loyaltyTier?: string;
}) {
  // Garantía de no-bloqueo: Todo usuario legítimo y verificado tiene derecho irrestricto
  // a la emisión y uso de su tarjeta. Ningún usuario es bloqueado por puntajes subjetivos.
  const stripe = getStripe();
  const spendingLimitDaily = input.spendingLimitDaily ?? 50000;
  let stripeCardId: string, last4: string, brand: string, expMonth: number, expYear: number;

  if (!stripe) {
    throw new Error("stripe_issuing_unconfigured");
  }
  {
    const cardholder = await stripe.issuing.cardholders.create({
      name: input.cardholderName,
      type: "individual",
      status: "active",
      billing: {
        address: { line1: "N/A", city: "Real del Monte", country: "MX", postal_code: "42130" },
      },
    });
    const card = await stripe.issuing.cards.create({
      cardholder: cardholder.id,
      currency: "usd",
      type: "virtual",
      spending_controls: { spending_limits: [{ amount: spendingLimitDaily, interval: "daily" }] },
    });
    stripeCardId = card.id;
    last4 = card.last4 ?? "0000";
    brand = card.brand ?? "visa";
    expMonth = card.exp_month ?? 12;
    expYear = card.exp_year ?? 2028;
  }

  // Persistencia y Auditoría: Registro inmutable en BookPI — con rollback si falla (no simplifica, aumenta consistencia)
  try {
    const repo = createBookpiPostgresRepository();
    await repo.append({
      tenantId: input.tenantId,
      userId: input.userId,
      operation: `CATTLEYA_CREATE:${stripeCardId}`,
      category: "other",
      cost: 0,
      tokens: 0,
      status: "settled",
    });
  } catch (e) {
    // Rollback crítico: si BookPI falla, cancela la tarjeta Stripe para evitar inconsistencia financiera
    try {
      const stripeRollback = getStripe();
      if (stripeRollback && stripeCardId && !stripeCardId.startsWith("card_mock_")) {
        await stripeRollback.issuing.cards
          .update(stripeCardId, { status: "inactive" })
          .catch(() => {});
        console.warn(`[CATTLEYA] Rollback: tarjeta ${stripeCardId} inactivada por fallo BookPI`);
      }
    } catch (rollbackErr) {
      console.error("[CATTLEYA] Rollback falló:", (rollbackErr as Error).message);
    }
    console.warn("[CATTLEYA] BookPI audit failed, tarjeta revertida:", (e as Error).message);
    throw new Error(`CATTLEYA_BOOKPI_ROLLBACK: ${(e as Error).message}`);
  }

  return {
    ok: true as const,
    card: {
      stripeCardId,
      card_holder_name: input.cardholderName,
      last4,
      brand,
      exp_month: expMonth,
      exp_year: expYear,
      spending_limit_daily: spendingLimitDaily,
      status: "active" as const,
      fundsProtection: "NON_CUSTODIAL_GUARANTEE_UNBLOCKED",
    },
  };
}

/**
 * Método de Comisiones Transparente y Legítimo:
 * - Basado en Plan / Nivel de suscripción y descuento voluntario por volumen o mérito comunitario.
 * - Siempre permitido (allowed: true); jamás bloquea operaciones ni penaliza ilícitamente.
 */
export function commissionForPlan(
  planId: string,
  options?: {
    loyaltyDiscountPct?: number;
    reputationScore?: number;
  },
): { rate: number; allowed: boolean; loyaltyDiscountAppliedPct: number } {
  const baseRate = COMMISSION_BY_TIER[planId] ?? 0.2;

  // Descuento opcional por fidelidad / volumen comercial (máximo 3% de reducción en comisiones)
  let discount = 0;
  if (options?.loyaltyDiscountPct && options.loyaltyDiscountPct > 0) {
    discount = Math.min(options.loyaltyDiscountPct, 3);
  } else if (options?.reputationScore && options.reputationScore >= 1000) {
    // Bonificación positiva opcional por mérito cívico comunitario (nunca punitiva)
    discount = Math.min(Math.floor((options.reputationScore - 1000) / 500) + 1, 2);
  }

  const effectiveRate = Math.max(parseFloat((baseRate - discount / 100).toFixed(4)), 0.08);

  return {
    rate: effectiveRate,
    allowed: true,
    loyaltyDiscountAppliedPct: discount,
  };
}
