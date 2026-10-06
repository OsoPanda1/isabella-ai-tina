/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — DUAL HEXAGONAL KERNEL CONTRACTS
 * Contratos canónicos del motor cognitivo Alpha/Beta.
 * ISABELLA-DHK-V1.0
 * ================================================================
 */

import { randomUUID } from "node:crypto";

/* =========================================================================
   OPERATION STATES
   ========================================================================= */

export type OperationState =
  | "received"
  | "identified"
  | "classified"
  | "context_ready"
  | "alpha_processing"
  | "proposal_ready"
  | "beta_evaluating"
  | "approval_required"
  | "executing"
  | "verifying"
  | "implementation_ready"
  | "monetization_hypothesis"
  | "completed"
  | "degraded"
  | "rejected"
  | "cancelled"
  | "audited";

/* =========================================================================
   REQUEST / RESPONSE
   ========================================================================= */

export type RequestMode =
  "chat" | "assistant" | "research" | "edge" | "quantum" | "implementation" | "monetization";

export type ResponseStatus = "completed" | "review_required" | "degraded" | "rejected" | "async";

export interface IsabellaDualRequest {
  requestId: string;
  tenantId: string;
  actorId: string;
  sessionId?: string;
  federationId: number;
  intent: string;
  mode: RequestMode;
  context?: {
    projectId?: string;
    territory?: string;
    classification?: string;
    memoryEnabled?: boolean;
  };
  constraints?: {
    maxLatencyMs?: number;
    maxCostUsd?: number;
    maxSteps?: number;
    maxEnergyJoules?: number;
  };
  requestedCapabilities?: string[];
}

export interface IsabellaDualResponse {
  requestId: string;
  status: ResponseStatus;
  answer: string;
  proposal?: Proposal;
  implementation?: ImplementationPlan;
  monetization?: MonetizationHypothesis;
  governance: CrownDecision;
  evidence: EvidenceRecord[];
  provenance: ProvenanceRecord;
  telemetry: TelemetryRecord;
  state: OperationState;
  createdAt: string;
}

/* =========================================================================
   CROWN DECISION
   ========================================================================= */

export type CrownDecisionResult = "allow" | "deny" | "review" | "defer";

export interface CrownDecision {
  decisionId: string;
  result: CrownDecisionResult;
  riskLevel: RiskLevel;
  classification: DataClassification;
  policyIds: string[];
  reason: string;
  scopeDenials: string[];
  reviewRequired: boolean;
  reversible: boolean;
  evaluatedAt: string;
}

/* =========================================================================
   DATA CLASSIFICATION
   ========================================================================= */

export type DataClassification =
  "public" | "internal" | "private" | "sensitive" | "restricted" | "critical";

/* =========================================================================
   RISK LEVELS
   ========================================================================= */

export type RiskLevel = "R0_informational" | "R1_low" | "R2_moderate" | "R3_high" | "R4_critical";

/* =========================================================================
   PROPOSAL
   ========================================================================= */

export type ProposalStatus = "draft" | "review" | "approved";

export interface ProposalAlternative {
  name: string;
  cost: number;
  currency: string;
  risk: "low" | "medium" | "high";
  timeToFirstResult: string;
}

export interface Proposal {
  proposalId: string;
  title: string;
  problem: string;
  valueProposition: string;
  audience: string[];
  alternatives: ProposalAlternative[];
  assumptions: string[];
  uncertainties: string[];
  firstDeliverable: string;
  metrics: string[];
  status: ProposalStatus;
  createdAt: string;
}

/* =========================================================================
   IMPLEMENTATION PLAN
   ========================================================================= */

export type ImplementationStatus = "draft" | "approved" | "running" | "completed" | "blocked";

export interface Milestone {
  id: string;
  title: string;
  tasks: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
}

export interface ImplementationPlan {
  implementationId: string;
  proposalId: string;
  objective: string;
  firstDeliverable: string;
  included: string[];
  excluded: string[];
  milestones: Milestone[];
  resources: {
    tools: string[];
    people: string[];
    budget: number;
    currency: string;
  };
  risks: Array<{
    description: string;
    mitigation: string;
  }>;
  metrics: string[];
  status: ImplementationStatus;
  createdAt: string;
}

/* =========================================================================
   MONETIZATION
   ========================================================================= */

export type MonetizationStatus = "hypothesis" | "validated" | "approved";

export type MonetizationModel =
  | "product"
  | "service"
  | "subscription"
  | "membership"
  | "marketplace"
  | "license"
  | "affiliation"
  | "donation"
  | "reward";

export interface MonetizationScenarios {
  conservative: number;
  expected: number;
  optimistic: number;
}

export interface MonetizationHypothesis {
  monetizationId: string;
  implementationId: string;
  offer: string;
  audience: string[];
  channel: string[];
  pricing: {
    model: MonetizationModel;
    amount: number;
    currency: string;
  };
  assumptions: string[];
  scenarios: MonetizationScenarios;
  status: MonetizationStatus;
  createdAt: string;
}

/* =========================================================================
   EVIDENCE
   ========================================================================= */

export interface EvidenceRecord {
  evidenceId: string;
  type: "source" | "data" | "measurement" | "simulation" | "expert";
  claim: string;
  confidence: number;
  source: string;
  retrievedAt: string;
  expiresAt?: string;
}

/* =========================================================================
   PROVENANCE
   ========================================================================= */

export interface ProvenanceRecord {
  auditId: string;
  requestHash: string;
  outputHash: string;
  policyHash: string;
  modelHash?: string;
  datasetHash?: string;
  toolRefs: string[];
  memoryRefs: string[];
  createdAt: string;
}

/* =========================================================================
   TELEMETRY
   ========================================================================= */

export interface TelemetryRecord {
  traceId: string;
  alpha: {
    intentConfidence: number;
    memoryHitRate: number;
    retrievalRelevance: number;
    hypothesisCount: number;
    claimUncertainty: number;
    proposalGenerationMs: number;
  };
  beta: {
    policyAllowTotal: number;
    policyDenyTotal: number;
    reviewRequiredTotal: number;
    scopeDenialTotal: number;
    verificationFailureTotal: number;
    fallbackTotal: number;
  };
  runtime: {
    modelLatencyMs: number;
    queueLatencyMs: number;
    toolLatencyMs: number;
    edgeEnergy?: number;
    quantumShots?: number;
    quantumNoise?: number;
    costUsd: number;
  };
}

/* =========================================================================
   TOOL CAPABILITY
   ========================================================================= */

export interface ToolCapability {
  capabilityId: string;
  version: string;
  inputSchema: object;
  outputSchema: object;
  requiredScopes: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  networkAccess: "none" | "allowlist" | "restricted";
  reversible: boolean;
  timeoutMs: number;
}

/* =========================================================================
   QUANTUM EVIDENCE
   ========================================================================= */

export interface QuantumEvidence {
  circuitHash: string;
  backend: string;
  shots: number;
  seed?: number;
  noiseModel?: string;
  rawMeasurement: unknown;
  processedMeasurement: unknown;
  confidenceInterval?: [number, number];
  classicalBaseline?: number;
  status: "experimental" | "validated" | "rejected";
}

/* =========================================================================
   HELPERS
   ========================================================================= */

export function createRequestId(): string {
  return randomUUID();
}

export function createTraceId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 32);
}

/* =========================================================================
   MEMORY
   ========================================================================= */

export type MemoryScope = "immediate" | "session" | "project" | "territorial" | "historical";

export type SensitivityLevel = "public" | "internal" | "confidential" | "secret";
