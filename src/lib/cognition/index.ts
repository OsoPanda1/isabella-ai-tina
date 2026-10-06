/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — DUAL HEXAGONAL KERNEL BARREL
 * ISABELLA-DHK-V1.0
 * Alpha: Perception, Context, Memory, Research, Hypothesis, Proposal
 * Beta: Identity, Classification, Risk, Policy, Capability, Verification
 * DualKernel: Orquesta Alpha → Beta pipeline
 * ================================================================
 */

/* Contracts */
export type {
  IsabellaDualRequest,
  IsabellaDualResponse,
  OperationState,
  RequestMode,
  ResponseStatus,
  CrownDecision,
  CrownDecisionResult,
  DataClassification,
  RiskLevel,
  Proposal,
  ProposalStatus,
  ProposalAlternative,
  ImplementationPlan,
  ImplementationStatus,
  Milestone,
  MonetizationHypothesis,
  MonetizationStatus,
  MonetizationModel,
  MonetizationScenarios,
  EvidenceRecord,
  ProvenanceRecord,
  TelemetryRecord,
  ToolCapability,
  QuantumEvidence,
} from "./contracts";

export { createRequestId, createTraceId } from "./contracts";

/* Alpha */
export { PerceptionEngine, perceptionEngine } from "./alpha/perception";
export type { PerceptionResult, IntentCategory, InputModality } from "./alpha/perception";

export { ContextBuilder, contextBuilder } from "./alpha/context";
export type { ContextFrame, SessionContext, TerritoryContext } from "./alpha/context";

export { AlphaMemory, alphaMemory } from "./alpha/memory";
export type { MemoryQuery, MemoryResult } from "./alpha/memory";

export { ResearchEngine, researchEngine } from "./alpha/research";
export type { ResearchQuery, ResearchResult, ResearchSynthesis, Claim } from "./alpha/research";

export { HypothesisEngine, hypothesisEngine } from "./alpha/hypothesis";
export type { Hypothesis } from "./alpha/hypothesis";

export { ProposalEngine, proposalEngine } from "./alpha/proposal";
export type { ProposalInput } from "./alpha/proposal";

/* Beta */
export { IdentityResolver, identityResolver } from "./beta/identity";
export type { IdentityContext, IdentityVerification, AssuranceLevel } from "./beta/identity";

export { ClassificationEngine, classificationEngine } from "./beta/classification";
export type { ClassificationResult } from "./beta/classification";

export { RiskEngine, riskEngine } from "./beta/risk";
export type { RiskAssessment } from "./beta/risk";

export { PolicyEngine, policyEngine } from "./beta/policy";
export type { PolicyContext } from "./beta/policy";

export { CapabilityRegistry, capabilityRegistry } from "./beta/capability";
export type { CapabilitySelection } from "./beta/capability";

export { VerificationEngine, verificationEngine } from "./beta/verification";
export type { VerificationResult, VerificationCheck } from "./beta/verification";

/* Dual Kernel */
export { DualKernel, dualKernel } from "./dual-kernel";
