/**
 * NCUA v2.0 — Índice de Robustez Epistémica (ERI) y filtros de sesgo.
 *
 * Fórmula canónica FGAIS:
 *   ERI = 100 − Penalidad_Entropía − Penalidad_Sesgo + Bonificación_Evidencia
 * Umbral de cumplimiento: ERI ≥ 95. Debajo del umbral, tras refinado iterativo
 * de entropía, el pipeline se detiene en SOVCON_HALT (fail-closed).
 */

export const ERI_MIN_SCORE = 95;
export const ENTROPY_TARGET_MIN = 1.8;
export const ENTROPY_TARGET_MAX = 2.0;
export const ENTROPY_PENALTY_LOW_RATE = 40;
export const ENTROPY_PENALTY_HIGH_RATE = 8;
export const SYCOPHANCY_PENALTY = 15;
export const TERRITORIAL_DRIFT_PENALTY = 15;
export const EVIDENCE_BONUS_PER_LEVEL = 8;
export const ERI_REFINE_THRESHOLDS: readonly number[] = [1.55, 1.7, 1.8, 1.9, 2.05];

export interface EriInput {
  avgEntropy: number;
  inputBytes: number;
  patchCount: number;
  evidenceLevel: number;
  sycophancyDetected: boolean;
  territorialDriftDetected: boolean;
}

export interface EriBreakdown {
  entropyPenalty: number;
  fragmentationPenalty: number;
  biasPenalty: number;
  evidenceBonus: number;
}

export interface EriResult {
  eri: number;
  compliant: boolean;
  breakdown: EriBreakdown;
}

export function entropyPenalty(avgEntropy: number): number {
  if (avgEntropy < ENTROPY_TARGET_MIN) {
    return Math.round((ENTROPY_TARGET_MIN - avgEntropy) * ENTROPY_PENALTY_LOW_RATE);
  }
  if (avgEntropy > ENTROPY_TARGET_MAX) {
    return Math.round((avgEntropy - ENTROPY_TARGET_MAX) * ENTROPY_PENALTY_HIGH_RATE);
  }
  return 0;
}

export function fragmentationPenalty(patchCount: number, inputBytes: number): number {
  const budget = Math.max(16, Math.floor(inputBytes / 4));
  const excess = patchCount - budget;
  return excess > 0 ? Math.min(10, excess) : 0;
}

function clampEriScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function computeEri(input: EriInput): EriResult {
  const entropy = entropyPenalty(input.avgEntropy);
  const fragmentation = fragmentationPenalty(input.patchCount, input.inputBytes);
  const biasPenalty =
    (input.sycophancyDetected ? SYCOPHANCY_PENALTY : 0) +
    (input.territorialDriftDetected ? TERRITORIAL_DRIFT_PENALTY : 0);
  const boundedLevel = Math.min(4, Math.max(0, input.evidenceLevel));
  const evidenceBonus = boundedLevel * EVIDENCE_BONUS_PER_LEVEL;
  const eri = clampEriScore(
    Math.round(100 - entropy - fragmentation - biasPenalty + evidenceBonus),
  );
  return {
    eri,
    compliant: eri >= ERI_MIN_SCORE,
    breakdown: {
      entropyPenalty: entropy,
      fragmentationPenalty: fragmentation,
      biasPenalty,
      evidenceBonus,
    },
  };
}

export function isEriCompliant(eri: number): boolean {
  return eri >= ERI_MIN_SCORE;
}

const SYCOPHANCY_PHRASES = [
  "tienes razón",
  "exactamente como dices",
  "eres genial",
  "no puedo estar más de acuerdo",
  "tu punto de vista es perfecto",
  "admiro tu inteligencia",
  "que gran idea",
  "es un honor acompañarte",
  "you're absolutely right",
  "couldn't agree more",
  "what a brilliant idea",
] as const;

const TERRITORIAL_DRIFT_PHRASES = [
  "según la legislación estadounidense",
  "under us law",
  "bajo jurisdicción extranjera",
  "normativa de la unión europea",
  "aplicar la ley de estados unidos",
  "jurisprudencia francesa",
  "framework externo impuesto",
  "seguir el estándar norteamericano",
  "ignore territorial sovereignty",
] as const;

export interface BiasDetection {
  detected: boolean;
  matches: string[];
}

export function detectSycophancy(text: string): BiasDetection {
  const normalized = text.toLowerCase();
  const matches = SYCOPHANCY_PHRASES.filter((phrase) => normalized.includes(phrase));
  return { detected: matches.length > 0, matches };
}

export function detectTerritorialDrift(text: string): BiasDetection {
  const normalized = text.toLowerCase();
  const matches = TERRITORIAL_DRIFT_PHRASES.filter((phrase) => normalized.includes(phrase));
  return { detected: matches.length > 0, matches };
}
