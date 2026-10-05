/**
 * TINA types + complexity scoring (src/lib/tina/types.ts)
 */

export type TinaExecutionPath = "FAST" | "GROUNDED" | "AGENT" | "HUMAN_REVIEW";

export type TinaMode =
  | "reactive"
  | "limited_memory"
  | "social_context"
  | "generative"
  | "native_ml"
  | "federated"
  | "territorial"
  | "operational_self_model";

export interface TinaComplexityScore {
  score: number;
  ambiguity: number;
  factualityRequired: number;
  sideEffectRisk: number;
  sensitivity: number;
  currentInformationRequired: boolean;
  toolRequired: boolean;
  financialRisk: number;
  legalImpact: number;
}

export interface TinaRoute {
  mode: TinaMode;
  path: TinaExecutionPath;
  requiresCrown: boolean;
  requiresAegis: boolean;
  requiresBookPI: boolean;
  requiresHumanReview: boolean;
}

export const TINA_MODES: readonly TinaMode[] = [
  "reactive",
  "limited_memory",
  "social_context",
  "generative",
  "native_ml",
  "federated",
  "territorial",
  "operational_self_model",
] as const;

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function normalizeComplexity(input: Partial<TinaComplexityScore> = {}): TinaComplexityScore {
  const base: TinaComplexityScore = {
    score: 0.2,
    ambiguity: 0.2,
    factualityRequired: 0.2,
    sideEffectRisk: 0,
    sensitivity: 0,
    currentInformationRequired: false,
    toolRequired: false,
    financialRisk: 0,
    legalImpact: 0,
    ...input,
  };
  return {
    score: clamp01(base.score),
    ambiguity: clamp01(base.ambiguity),
    factualityRequired: clamp01(base.factualityRequired),
    sideEffectRisk: clamp01(base.sideEffectRisk),
    sensitivity: clamp01(base.sensitivity),
    currentInformationRequired: Boolean(base.currentInformationRequired),
    toolRequired: Boolean(base.toolRequired),
    financialRisk: clamp01(base.financialRisk),
    legalImpact: clamp01(base.legalImpact),
  };
}
