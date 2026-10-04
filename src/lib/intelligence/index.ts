import { config } from "@/lib/config";
import { GeminiProvider } from "./gemini-provider";
import { OllamaProvider } from "./ollama-provider";
import { OpenAICompatibleLocalProvider } from "./openai-compatible-provider";
import { registerFreeAIFederation } from "./free-ai-federation";
import { addProvider, invokeIntelligence, governIntelligence } from "./router";

let initialized = false;

export function initializeIntelligencePlane(): void {
  if (initialized) return;
  const runtime = config();
  const configured = runtime.LLM_DEFAULT_MODEL || "google/gemini-3.8-flash";
  const model = configured.split("/").at(-1) ?? "gemini-3.8-flash";

  // Registration is not authorization. Production approval must come from the durable governance registry.
  addProvider(new GeminiProvider(model), false);

  // Local/open-weight fallbacks are opt-in. They never become production-authorized merely by being reachable.
  if (runtime.OLLAMA_ENABLED) {
    addProvider(new OllamaProvider(), false);
  }
  if (runtime.OPENAI_COMPATIBLE_LOCAL_ENABLED) {
    addProvider(new OpenAICompatibleLocalProvider(), false);
  }

  // Registration is capability discovery only. Production authorization remains
  // in the model registry and the runtime gate; remote endpoints are opt-in.
  registerFreeAIFederation((provider) => addProvider(provider, false));
  initialized = true;
}

export { invokeIntelligence, governIntelligence };
export * from "./contracts";
export * from "./model-registry";
export * from "./free-ai-federation";

// TRI-HEPTA Turbo MoE — canonical surface only. The legacy helpers are re-exported
// under explicit aliases because their original names collide with ./moe-engine
// (createMoERoute, executeMoE, MoERoute), ./model-registry (listModels) and
// ./observability (recordIntelligenceMetric). The unaliased names live in
// ./tri-hepta; nothing here changes the existing MoE/router/runtime contracts.
export { executeTriangulatedMoE, chooseTemperature, chooseTopK } from "./tri-hepta";
export type {
  TriHeptaRequest,
  TriHeptaPolicyDecision,
  TriHeptaOptions,
  TriHeptaExecutor,
  TriHeptaExecutionResult,
  TriangulationResult,
  InferenceCandidate,
  VerificationCandidate,
  RiskLevel,
  EvidenceLevel,
  ExecutionTemperature,
  ConsensusState,
  FinalVerdict,
  ExpertSideEffect,
} from "./tri-hepta";
export {
  createMoERoute as createTriHeptaMoERoute,
  executeMoE as executeTriHeptaMoE,
  listModels as listTriHeptaModels,
  recordIntelligenceMetric as recordTriHeptaMetric,
} from "./tri-hepta";
export type {
  MoERoute as TriHeptaMoERoute,
  MoeExpertArtifact as TriHeptaMoeExpertArtifact,
  MoeGateDecision as TriHeptaMoeGateDecision,
  MoeTrace as TriHeptaMoeTrace,
  MoeExecutionResult as TriHeptaMoeExecutionResult,
  MoeRouteOptions as TriHeptaMoeRouteOptions,
} from "./tri-hepta";
