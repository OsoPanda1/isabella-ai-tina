/**
 * TRI-HEPTA Turbo MoE — legacy module, now a thin re-export of the canonical
 * implementation at `src/lib/intelligence/moe/` (F2 unification).
 *
 * Every historic name is preserved verbatim: `createMoERoute`, `executeMoE`,
 * `executeTriangulatedMoE`, `chooseTemperature`, `chooseTopK`, `listModels`,
 * `recordIntelligenceMetric`, `MoERoute` (the numerically routed shape, now
 * exported canonically as `MoENumericRoute`) and the `TriHepta*` contracts.
 *
 * Guarantees inherited from the canonical module:
 * - Does not fabricate outputs, confidence, consensus, evidence, or approvals.
 * - Does not allow a model, provider, plugin, or fallback to bypass policy.
 * - Does not average narrative text as if it were a numeric vector.
 * - Preserves input/output hashes, routing evidence, cancellation, and audit hooks.
 */
export {
  chooseTemperature,
  chooseTopK,
  createMoERoute,
  executeMoE,
  executeTriangulatedMoE,
  listModels,
  recordIntelligenceMetric,
} from "../moe/router";
export type {
  ConsensusState,
  EvidenceLevel,
  ExecutionTemperature,
  ExpertSideEffect,
  FinalVerdict,
  InferenceCandidate,
  MoeExecutionResult,
  MoeExpertArtifact,
  MoeGateDecision,
  MoeRouteOptions,
  MoeTrace,
  MoENumericRoute as MoERoute,
  RiskLevel,
  TriangulationResult,
  TriHeptaExecutionResult,
  TriHeptaExecutor,
  TriHeptaOptions,
  TriHeptaPolicyDecision,
  TriHeptaRequest,
  VerificationCandidate,
} from "../moe/contracts";
