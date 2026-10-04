/**
 * TINA adaptive router (src/lib/tina/router.ts)
 * Path rules align with AGENTS.md §12 (FAST/GROUNDED/AGENT/HUMAN_REVIEW).
 */
import { classifyWithGenesisTurbo, type GenesisResult } from "../native-ml/genesis-turbo";
import {
  normalizeComplexity,
  type TinaComplexityScore,
  type TinaExecutionPath,
  type TinaMode,
  type TinaRoute,
} from "./types";

export function chooseTinaPath(c: TinaComplexityScore): TinaExecutionPath {
  const s = normalizeComplexity(c);
  if (s.sensitivity >= 0.8 || s.legalImpact >= 0.7) return "HUMAN_REVIEW";
  if (s.financialRisk >= 0.7 || s.sideEffectRisk >= 0.7 || s.toolRequired) return "AGENT";
  if (s.currentInformationRequired || s.factualityRequired >= 0.55 || s.ambiguity >= 0.6) {
    return "GROUNDED";
  }
  return s.score <= 0.35 ? "FAST" : "GROUNDED";
}

export function modeForPath(path: TinaExecutionPath, c: TinaComplexityScore): TinaMode {
  const s = normalizeComplexity(c);
  switch (path) {
    case "FAST":
      return "reactive";
    case "AGENT":
      return "territorial";
    case "HUMAN_REVIEW":
      return "operational_self_model";
    case "GROUNDED":
    default:
      return s.factualityRequired >= 0.55 ? "limited_memory" : "generative";
  }
}

export async function classifyAndRouteTina(
  input: string,
  complexity: TinaComplexityScore,
): Promise<{ route: TinaRoute; genesis: GenesisResult }> {
  const genesis = await classifyWithGenesisTurbo(input);
  const route = routeTina({
    ...complexity,
    sensitivity: Math.max(complexity.sensitivity, genesis.riskScore),
  });
  return { route, genesis };
}

export function routeTina(c: TinaComplexityScore): TinaRoute {
  const path = chooseTinaPath(c);
  const mode = modeForPath(path, c);
  return {
    mode,
    path,
    requiresCrown: path !== "FAST",
    requiresAegis: true,
    requiresBookPI: true,
    requiresHumanReview: path === "HUMAN_REVIEW",
  };
}
