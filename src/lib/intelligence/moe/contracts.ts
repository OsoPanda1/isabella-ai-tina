import type { IntelligenceResponse, IntelligenceRisk, Modality } from "../contracts";

export type ExpertTemperature = "HOT" | "WARM" | "COLD";
export type EvidenceLevel = "E0" | "E1" | "E2" | "E3" | "E4";

export interface ExpertDescriptor {
  readonly expertId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly version: string;
  readonly capabilities: readonly Modality[];
  readonly temperature: ExpertTemperature;
  readonly enabled: boolean;
  readonly productionApproved: boolean;
  readonly riskCeiling: IntelligenceRisk;
  readonly priority: number;
}

export interface RoutingBudget {
  readonly topK: number;
  readonly maxLatencyMs: number;
  readonly maxExperts: number;
}

export interface RoutingRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly modality: Modality;
  readonly risk: IntelligenceRisk;
  readonly preferredModel?: string;
  readonly budget?: Partial<RoutingBudget>;
}

export interface RoutingDecision {
  readonly requestId: string;
  readonly selected: readonly ExpertDescriptor[];
  readonly strategy: "capability-risk-budgeted-top-k";
  readonly fallbackRequired: boolean;
  readonly reason: string;
}

export interface EvidenceCitation {
  readonly citationId: string;
  readonly sourceHash: string;
  readonly level: EvidenceLevel;
  readonly knowledgeVersion: string;
  readonly scope: string;
}

export interface MoETraceEvent {
  readonly eventType: "MOE_ROUTE_CREATED" | "MODEL_EXECUTED" | "MOE_AGGREGATED";
  readonly requestId: string;
  readonly tenantId: string;
  readonly auditId: string;
  readonly expertIds: readonly string[];
  readonly timestamp: string;
}

export function normalizeBudget(budget?: Partial<RoutingBudget>): RoutingBudget {
  return {
    topK: Math.max(1, Math.min(5, Math.floor(budget?.topK ?? 2))),
    maxLatencyMs: Math.max(50, Math.min(120_000, Math.floor(budget?.maxLatencyMs ?? 30_000))),
    maxExperts: Math.max(1, Math.min(5, Math.floor(budget?.maxExperts ?? 3))),
  };
}

export function riskRank(risk: IntelligenceRisk): number {
  return { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[risk];
}

export function stableAuditId(requestId: string, tenantId: string): string {
  let hash = 2166136261;
  for (const value of `${tenantId}:${requestId}`) {
    hash ^= value.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `moe-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function isExpertEligible(expert: ExpertDescriptor, request: RoutingRequest): boolean {
  return (
    expert.enabled &&
    expert.productionApproved &&
    expert.capabilities.includes(request.modality) &&
    riskRank(expert.riskCeiling) >= riskRank(request.risk)
  );
}

export function createTraceEvent(
  eventType: MoETraceEvent["eventType"],
  request: RoutingRequest,
  expertIds: readonly string[],
): MoETraceEvent {
  return {
    eventType,
    requestId: request.requestId,
    tenantId: request.tenantId,
    auditId: stableAuditId(request.requestId, request.tenantId),
    expertIds,
    timestamp: new Date().toISOString(),
  };
}

export function assertRoutingRequest(request: RoutingRequest): void {
  if (!request.requestId || !request.tenantId || !request.actorId)
    throw new Error("moe_request_identity_required");
}

export function assertEvidence(citation: EvidenceCitation): void {
  if (!citation.citationId || !citation.sourceHash || !citation.knowledgeVersion || !citation.scope)
    throw new Error("moe_evidence_invalid");
}

export interface AggregatedAnswer {
  readonly text: string;
  readonly confidence: number;
  readonly disagreement: boolean;
  readonly evidence: readonly EvidenceCitation[];
}

export interface ExpertAnswer {
  readonly expertId: string;
  readonly text: string;
  readonly confidence: number;
  readonly evidence?: readonly EvidenceCitation[];
}

export interface MoETelemetry {
  readonly requestId: string;
  readonly auditId: string;
  readonly selectedExperts: readonly string[];
  readonly latencyMs: number;
  readonly degraded: boolean;
  readonly disagreement: boolean;
}

export interface MoEFacade {
  route(request: RoutingRequest): RoutingDecision;
}

export interface ExpertRegistryLike {
  list(): readonly ExpertDescriptor[];
}

export interface RouterLike {
  route(request: RoutingRequest): RoutingDecision;
}

export interface EvidenceLike {
  validate(citations: readonly EvidenceCitation[]): void;
}

export interface AggregatorLike {
  aggregate(answers: readonly ExpertAnswer[]): AggregatedAnswer;
}

export interface TelemetryLike {
  record(event: MoETelemetry): void;
}

export interface MoEComponents {
  readonly registry: ExpertRegistryLike;
  readonly router: RouterLike;
  readonly evidence: EvidenceLike;
  readonly aggregator: AggregatorLike;
  readonly telemetry: TelemetryLike;
}

export const MOE_CONTRACT_VERSION = "moe-contracts-v1" as const;

export interface MoEContractManifest {
  readonly version: typeof MOE_CONTRACT_VERSION;
  readonly authority: "CROWN";
  readonly veto: "ARGUS";
  readonly evidence: "BookPI";
  readonly sideEffects: "forbidden-in-router";
}

export const MOE_CONTRACT_MANIFEST: MoEContractManifest = {
  version: MOE_CONTRACT_VERSION,
  authority: "CROWN",
  veto: "ARGUS",
  evidence: "BookPI",
  sideEffects: "forbidden-in-router",
};

/* ============================================================================
 * Provider-routed MoE (legacy src/lib/intelligence/moe-engine.ts surface).
 * ========================================================================== */

export interface MoEExpert {
  readonly modelId: string;
  readonly providerId: string;
  readonly capabilities: readonly string[];
  readonly priority: number;
  readonly productionApproved: boolean;
}

export interface MoERoute {
  requestId: string;
  selected: MoEExpert[];
  topK: number;
  strategy: "capability-weighted-top-k";
}

export interface MoERunResult {
  route: MoERoute;
  responses: IntelligenceResponse[];
  selected: IntelligenceResponse;
  executedExpertCount: number;
}

export interface MoEProviderDescriptor {
  modalities: readonly string[];
  enabled: boolean;
  productionApproved: boolean;
}

/* ============================================================================
 * Numerically routed MoE (legacy src/lib/intelligence/tri-hepta surface).
 * ========================================================================== */

export type RiskLevel = "R0" | "R1" | "R2" | "R3";
export type ConsensusState = "STRONG" | "PARTIAL" | "WEAK" | "CONFLICT";
export type FinalVerdict = "ALLOW" | "ALLOW_WITH_CAUTION" | "REVIEW" | "DENY";
export type ExpertSideEffect = "NONE" | "READ" | "WRITE" | "FINANCIAL" | "TRAINING";

/**
 * Same value set as `ExpertTemperature`; the TRI-HEPTA public surface keeps its
 * own name so the two call sites read in their own vocabulary.
 */
export type ExecutionTemperature = ExpertTemperature;

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

export interface MoENumericRoute {
  readonly topK: number;
  readonly capacityFactor: number;
  readonly experts: readonly MoeExpertArtifact[];
  readonly registry: ReadonlyMap<string, MoeExpertArtifact>;
  route(input: readonly number[], logits: readonly number[]): MoeGateDecision[];
}

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
  route: MoENumericRoute;
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
