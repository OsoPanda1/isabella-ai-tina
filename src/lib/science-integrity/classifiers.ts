/**
 * Science Integrity — Clasificadores ML nativos (B2)
 * -----------------------------------------------------------------
 * Señales ML REALES de Isabella sobre el documento científico:
 *  - `classifyTextRisk` (native-ml) → riesgo del texto.
 *  - Gates gobernados `governed-ml`: drift y fairness.
 *  - Heurísticas deterministas (NO son la API externa de similitud):
 *    `plagiarismSuspicion` (overlap de tokens local) y `citationCoverage`.
 *
 * Los gates gobernados son evidencia, nunca autoridad: un drift disparado
 * bloquea la promoción sin métricas de sesgo/equidad (v3.1).
 */
import { classifyTextRisk, type TextMLSignal } from "../native-ml/text-classifier";
import {
  auditFairness,
  detectDrift,
  type DriftReport,
  type FairnessReport,
} from "../native-ml/governed-ml";
import type { ArticleDomain, ScientificClaim } from "./contracts";

export const NATIVE_ML_SIGNALS_VERSION = "isabella.native-ml.v1";

export interface ScienceIntegrityMlSignals {
  textRisk: TextMLSignal;
  /** Overlap de tokens abstract ↔ artefactos; [0,1]. Heurística local, no servicio externo. */
  plagiarismSuspicion: number;
  /** Fracción de afirmaciones con al menos una fuente citada; [0,1]. */
  citationCoverage: number;
  drift: DriftReport;
  fairness: FairnessReport;
  modelId: string;
}

export interface NativeMlSignalsInput {
  abstract: string;
  claims: readonly ScientificClaim[];
  artifactContents: readonly string[];
  domains: readonly ArticleDomain[];
  /** Baseline histórico para el gate de drift (vacío por defecto = sin datos suficientes). */
  baseline?: readonly number[];
}

function tokenOverlapRatio(abstract: string, artifactContents: readonly string[]): number {
  const abstractTokens = new Set(
    abstract
      .toLocaleLowerCase("es-MX")
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]{4,}/gu) ?? [],
  );
  if (abstractTokens.size === 0) return 0;
  const artifactText = artifactContents.join(" ").toLocaleLowerCase("es-MX").normalize("NFKC");
  const artifactTokens = new Set(artifactText.match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  let overlap = 0;
  for (const token of abstractTokens) if (artifactTokens.has(token)) overlap += 1;
  return overlap / abstractTokens.size;
}

export function evaluateNativeMlSignals(input: NativeMlSignalsInput): ScienceIntegrityMlSignals {
  const textRisk = classifyTextRisk(
    `${input.abstract} ${input.claims.map((claim) => claim.assertion).join(" ")}`.slice(0, 32_000),
  );

  const perDomain = input.domains.length > 0 ? input.domains : (["academic"] as const);
  const domainScores = perDomain.map((domain) =>
    classifyTextRisk(`${input.abstract} ${domain}`).riskScore,
  );
  const drift = detectDrift(input.baseline ? [...input.baseline] : [], domainScores);
  const fairness = auditFairness(
    perDomain.map((domain, index) => ({
      group: domain,
      score: domainScores[index] ?? 0,
    })),
  );

  const claimedWithSources = input.claims.filter((claim) => claim.citedSources.length > 0).length;
  const citationCoverage = input.claims.length > 0 ? claimedWithSources / input.claims.length : 0;

  return {
    textRisk,
    plagiarismSuspicion: tokenOverlapRatio(input.abstract, input.artifactContents),
    citationCoverage,
    drift,
    fairness,
    modelId: textRisk.modelId,
  };
}