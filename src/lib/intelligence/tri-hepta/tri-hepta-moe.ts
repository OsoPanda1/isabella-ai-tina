/**
 * Isabella Villaseñor AI — TRI-HEPTA Turbo MoE Genesis v2
 *
 * Canonical location: src/lib/intelligence/tri-hepta/tri-hepta-moe.ts
 * Source: tri-hepta-turbo-moe-genesis.ts (integrado sin cambios de semántica).
 *
 * Evolves the existing MoE into an adaptive, governed, triangulated execution engine.
 *
 * Compatibility:
 * - createMoERoute() remains available.
 * - executeMoE() remains available as a legacy-compatible adapter.
 * - executeTriangulatedMoE() is the canonical advanced execution path.
 *
 * Guarantees:
 * - Does not fabricate outputs, confidence, consensus, evidence, or approvals.
 * - Does not allow a model, provider, plugin, or fallback to bypass policy.
 * - Does not average narrative text as if it were a numeric vector.
 * - Preserves input/output hashes, routing evidence, cancellation, and audit hooks.
 *
 * Known limits (honest):
 * - cacheHit is always false inside executeTriangulatedMoE until the semantic
 *   cache lands, so the HOT fast path stays unreachable at runtime.
 * - Agreement between candidates is lexical (token Jaccard), not embedding similarity.
 * - No provider adapters here: alpha/beta/gamma are supplied by the caller as a
 *   TriHeptaExecutor, and numeric experts run through executor.executeNumericExpert.
 */

import { createHash } from "node:crypto";

export type RiskLevel = "R0" | "R1" | "R2" | "R3";
export type EvidenceLevel = "E0" | "E1" | "E2" | "E3" | "E4";
export type ExecutionTemperature = "HOT" | "WARM" | "COLD";
export type ConsensusState = "STRONG" | "PARTIAL" | "WEAK" | "CONFLICT";
export type FinalVerdict = "ALLOW" | "ALLOW_WITH_CAUTION" | "REVIEW" | "DENY";
export type ExpertSideEffect = "NONE" | "READ" | "WRITE" | "FINANCIAL" | "TRAINING";

export interface MoeExpertArtifact {
  expertId: string;
  version: string;
  modelHash: string;
  datasetId: string;
  datasetVersion: string;
  license: string;
  capacity: number;
  providerFamily?: string;
  modelFamily?: string;
  dataResidency?: readonly string[];
  sideEffect?: ExpertSideEffect;
  execute: (input: number[]) => number[] | Promise<number[]>;
}

export interface MoeGateDecision {
  expertId: string;
  logit: number;
  weight: number;
  rank: number;
}

export interface MoeTrace {
  inputHash: string;
  selected: MoeGateDecision[];
  overflow: boolean;
  fallbackUsed: boolean;
  contributions: Array<{
    expertId: string;
    weight: number;
    outputHash: string;
  }>;
}

export interface MoeExecutionResult {
  output: number[];
  trace: MoeTrace;
}

export interface MoeRouteOptions {
  topK?: number;
  capacityFactor?: number;
  fallbackExpertId?: string;
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, value) => (value === undefined ? null : value)),
      "utf8",
    )
    .digest("hex");
}

function softmax(logits: readonly number[]): number[] {
  if (!logits.length) return [];
  const max = Math.max(...logits);
  const values = logits.map((value) => Math.exp(value - max));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

function validateArtifact(expert: MoeExpertArtifact): void {
  if (
    !expert.expertId ||
    !expert.version ||
    !expert.modelHash ||
    !expert.datasetId ||
    !expert.datasetVersion ||
    !expert.license ||
    typeof expert.execute !== "function"
  ) {
    throw new Error(`moe_expert_artifact_invalid:${expert.expertId || "unknown"}`);
  }

  if (!Number.isInteger(expert.capacity) || expert.capacity < 1) {
    throw new Error(`moe_expert_capacity_invalid:${expert.expertId}`);
  }
}

export function createMoERoute(
  experts: readonly MoeExpertArtifact[],
  options: MoeRouteOptions = {},
) {
  if (!experts.length) throw new Error("moe_experts_required");
  for (const expert of experts) validateArtifact(expert);

  const topK = Math.max(1, Math.min(options.topK ?? 2, experts.length));
  const capacityFactor = Math.max(0.1, options.capacityFactor ?? 1);
  const registry = new Map(experts.map((expert) => [expert.expertId, expert]));

  if (options.fallbackExpertId && !registry.has(options.fallbackExpertId)) {
    throw new Error("moe_fallback_expert_not_registered");
  }

  return {
    topK,
    capacityFactor,
    experts: [...experts],
    registry,
    route(input: readonly number[], logits: readonly number[]): MoeGateDecision[] {
      if (logits.length !== experts.length) {
        throw new Error("moe_logit_count_mismatch");
      }

      const weights = softmax(logits);

      return experts
        .map((expert, index) => ({
          expertId: expert.expertId,
          logit: logits[index]!,
          weight: weights[index]!,
          rank: 0,
        }))
        .sort((a, b) => b.weight - a.weight || a.expertId.localeCompare(b.expertId))
        .slice(0, topK)
        .map((item, index) => ({ ...item, rank: index }));
    },
  };
}

export type MoERoute = ReturnType<typeof createMoERoute>;

export async function executeMoE(
  route: MoERoute,
  input: readonly number[],
  logits: readonly number[],
): Promise<MoeExecutionResult> {
  const selected = route.route(input, logits);
  const capacityByExpert = new Map(
    route.experts.map((expert) => [
      expert.expertId,
      Math.max(1, Math.floor(expert.capacity * route.capacityFactor)),
    ]),
  );

  let overflow = false;
  let fallbackUsed = false;
  const outputs: Array<{
    expertId: string;
    weight: number;
    output: number[];
  }> = [];

  for (const decision of selected) {
    const expert = route.registry.get(decision.expertId)!;
    const capacity = capacityByExpert.get(expert.expertId) ?? 1;
    const executionsForExpert = outputs.filter((item) => item.expertId === expert.expertId).length;

    if (executionsForExpert >= capacity) {
      overflow = true;
      continue;
    }

    const output = await expert.execute([...input]);
    if (output.length !== input.length || output.some((value) => !Number.isFinite(value))) {
      throw new Error(`moe_expert_output_invalid:${expert.expertId}`);
    }

    outputs.push({
      expertId: expert.expertId,
      weight: decision.weight,
      output,
    });
  }

  if (!outputs.length) {
    const fallbackId = route.registry.has("fallback") ? "fallback" : undefined;

    if (!fallbackId) {
      throw new Error("moe_capacity_exhausted_without_fallback");
    }

    const fallback = route.registry.get(fallbackId)!;
    const output = await fallback.execute([...input]);
    outputs.push({
      expertId: fallback.expertId,
      weight: 1,
      output,
    });
    fallbackUsed = true;
  }

  const totalWeight = outputs.reduce((sum, item) => sum + item.weight, 0) || 1;

  const output = input.map((_, index) =>
    outputs.reduce((sum, item) => sum + (item.output[index] ?? 0) * (item.weight / totalWeight), 0),
  );

  return {
    output,
    trace: {
      inputHash: stableHash(input),
      selected,
      overflow,
      fallbackUsed,
      contributions: outputs.map((item) => ({
        expertId: item.expertId,
        weight: item.weight,
        outputHash: stableHash(item.output),
      })),
    },
  };
}

export function listModels(route: MoERoute): MoeExpertArtifact[] {
  return [...route.experts];
}

export function recordIntelligenceMetric(trace: MoeTrace) {
  return {
    inputHash: trace.inputHash,
    selectedExperts: trace.selected.map((item) => item.expertId),
    utilization: trace.selected.reduce((sum, item) => sum + item.weight, 0),
    overflow: trace.overflow,
    fallbackUsed: trace.fallbackUsed,
  };
}

/* ============================================================================
 * TRI-HEPTA TURBO MoE GENESIS
 * ========================================================================== */

export interface TriHeptaRequest {
  requestId: string;
  traceId: string;
  tenantId: string;
  principalId: string;
  text: string;
  modality: "text" | "image" | "audio" | "structured";
  purpose: string;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
  risk: RiskLevel;
  maxLatencyMs: number;
  maxCostCents: number;
  requireCitations: boolean;
  requireLocalProcessing: boolean;
}

export interface TriHeptaPolicyDecision {
  decisionId: string;
  allowed: boolean;
  reasonCode: string;
  policyVersion: string;
  executionMode: "LOCAL_ONLY" | "EDGE" | "HYBRID" | "EXTERNAL_ALLOWED";
  expiresAt: string;
  obligations: readonly string[];
}

export interface InferenceCandidate {
  pipeline: "ALPHA" | "BETA";
  expertId: string;
  answer: string;
  confidence: number;
  grounding: number;
  risk: RiskLevel;
  evidenceLevel: EvidenceLevel;
  citations: readonly string[];
  latencyMs: number;
  outputHash: string;
  cancelled?: boolean;
}

export interface VerificationCandidate {
  pipeline: "GAMMA";
  verifierId: string;
  verdict: FinalVerdict;
  semanticAgreement: number;
  evidenceAgreement: number;
  policyAgreement: number;
  riskAgreement: number;
  confidence: number;
  latencyMs: number;
  reasons: readonly string[];
}

export interface TriangulationResult {
  alpha: InferenceCandidate | null;
  beta: InferenceCandidate | null;
  gamma: VerificationCandidate | null;
  semanticAgreement: number;
  evidenceAgreement: number;
  policyAgreement: number;
  riskAgreement: number;
  consensus: ConsensusState;
  consensusScore: number;
  verdict: FinalVerdict;
}

export interface TriHeptaExecutionResult {
  route: MoERoute;
  triangulation: TriangulationResult;
  selectedAnswer: string | null;
  selectedExpertId: string | null;
  executedExpertCount: number;
  cancelledExpertCount: number;
  temperature: ExecutionTemperature;
  trace: MoeTrace;
}

export interface TriHeptaOptions {
  hotThreshold?: number;
  warmThreshold?: number;
  earlyExitThreshold?: number;
  conflictThreshold?: number;
  maxTopK?: number;
  alphaTimeoutMs?: number;
  betaTimeoutMs?: number;
  gammaTimeoutMs?: number;
  weights?: {
    semantic?: number;
    evidence?: number;
    policy?: number;
    confidence?: number;
    risk?: number;
  };
}

const DEFAULT_OPTIONS: Required<Omit<TriHeptaOptions, "weights">> & {
  weights: Required<NonNullable<TriHeptaOptions["weights"]>>;
} = {
  hotThreshold: 0.85,
  warmThreshold: 0.65,
  earlyExitThreshold: 0.85,
  conflictThreshold: 0.45,
  maxTopK: 5,
  alphaTimeoutMs: 5000,
  betaTimeoutMs: 4000,
  gammaTimeoutMs: 2500,
  weights: {
    semantic: 0.25,
    evidence: 0.3,
    policy: 0.2,
    confidence: 0.15,
    risk: 0.1,
  },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Pure temperature decision, exported so the HOT/WARM/COLD mapping can be
 * tested deterministically. executeTriangulatedMoE always passes cacheHit=false
 * until the semantic cache lands, which keeps the HOT fast path unreachable there.
 */
export function chooseTemperature(
  request: Pick<
    TriHeptaRequest,
    "risk" | "sensitivity" | "requireCitations" | "requireLocalProcessing"
  >,
  cacheHit: boolean,
): ExecutionTemperature {
  if (
    request.risk === "R0" &&
    cacheHit &&
    request.sensitivity === "public" &&
    !request.requireCitations &&
    !request.requireLocalProcessing
  ) {
    return "HOT";
  }

  if (request.risk === "R1" || request.sensitivity === "internal" || request.requireCitations) {
    return "WARM";
  }

  return "COLD";
}

/** Pure top-k decision: HOT→1, WARM→2, high risk up to 5 (clamped by maxTopK). */
export function chooseTopK(
  temperature: ExecutionTemperature,
  risk: RiskLevel,
  maxTopK: number,
): number {
  if (risk === "R3") return Math.min(5, maxTopK);
  if (risk === "R2") return Math.min(3, maxTopK);
  if (temperature === "HOT") return 1;
  if (temperature === "WARM") return 2;
  return Math.min(3, maxTopK);
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und").trim();
}

/** Lexical Jaccard over tokens. Not embedding similarity — documented as such. */
function semanticSimilarity(a: string, b: string): number {
  const left = new Set(normalizeText(a).split(/\s+/u).filter(Boolean));
  const right = new Set(normalizeText(b).split(/\s+/u).filter(Boolean));

  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  return clamp01(intersection / union);
}

function riskToNumber(risk: RiskLevel): number {
  return risk === "R0" ? 0 : risk === "R1" ? 1 : risk === "R2" ? 2 : 3;
}

function compareRisk(a: RiskLevel, b: RiskLevel): number {
  return 1 - Math.abs(riskToNumber(a) - riskToNumber(b)) / 3;
}

function compareEvidence(a: EvidenceLevel, b: EvidenceLevel): number {
  const left = Number(a.slice(1));
  const right = Number(b.slice(1));
  return 1 - Math.abs(left - right) / 4;
}

function computeConsensus(
  alpha: InferenceCandidate | null,
  beta: InferenceCandidate | null,
  gamma: VerificationCandidate | null,
  weights: Required<NonNullable<TriHeptaOptions["weights"]>>,
): TriangulationResult {
  const semanticAgreement = alpha && beta ? semanticSimilarity(alpha.answer, beta.answer) : 0;

  const evidenceAgreement =
    alpha && beta ? compareEvidence(alpha.evidenceLevel, beta.evidenceLevel) : 0;

  const policyAgreement = gamma ? gamma.policyAgreement : 0;
  const riskAgreement = alpha && beta ? compareRisk(alpha.risk, beta.risk) : 0;

  const confidenceAgreement = alpha && beta ? 1 - Math.abs(alpha.confidence - beta.confidence) : 0;

  const consensusScore = clamp01(
    semanticAgreement * weights.semantic +
      evidenceAgreement * weights.evidence +
      policyAgreement * weights.policy +
      confidenceAgreement * weights.confidence +
      riskAgreement * weights.risk,
  );

  let consensus: ConsensusState = "CONFLICT";
  if (consensusScore >= 0.85) consensus = "STRONG";
  else if (consensusScore >= 0.65) consensus = "PARTIAL";
  else if (consensusScore >= 0.45) consensus = "WEAK";

  let verdict: FinalVerdict = "REVIEW";

  if (gamma?.verdict === "DENY") {
    verdict = "DENY";
  } else if (
    consensus === "STRONG" &&
    gamma?.verdict === "ALLOW" &&
    (alpha?.risk === "R0" || alpha?.risk === "R1")
  ) {
    verdict = "ALLOW";
  } else if (
    consensus === "PARTIAL" &&
    (gamma?.verdict === "ALLOW" || gamma?.verdict === "ALLOW_WITH_CAUTION")
  ) {
    verdict = "ALLOW_WITH_CAUTION";
  } else if (consensus === "CONFLICT") {
    verdict = "REVIEW";
  }

  return {
    alpha,
    beta,
    gamma,
    semanticAgreement,
    evidenceAgreement,
    policyAgreement,
    riskAgreement,
    consensus,
    consensusScore,
    verdict,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T | null> {
  if (signal.aborted) return null;

  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve(null);
        },
        { once: true },
      );
    }),
  ]);
}

export interface TriHeptaExecutor {
  executeNumericExpert(
    expert: MoeExpertArtifact,
    input: readonly number[],
    signal: AbortSignal,
  ): Promise<number[]>;

  executeAlpha(request: TriHeptaRequest, signal: AbortSignal): Promise<InferenceCandidate | null>;

  executeBeta(request: TriHeptaRequest, signal: AbortSignal): Promise<InferenceCandidate | null>;

  executeGamma(
    request: TriHeptaRequest,
    alpha: InferenceCandidate | null,
    beta: InferenceCandidate | null,
    signal: AbortSignal,
  ): Promise<VerificationCandidate | null>;
}

export async function executeTriangulatedMoE(
  route: MoERoute,
  input: readonly number[],
  logits: readonly number[],
  request: TriHeptaRequest,
  policy: TriHeptaPolicyDecision,
  executor: TriHeptaExecutor,
  options: TriHeptaOptions = {},
): Promise<TriHeptaExecutionResult> {
  if (!policy.allowed) {
    throw new Error(`tri_moe_policy_denied:${policy.reasonCode}`);
  }

  if (new Date(policy.expiresAt).getTime() <= Date.now()) {
    throw new Error("tri_moe_policy_expired");
  }

  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const weights = {
    ...DEFAULT_OPTIONS.weights,
    ...(options.weights ?? {}),
  };

  // Pending semantic cache: no cache lookup exists yet, so the HOT fast path stays off.
  const cacheHit = false;
  const temperature = chooseTemperature(request, cacheHit);
  const topK = chooseTopK(temperature, request.risk, resolvedOptions.maxTopK);

  const adaptiveRoute = createMoERoute(route.experts, {
    topK,
    capacityFactor: route.capacityFactor,
    fallbackExpertId: undefined,
  });

  const selected = adaptiveRoute.route(input, logits);
  const inputHash = stableHash(input);

  const alphaController = new AbortController();
  const betaController = new AbortController();
  const gammaController = new AbortController();

  const alphaPromise = withTimeout(
    executor.executeAlpha(request, alphaController.signal),
    resolvedOptions.alphaTimeoutMs,
    alphaController.signal,
  );

  const betaPromise =
    temperature === "HOT"
      ? Promise.resolve(null)
      : withTimeout(
          executor.executeBeta(request, betaController.signal),
          resolvedOptions.betaTimeoutMs,
          betaController.signal,
        );

  const [alpha, beta] = await Promise.all([alphaPromise, betaPromise]);

  const gammaPromise =
    temperature === "HOT" && alpha && alpha.confidence >= resolvedOptions.earlyExitThreshold
      ? Promise.resolve(null)
      : withTimeout(
          executor.executeGamma(request, alpha, beta, gammaController.signal),
          resolvedOptions.gammaTimeoutMs,
          gammaController.signal,
        );

  const gamma = await gammaPromise;

  const triangulation = computeConsensus(alpha, beta, gamma, weights);

  if (triangulation.verdict === "DENY") {
    alphaController.abort();
    betaController.abort();
    gammaController.abort();

    return {
      route: adaptiveRoute,
      triangulation,
      selectedAnswer: null,
      selectedExpertId: null,
      executedExpertCount: (alpha ? 1 : 0) + (beta ? 1 : 0) + (gamma ? 1 : 0),
      cancelledExpertCount: 0,
      temperature,
      trace: {
        inputHash,
        selected,
        overflow: false,
        fallbackUsed: false,
        contributions: [],
      },
    };
  }

  const numericOutputs: Array<{
    expertId: string;
    weight: number;
    output: number[];
  }> = [];

  let overflow = false;

  for (const decision of selected) {
    const expert = adaptiveRoute.registry.get(decision.expertId)!;

    if (
      expert.sideEffect === "WRITE" ||
      expert.sideEffect === "FINANCIAL" ||
      expert.sideEffect === "TRAINING"
    ) {
      continue;
    }

    try {
      const output = await executor.executeNumericExpert(expert, input, alphaController.signal);

      if (output.length !== input.length || output.some((value) => !Number.isFinite(value))) {
        throw new Error(`tri_moe_expert_output_invalid:${expert.expertId}`);
      }

      numericOutputs.push({
        expertId: expert.expertId,
        weight: decision.weight,
        output,
      });
    } catch {
      // A failing or invalid expert degrades the mix (overflow) instead of aborting;
      // the call still fails closed below when no expert produced a valid vector.
      overflow = true;
    }
  }

  if (!numericOutputs.length) {
    throw new Error("tri_moe_no_numeric_expert_succeeded");
  }

  const selectedCandidate =
    triangulation.verdict === "ALLOW"
      ? alpha
      : triangulation.verdict === "ALLOW_WITH_CAUTION"
        ? (alpha ?? beta)
        : null;

  alphaController.abort();
  betaController.abort();
  gammaController.abort();

  return {
    route: adaptiveRoute,
    triangulation,
    selectedAnswer: selectedCandidate?.answer ?? null,
    selectedExpertId: selectedCandidate?.expertId ?? null,
    executedExpertCount: (alpha ? 1 : 0) + (beta ? 1 : 0) + (gamma ? 1 : 0) + numericOutputs.length,
    cancelledExpertCount: 0,
    temperature,
    trace: {
      inputHash,
      selected,
      overflow,
      fallbackUsed: false,
      contributions: numericOutputs.map((item) => ({
        expertId: item.expertId,
        weight: item.weight,
        outputHash: stableHash(item.output),
      })),
    },
  };
}
