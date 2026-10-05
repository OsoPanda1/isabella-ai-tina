/**
 * COPILOT ML ENGINE — Fusion with Isabella Native Learning
 * ═════════════════════════════════════════════════════════════════════
 *
 * Integrates GitHub Copilot machine learning capabilities with Isabella's
 * native NCUA (Native Comprehension Unit Architecture) for hybrid inference.
 *
 * ARCHITECTURE:
 *   Copilot ML (Pattern Recognition, Code Understanding)
 *       ↓
 *   ML Fusion Layer (Normalization, Feature Extraction)
 *       ↓
 *   Isabella NCUA (Deterministic Classification, Decision Logic)
 *       ↓
 *   Decision Record (Audit Trail + Evidence)
 *
 * NOT REPLACEMENT: Copilot ML augments NCUA; does not replace governance.
 */

import { createHash } from "node:crypto";
import type { IsabellaPerception } from "../sovereign-types";

export interface CopilotMLSignal {
  modelName: string;
  inputHash: string;
  confidence: number; // 0.0 to 1.0
  classification: string;
  features: Record<string, number>; // extracted features
  timestamp: Date;
  riskScore: number; // -1.0 (safe) to 1.0 (risky)
}

export interface MLFusionResult {
  perception: IsabellaPerception;
  copilotSignal: CopilotMLSignal;
  ncuaSignal: NCUASignal;
  fusedConfidence: number;
  recommendation: "allow" | "requires_approval" | "deny";
  reasoning: string;
}

export interface NCUASignal {
  deterministic: boolean;
  categoryId: string;
  logic: string;
  confidence: number;
}

/**
 * Machine Learning Features extracted from input
 * Used by both Copilot and Isabella models
 */
export interface MLFeatures {
  inputLength: number;
  tokenCount: number;
  sentimentScore: number; // -1 negative, 0 neutral, 1 positive
  complexityScore: number; // 0 simple to 1 complex
  riskIndicators: string[]; // e.g., ['eval', 'process.env', 'database_access']
  entityTypes: string[]; // e.g., ['email', 'phone', 'api_key']
  intentCategory: string; // 'query', 'mutation', 'execution', 'financial'
}

/**
 * Normalizes Copilot ML output to Isabella canonical format
 */
export function normalizeCopilotSignal(raw: Record<string, unknown>): CopilotMLSignal {
  const inputHash = typeof raw.inputHash === "string" ? raw.inputHash : "";
  const confidence = Math.max(
    0,
    Math.min(1, typeof raw.confidence === "number" ? raw.confidence : 0.5),
  );
  const riskScore = Math.max(
    -1,
    Math.min(1, typeof raw.riskScore === "number" ? raw.riskScore : 0),
  );

  return {
    modelName: typeof raw.modelName === "string" ? raw.modelName : "copilot-v4.2.0-unnamed",
    inputHash,
    confidence,
    classification: String(raw.classification || "unclassified"),
    features: (raw.features as Record<string, number>) || {},
    timestamp: new Date(
      typeof raw.timestamp === "number" || typeof raw.timestamp === "string"
        ? raw.timestamp
        : Date.now(),
    ),
    riskScore,
  };
}

/**
 * Extracts machine learning features from Isabella perception
 */
export function extractMLFeatures(perception: IsabellaPerception): MLFeatures {
  const input = perception.input;
  const tokens = input.split(/\s+/).length;

  // Risk indicators (simple pattern matching)
  const riskPatterns =
    /eval\(|process\.env|crypto\.private|password|secret|api_key|delete from|drop table/gi;
  const riskIndicators = Array.from(input.match(riskPatterns) || []).map((m) => m.toLowerCase());

  // Entity detection (simplified)
  const emailPattern = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  const phonePattern = /\+?\d{1,3}[-.]?\d{3,4}[-.]?\d{4}/g;
  const entityTypes: string[] = [];
  if (emailPattern.test(input)) entityTypes.push("email");
  if (phonePattern.test(input)) entityTypes.push("phone");
  if (/api[_-]?key|token|secret/i.test(input)) entityTypes.push("api_key");

  // Intent classification (simple heuristic)
  let intentCategory = "query";
  if (/insert|update|delete|create|drop/i.test(input)) intentCategory = "mutation";
  if (/execute|run|eval|sandbox/i.test(input)) intentCategory = "execution";
  if (/payment|charge|refund|money|balance/i.test(input)) intentCategory = "financial";

  // Sentiment score (very basic)
  const negativeWords = /bad|error|fail|problem|issue|bug/gi;
  const positiveWords = /good|success|ok|fine|great/gi;
  const negCount = (input.match(negativeWords) || []).length;
  const posCount = (input.match(positiveWords) || []).length;
  const sentimentScore = (posCount - negCount) / Math.max(1, posCount + negCount);

  // Complexity score (based on length and structure)
  const complexity = Math.min(1, tokens / 100);

  return {
    inputLength: input.length,
    tokenCount: tokens,
    sentimentScore,
    complexityScore: complexity,
    riskIndicators,
    entityTypes,
    intentCategory,
  };
}

/**
 * Generates NCUA deterministic signal based on features and Isabella rules
 */
export function generateNCUASignal(features: MLFeatures): NCUASignal {
  // Deterministic rule-based classification (not ML)
  const riskLevel = features.riskIndicators.length;
  const hasHighRiskEntity =
    features.entityTypes.includes("api_key") || features.entityTypes.includes("secret");
  const isDangerousIntent = features.intentCategory === "execution";

  let categoryId = "safe";
  let confidence = 0.95;
  let logic = "no risk indicators detected";

  if (riskLevel > 0 || hasHighRiskEntity || isDangerousIntent) {
    categoryId = "requires_review";
    confidence = 0.8;
    logic = `${riskLevel} risk indicators, intent: ${features.intentCategory}`;
  }

  if (riskLevel > 2 || (hasHighRiskEntity && isDangerousIntent)) {
    categoryId = "deny";
    confidence = 0.9;
    logic = "multiple risk factors: " + features.riskIndicators.join(", ");
  }

  return {
    deterministic: true,
    categoryId,
    logic,
    confidence,
  };
}

/**
 * Fuses Copilot ML and Isabella NCUA signals into a governance decision
 */
export function fuseMLSignals(
  copilotSignal: CopilotMLSignal,
  ncuaSignal: NCUASignal,
): { recommendation: "allow" | "requires_approval" | "deny"; fusedConfidence: number } {
  // NCUA takes precedence (deterministic governance)
  if (ncuaSignal.categoryId === "deny") {
    return {
      recommendation: "deny",
      fusedConfidence: ncuaSignal.confidence,
    };
  }

  // Fuse signals: average confidence with NCUA weight (70%) > Copilot (30%)
  const fusedConfidence = ncuaSignal.confidence * 0.7 + copilotSignal.confidence * 0.3;

  if (ncuaSignal.categoryId === "requires_review") {
    return {
      recommendation: "requires_approval",
      fusedConfidence,
    };
  }

  // Default: allow with fused confidence
  return {
    recommendation: "allow",
    fusedConfidence,
  };
}

/**
 * Main ML Fusion pipeline
 */
export async function applyMLFusion(
  perception: IsabellaPerception,
  copilotSignal: CopilotMLSignal,
): Promise<MLFusionResult> {
  const features = extractMLFeatures(perception);
  const ncuaSignal = generateNCUASignal(features);
  const { recommendation, fusedConfidence } = fuseMLSignals(copilotSignal, ncuaSignal);

  const reasoning = `[ML-FUSION] Copilot: ${copilotSignal.confidence.toFixed(2)} (${copilotSignal.classification}) | NCUA: ${ncuaSignal.confidence.toFixed(2)} (${ncuaSignal.categoryId}) | Fused: ${fusedConfidence.toFixed(2)} → ${recommendation}`;

  return {
    perception,
    copilotSignal,
    ncuaSignal,
    fusedConfidence,
    recommendation,
    reasoning,
  };
}

/**
 * Computes input hash for Copilot ML cache/traceability
 */
export function computeInputHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
