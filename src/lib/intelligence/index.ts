import { config, type Env } from "@/lib/config";
import type { IntelligenceProvider } from "./contracts";
import { AnthropicProvider } from "./anthropic-provider";
import { BedrockProvider } from "./bedrock-provider";
import { GeminiProvider } from "./gemini-provider";
import { OllamaProvider } from "./ollama-provider";
import { OpenAICompatibleLocalProvider } from "./openai-compatible-provider";
import { registerFreeAIFederation } from "./free-ai-federation";
import { registerIsabellaTransports } from "./transports";
import { addProvider, invokeIntelligence, governIntelligence } from "./router";

let initialized = false;

/**
 * Fail-closed selection of the remote providers Isabella can speak.
 *
 * A provider is only constructed when its credentials AND an explicit model are
 * present in the validated runtime environment; a partial configuration yields
 * nothing. Registration is capability discovery — the production model gate
 * still has to authorize the model before it serves traffic.
 */
export type RemoteProviderEnv = Pick<
  Env,
  "ANTHROPIC_API_KEY" | "ANTHROPIC_MODEL" | "BEDROCK_ENABLED" | "BEDROCK_MODEL" | "BEDROCK_REGION"
>;

export function selectRemoteProviders(runtime: RemoteProviderEnv): IntelligenceProvider[] {
  const providers: IntelligenceProvider[] = [];
  if (runtime.ANTHROPIC_API_KEY && runtime.ANTHROPIC_MODEL) {
    providers.push(new AnthropicProvider(runtime.ANTHROPIC_MODEL));
  }
  if (runtime.BEDROCK_ENABLED && runtime.BEDROCK_MODEL && runtime.BEDROCK_REGION) {
    providers.push(new BedrockProvider(runtime.BEDROCK_MODEL, runtime.BEDROCK_REGION));
  }
  return providers;
}

export function initializeIntelligencePlane(): void {
  if (initialized) return;
  const runtime = config();
  const configured = runtime.LLM_DEFAULT_MODEL || "google/gemini-3.8-flash";
  const model = configured.split("/").at(-1) ?? "gemini-3.8-flash";

  // Data-path conversions for every apiMode Isabella can speak. Pure capability
  // discovery: no request is issued by registering a transport.
  registerIsabellaTransports();

  // Registration is not authorization. Production approval must come from the durable governance registry.
  addProvider(new GeminiProvider(model), false);

  // Local/open-weight fallbacks are opt-in. They never become production-authorized merely by being reachable.
  if (runtime.OLLAMA_ENABLED) {
    addProvider(new OllamaProvider(), false);
  }
  if (runtime.OPENAI_COMPATIBLE_LOCAL_ENABLED) {
    addProvider(new OpenAICompatibleLocalProvider(), false);
  }

  for (const provider of selectRemoteProviders(runtime)) {
    addProvider(provider, false);
  }

  // Registration is capability discovery only. Production authorization remains
  // in the model registry and the runtime gate; remote endpoints are opt-in.
  registerFreeAIFederation((provider) => addProvider(provider, false));
  initialized = true;
}

export { invokeIntelligence, governIntelligence };
export { AnthropicProvider } from "./anthropic-provider";
export { BedrockProvider } from "./bedrock-provider";
export {
  registerIsabellaTransports,
  AnthropicTransport,
  BedrockTransport,
  OpenAICompatibleTransport,
  ResponsesTransport,
  buildToolCall,
  registerTransport,
  getTransport,
  requireTransport,
  listTransportModes,
} from "./transports";
export * from "./contracts";
export * from "./model-registry";
export * from "./free-ai-federation";

// F2 — MoE unification: ./moe is now the single canonical implementation
// (contracts, expert registry, aggregator, policy gate, telemetry, router).
// ./moe-engine.ts and ./tri-hepta/* are thin re-export facades of it, so the two
// former MoE implementations no longer diverge. The only name that still exists
// twice in this barrel is `listModels` (model registry vs. MoE route artifacts),
// which is disambiguated explicitly below; every other MoE name is exported
// unaliased because it is now declared exactly once.
export * from "./moe";
export { listModels } from "./model-registry";
export { listModels as listMoeModels } from "./moe";

// Historical TriHepta* aliases kept for backward compatibility with callers that
// imported the pre-unification surface from this barrel.
export {
  createMoERoute as createTriHeptaMoERoute,
  executeMoE as executeTriHeptaMoE,
  listModels as listTriHeptaModels,
  recordIntelligenceMetric as recordTriHeptaMetric,
} from "./moe";
export type {
  MoENumericRoute as TriHeptaMoERoute,
  MoeExpertArtifact as TriHeptaMoeExpertArtifact,
  MoeGateDecision as TriHeptaMoeGateDecision,
  MoeTrace as TriHeptaMoeTrace,
  MoeExecutionResult as TriHeptaMoeExecutionResult,
  MoeRouteOptions as TriHeptaMoeRouteOptions,
} from "./moe";
