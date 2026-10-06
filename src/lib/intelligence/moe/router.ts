/**
 * Canonical MoE router.
 *
 * This module absorbs the two formerly duplicated implementations:
 *   - `src/lib/intelligence/moe-engine.ts` — capability/provider routing over live
 *     `IntelligenceProvider`s (the surface used by `intelligence/router.ts`).
 *   - `src/lib/intelligence/tri-hepta/tri-hepta-moe.ts` — numerically routed,
 *     TRI-HEPTA triangulated execution over `MoeExpertArtifact`s.
 *
 * Both former `createMoERoute`/`executeMoE` pairs live here as a single pair of
 * overloaded functions, so every legacy module can re-export the same function
 * object and no consumer ever observes two diverging implementations.
 *
 * Honest limits (unchanged from the originals):
 *   - `executeTriangulatedMoE` hardcodes `cacheHit = false`, so the HOT fast path
 *     is unreachable until a semantic cache lands.
 *   - Candidate agreement is lexical (token Jaccard), not embedding similarity.
 */

import { createHash } from "node:crypto";

import type { IntelligenceProvider, IntelligenceRequest, IntelligenceResponse } from "../contracts";
import type {
  ConsensusState,
  EvidenceLevel,
  ExecutionTemperature,
  FinalVerdict,
  InferenceCandidate,
  MoeExecutionResult,
  MoeExpertArtifact,
  MoeGateDecision,
  MoEExpert,
  MoEProviderDescriptor,
  MoeRouteOptions,
  MoeTrace,
  MoENumericRoute,
  MoERoute,
  MoERunResult,
  RiskLevel,
  TriangulationResult,
  TriHeptaExecutionResult,
  TriHeptaExecutor,
  TriHeptaOptions,
  TriHeptaPolicyDecision,
  TriHeptaRequest,
  VerificationCandidate,
} from "./contracts";

/* ============================================================================
 * Provider routing (legacy moe-engine.ts).
 * ========================================================================== */

function capabilityScore(expert: MoEExpert, request: IntelligenceRequest): number {
  const modality = request.modality ?? "text";
  return (
    (expert.capabilities.includes(modality) ? 0.35 : 0) +
    (request.preferredModel === expert.modelId ? 0.25 : 0) +
    Math.max(0, Math.min(expert.priority, 100)) / 1000
  );
}

function createProviderRoute(
  request: IntelligenceRequest,
  providers: ReadonlyMap<string, IntelligenceProvider>,
  descriptors: ReadonlyMap<string, MoEProviderDescriptor>,
  topK = 3,
): MoERoute {
  const experts = [...providers.entries()]
    .map(([modelId, provider]) => {
      const descriptor = descriptors.get(modelId);
      return {
        modelId,
        providerId: provider.providerId,
        capabilities: descriptor?.modalities ?? [...provider.capabilities],
        priority: descriptor?.productionApproved ? 100 : 0,
        productionApproved: descriptor?.productionApproved === true,
      };
    })
    .filter((expert) => descriptors.get(expert.modelId)?.enabled !== false)
    .sort(
      (a, b) =>
        capabilityScore(b, request) - capabilityScore(a, request) ||
        a.modelId.localeCompare(b.modelId),
    );
  return {
    requestId: request.requestId,
    selected: experts.slice(0, Math.max(1, Math.min(topK, 5))),
    topK: Math.max(1, Math.min(topK, 5)),
    strategy: "capability-weighted-top-k",
  };
}

function utility(response: IntelligenceResponse): number {
  const riskPenalty =
    response.risk === "CRITICAL"
      ? 1
      : response.risk === "HIGH"
        ? 0.5
        : response.risk === "MEDIUM"
          ? 0.2
          : 0;
  const degradationPenalty = response.degraded ? 0.35 : 0;
  const lengthSignal = Math.min(response.text.trim().length / 400, 1) * 0.15;
  return (
    1 -
    riskPenalty -
    degradationPenalty +
    lengthSignal -
    Math.min(response.latencyMs / 60000, 1) * 0.1
  );
}

async function executeProviderMoE(
  request: IntelligenceRequest,
  route: MoERoute,
  providers: ReadonlyMap<string, IntelligenceProvider>,
): Promise<MoERunResult> {
  const responses = (
    await Promise.all(
      route.selected.map(async (expert) => {
        const provider = providers.get(expert.modelId);
        if (!provider || !(await provider.health())) return null;
        try {
          return await provider.invoke(request);
        } catch {
          return null;
        }
      }),
    )
  ).filter((value): value is IntelligenceResponse => value !== null);
  if (!responses.length) throw new Error("moe_inference_unavailable:no_expert_succeeded");
  const selected = [...responses].sort(
    (a, b) => utility(b) - utility(a) || a.modelId.localeCompare(b.modelId),
  )[0];
  return { route, responses, selected, executedExpertCount: responses.length };
}

/* ============================================================================
 * Numeric routing (legacy tri-hepta-moe.ts).
 * ========================================================================== */

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

function createNumericRoute(
  experts: readonly MoeExpertArtifact[],
  options: MoeRouteOptions = {},
): MoENumericRoute {
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

async function executeNumericMoE(
  route: MoENumericRoute,
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

/** Snapshot of the artifacts behind a route; the caller may mutate the copy freely. */
export function listModels(route: MoENumericRoute): MoeExpertArtifact[] {
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

export async function executeTriangulatedMoE(
  route: MoENumericRoute,
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

/* ============================================================================
 * Unified public API — one createMoERoute / one executeMoE for both routes.
 * ========================================================================== */

type ProviderRouteArgs = [
  request: IntelligenceRequest,
  providers: ReadonlyMap<string, IntelligenceProvider>,
  descriptors: ReadonlyMap<string, MoEProviderDescriptor>,
  topK?: number,
];

type NumericRouteArgs = [experts: readonly MoeExpertArtifact[], options?: MoeRouteOptions];

type ProviderExecuteArgs = [
  request: IntelligenceRequest,
  route: MoERoute,
  providers: ReadonlyMap<string, IntelligenceProvider>,
];

type NumericExecuteArgs = [
  route: MoENumericRoute,
  input: readonly number[],
  logits: readonly number[],
];

function isProviderRouteArgs(
  args: ProviderRouteArgs | NumericRouteArgs,
): args is ProviderRouteArgs {
  return "messages" in args[0];
}

function isProviderExecuteArgs(
  args: ProviderExecuteArgs | NumericExecuteArgs,
): args is ProviderExecuteArgs {
  return "messages" in args[0];
}

export function createMoERoute(
  request: IntelligenceRequest,
  providers: ReadonlyMap<string, IntelligenceProvider>,
  descriptors: ReadonlyMap<string, MoEProviderDescriptor>,
  topK?: number,
): MoERoute;
export function createMoERoute(
  experts: readonly MoeExpertArtifact[],
  options?: MoeRouteOptions,
): MoENumericRoute;
export function createMoERoute(
  ...args: ProviderRouteArgs | NumericRouteArgs
): MoERoute | MoENumericRoute {
  if (isProviderRouteArgs(args)) {
    const [request, providers, descriptors, topK] = args;
    return createProviderRoute(request, providers, descriptors, topK);
  }
  const [experts, options] = args;
  return createNumericRoute(experts, options);
}

export function executeMoE(
  request: IntelligenceRequest,
  route: MoERoute,
  providers: ReadonlyMap<string, IntelligenceProvider>,
): Promise<MoERunResult>;
export function executeMoE(
  route: MoENumericRoute,
  input: readonly number[],
  logits: readonly number[],
): Promise<MoeExecutionResult>;
export function executeMoE(
  ...args: ProviderExecuteArgs | NumericExecuteArgs
): Promise<MoERunResult | MoeExecutionResult> {
  if (isProviderExecuteArgs(args)) {
    const [request, route, providers] = args;
    return executeProviderMoE(request, route, providers);
  }
  const [route, input, logits] = args;
  return executeNumericMoE(route, input, logits);
}
