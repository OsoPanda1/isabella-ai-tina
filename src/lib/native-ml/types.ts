/** Isabella Native ML — provider-agnostic governed contracts. Capability does not imply authority. */
export type MLTask = "classification" | "regression" | "clustering" | "anomaly";
export type ApprovalStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "REVOKED";
export interface DatasetIdentity {
  datasetId: string;
  version: string;
  territoryId: string;
  source: string;
  license: string;
  schemaHash: string;
  contentHash: string;
  createdAt: string;
}
export interface ModelIdentity {
  modelId: string;
  version: string;
  territoryId: string;
  ownerId: string;
  task: MLTask;
  algorithm: string;
  datasetIds: string[];
  modelHash: string;
  createdAt: string;
  approvalStatus: ApprovalStatus;
}
export interface ModelArtifact {
  weights: number[];
  bias: number;
  artifactHash: string;
}
export interface PredictionResult<T = unknown> {
  model: ModelIdentity;
  predictions: T[];
  confidence: number[] | null;
  explanation: Record<string, unknown>;
  riskScore: number;
  requiresReview: boolean;
  degraded: boolean;
  auditId?: string;
}
export interface TrainingResult {
  model: ModelIdentity;
  metrics: Record<string, number>;
  trainingHash: string;
  provenanceId: string;
  approvalRequired: boolean;
  artifact: ModelArtifact;
}
export interface NativeMLPolicyDecision {
  decision: "ALLOW" | "DENY" | "REVIEW";
  riskScore: number;
  policyIds: string[];
  reasons: string[];
}
export interface NativeMLHooks {
  authorize?: (input: {
    action: string;
    territoryId: string;
    modelId?: string;
  }) => Promise<NativeMLPolicyDecision> | NativeMLPolicyDecision;
  audit?: (
    event: string,
    payload: Record<string, unknown>,
  ) => Promise<string | void> | string | void;
}
export interface FederatedUpdate {
  updateId: string;
  nodeId: string;
  territoryId: string;
  modelId: string;
  baseModelVersion: string;
  deltaWeights: number[];
  deltaBias: number;
  sampleCount: number;
  metrics: { loss: number; accuracy?: number; fairness?: number };
  updateHash: string;
  signature: string;
  createdAt: string;
}
export interface FederatedRound {
  roundId: string;
  modelId: string;
  baseVersion: string;
  participants: string[];
  updateHashes: string[];
  aggregation: "FEDAVG";
  status: "VALIDATING" | "REJECTED" | "COMMITTED";
  nextVersion?: string;
}

/** Legacy lexical classifier contract retained for compatibility. */
export interface ClassifierResult {
  intent: string;
  confidence: number;
  tokens: string[];
  subIntents: string[];
}

/** Legacy route descriptor retained for compatibility with the native presentation layer. */
export interface ExpertRoute {
  expertId: string;
  name: string;
  weight: number;
  domain: string;
}

/** Legacy routing response retained for compatibility. */
export interface MoeRoutingDecision {
  selectedExperts: ExpertRoute[];
  routingConfidence: number;
  routingLatencyMs: number;
}
