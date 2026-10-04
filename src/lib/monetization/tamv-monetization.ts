/**
 * TAMV ONLINE NETWORK & NODO CERO — SOVEREIGN MONETIZATION ENGINE
 * ================================================================
 * Arquitectura unificada de monetización soberana inspirada en el
 * ecosistema de OsoPanda1 (Edwin Oswaldo Castillo Trejo / Anubis Villaseñor).
 *
 * Componentes unificados:
 * 1. CATTLEYA™ Virtual Cards (Stripe Issuing + Reputación Cívica >= 900)
 * 2. Comisiones soberanas escalonadas por Plan (Celestial 12%, Gremial 15%, Creador 18%, Visitante 25%)
 * 3. Pay-Per-Inference (Liquidación de microcréditos BookPI por cómputo de IA soberana)
 * 4. Proof-of-Preservation (Incentivos cívicos por preservación de memoria territorial y patrimonio minero)
 * 5. Sello de Origen RDM (Certificación de comercio justo para artesanos y pasteerías)
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import {
  CATTLEYA_MAX_SCORE,
  createVirtualCard,
  commissionForPlan,
  calculateCattleyaSplit,
} from "./cattleya";
import { createBookpiPostgresRepository } from "../repositories/bookpi-postgres-runtime";

export interface TamvSovereignPlan {
  id: string;
  name: string;
  tierName: "CELESTIAL" | "GREMIAL" | "CREADOR" | "VISITOR";
  commissionRatePct: number;
  monthlyFeeUsd: number;
  bookPiCreditsPerMonth: number;
  features: string[];
}

export const TAMV_SOVEREIGN_PLANS: Record<string, TamvSovereignPlan> = {
  "plan-nodo-cero-enterprise": {
    id: "plan-nodo-cero-enterprise",
    name: "Plan Nodo Cero Celestial Enterprise",
    tierName: "CELESTIAL",
    commissionRatePct: 12,
    monthlyFeeUsd: 149.0,
    bookPiCreditsPerMonth: 100000,
    features: [
      "Comisión mínima soberana (12%)",
      "Acceso ilimitado a CATTLEYA™ Stripe Issuing virtual y física",
      "Prioridad máxima en Doble Pipeline Hexagonal Turbo",
      "Gobernanza cívica directa en la Asamblea Comunitaria RDM",
      "Certificación automática de Denominación de Origen",
    ],
  },
  "plan-merchant": {
    id: "plan-merchant",
    name: "Plan Gremial de Comercio & Artesanos",
    tierName: "GREMIAL",
    commissionRatePct: 15,
    monthlyFeeUsd: 49.0,
    bookPiCreditsPerMonth: 25000,
    features: [
      "Comisión preferencial (15%)",
      "Sello de Autenticidad Territorial SELLO-RDM",
      "Tarjeta CATTLEYA virtual con límite diario configurable",
      "Integración de micropagos BookPI sin pasarelas extractivas",
    ],
  },
  "plan-citizen": {
    id: "plan-citizen",
    name: "Plan Ciudadano Creador Soberano",
    tierName: "CREADOR",
    commissionRatePct: 18,
    monthlyFeeUsd: 19.0,
    bookPiCreditsPerMonth: 8000,
    features: [
      "Comisión reducida (18%)",
      "Tarjeta CATTLEYA sujeta a reputación cívica (>=900 pts)",
      "Recompensas por Proof-of-Preservation patrimonial",
      "Voto deliberativo en propuestas cívicas de Nodo Cero",
    ],
  },
  "plan-visitor": {
    id: "plan-visitor",
    name: "Plan Visitante Libre (Explorador)",
    tierName: "VISITOR",
    commissionRatePct: 25,
    monthlyFeeUsd: 0.0,
    bookPiCreditsPerMonth: 500,
    features: [
      "Acceso libre al Gemelo Digital territorial",
      "Consultas asistidas por Isabella IA",
      "Tarifa estándar de plataforma (25%)",
    ],
  },
};

export const SettleInferenceSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  tokensUsed: z.number().int().positive(),
  costCredits: z.number().nonnegative(),
  model: z.string().min(1),
  requestId: z.string().min(1),
});

export const SettleCommerceSchema = z.object({
  tenantId: z.string().min(1),
  merchantId: z.string().min(1),
  amountUsd: z.number().positive(),
  planId: z.string().min(1),
  reputationScore: z.number().int().min(0).max(CATTLEYA_MAX_SCORE).optional(),
  loyaltyDiscountPct: z.number().min(0).max(5).optional(),
  orderRef: z.string().min(1),
  description: z.string().optional(),
});

export const ProofOfPreservationSchema = z.object({
  tenantId: z.string().min(1),
  contributorId: z.string().min(1),
  contributionType: z.enum([
    "HISTORICAL_MINING_DOCUMENT",
    "ORAL_HISTORY_AUDIO",
    "3D_PHOTOGRAMMETRY_SCAN",
    "BOTANICAL_ECOLOGICAL_SURVEY",
    "OPEN_SCIENCE_DATASET",
  ]),
  itemTitle: z.string().min(3),
  dataFingerprint: z.string().min(16),
  estimatedValueCredits: z.number().positive(),
});

export class TamvSovereignMonetizationEngine {
  /**
   * Obtiene la estructura del plan y calcula la retención y dispersión soberana.
   * Aplica el modelo transparente de comisiones por Plan y fidelidad/volumen,
   * garantizando el derecho inalienable de acceso a fondos (sin bloqueos punitivos).
   */
  public static calculateCommerceSettlement(input: z.infer<typeof SettleCommerceSchema>) {
    const plan = TAMV_SOVEREIGN_PLANS[input.planId] ?? TAMV_SOVEREIGN_PLANS["plan-visitor"];
    const commissionResult = commissionForPlan(input.planId, {
      loyaltyDiscountPct: input.loyaltyDiscountPct,
      reputationScore: input.reputationScore,
    });

    const commissionRate = commissionResult.rate;
    const platformFeeUsd = parseFloat((input.amountUsd * commissionRate).toFixed(2));
    const merchantNetUsd = parseFloat((input.amountUsd - platformFeeUsd).toFixed(2));

    // Desglose Canónico CATTLEYA™: 70% Creador, 20% Plataforma, 5% Fondo de Respaldo, 5% Territorial
    const cattleya = calculateCattleyaSplit(input.amountUsd);

    // Generar recibo criptográfico canónico
    const rawReceipt = `${input.tenantId}|${input.merchantId}|${input.amountUsd}|${platformFeeUsd}|${merchantNetUsd}|${cattleya.backupFundUsd}|${input.orderRef}|${Date.now()}`;
    const receiptHash = createHash("sha256").update(rawReceipt).digest("hex");

    return {
      planId: plan.id,
      planName: plan.name,
      grossAmountUsd: input.amountUsd,
      commissionRatePct: parseFloat((commissionRate * 100).toFixed(2)),
      platformFeeUsd,
      merchantNetUsd,
      loyaltyDiscountAppliedPct: commissionResult.loyaltyDiscountAppliedPct,
      cattleyaDistribution: {
        creatorPct: cattleya.creatorPct,
        creatorNetUsd: cattleya.creatorUsd,
        platformPct: cattleya.platformPct,
        platformFeeUsd: cattleya.platformUsd,
        backupFundPct: cattleya.backupFundPct,
        backupFundUsd: cattleya.backupFundUsd,
        communityFundPct: cattleya.communityFundPct,
        communityFundUsd: cattleya.communityFundUsd,
      },
      receiptHash,
      fundAccessProtected: true,
      nonCustodialGuarantee: "SOVEREIGN_NON_CUSTODIAL_FUNDS_GUARANTEED",
    };
  }

  /**
   * Calcula la liquidación canónica pura bajo el protocolo CATTLEYA™:
   * - 70% Creador
   * - 20% Plataforma
   * - 5% Fondo de Respaldo
   * - 5% Fondo Comunitario Territorial
   */
  public static calculateCattleyaSettlement(amountUsd: number) {
    return calculateCattleyaSplit(amountUsd);
  }

  /**
   * Registra una micro-liquidación por inferencia de IA en el ledger BookPI inmutable.
   */
  public static async recordInferenceSettlement(input: z.infer<typeof SettleInferenceSchema>) {
    const validated = SettleInferenceSchema.parse(input);
    const repo = createBookpiPostgresRepository();

    const entry = await repo.append({
      tenantId: validated.tenantId,
      userId: validated.userId,
      operation: `INFERENCE_CONSUMPTION:${validated.model}:${validated.requestId.slice(0, 8)}`,
      category: "other",
      cost: validated.costCredits,
      tokens: validated.tokensUsed,
      status: "settled",
    });
    if (!entry.success || !entry.block) throw new Error(entry.error ?? "BookPI append failed");

    return {
      ok: true,
      entryId: String(entry.block.index),
      merkleRoot: entry.block.blockHash,
      tokensUsed: validated.tokensUsed,
      costCredits: validated.costCredits,
      settledAt: entry.block.timestamp,
    };
  }

  /**
   * Otorga recompensas cívicas y créditos BookPI por aportes al patrimonio y ciencia abierta
   * (Proof-of-Preservation).
   */
  public static async awardProofOfPreservation(input: z.infer<typeof ProofOfPreservationSchema>) {
    const validated = ProofOfPreservationSchema.parse(input);
    const repo = createBookpiPostgresRepository();

    const entry = await repo.append({
      tenantId: validated.tenantId,
      userId: validated.contributorId,
      operation: `PROOF_OF_PRESERVATION_AWARD:${validated.contributionType}:${validated.dataFingerprint.slice(0, 8)}`,
      category: "other",
      cost: validated.estimatedValueCredits, // Crédito positivo para el contribuyente
      tokens: 0,
      status: "settled",
    });
    if (!entry.success || !entry.block) throw new Error(entry.error ?? "BookPI append failed");

    return {
      ok: true,
      entryId: String(entry.block.index),
      merkleRoot: entry.block.blockHash,
      contributorId: validated.contributorId,
      creditsAwarded: validated.estimatedValueCredits,
      contributionType: validated.contributionType,
      itemTitle: validated.itemTitle,
      settledAt: entry.block.timestamp,
    };
  }

  /**
   * Consulta el catálogo de planes disponibles y características.
   */
  public static listPlans(): TamvSovereignPlan[] {
    return Object.values(TAMV_SOVEREIGN_PLANS);
  }

  /**
   * Emite una tarjeta CATTLEYA™ bajo estricta garantía de no-bloqueo ni retención indebida.
   */
  public static async issueCattleyaCard(input: {
    userId: string;
    tenantId: string;
    cardholderName: string;
    spendingLimitDaily?: number;
    reputationScore?: number;
    loyaltyTier?: string;
  }) {
    try {
      return await createVirtualCard(input);
    } catch (err) {
      if ((err as Error)?.message === "stripe_issuing_unconfigured") {
        return {
          ok: false as const,
          reason: "stripe_issuing_unconfigured",
        };
      }
      throw err;
    }
  }
}
