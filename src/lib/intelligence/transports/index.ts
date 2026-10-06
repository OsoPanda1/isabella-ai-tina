import { registerTransport } from "./registry";
import { AnthropicTransport } from "./anthropic";
import { BedrockTransport } from "./bedrock";
import { OpenAICompatibleTransport } from "./openai-compatible";
import { ResponsesTransport } from "./responses";

/**
 * Bind every Isabella transport to its `apiMode`.
 *
 * This is capability discovery only: it makes `requireTransport(mode)` resolvable
 * for the tool and provider layers. Registration is not authorization — a caller
 * still has to satisfy credentials, model-registry approval and the production
 * gate before a single byte leaves the process.
 */
export function registerIsabellaTransports(): void {
  registerTransport(new OpenAICompatibleTransport());
  registerTransport(new AnthropicTransport());
  registerTransport(new BedrockTransport());
  registerTransport(new ResponsesTransport());
}

export { ProviderTransport } from "./base";
export { registerTransport, getTransport, listTransportModes, requireTransport } from "./registry";
export { AnthropicTransport } from "./anthropic";
export { BedrockTransport } from "./bedrock";
export { OpenAICompatibleTransport } from "./openai-compatible";
export { ResponsesTransport } from "./responses";
export { buildToolCall } from "./types";
export type {
  FinishReason,
  NormalizedResponse,
  OpenAIWireTool,
  TransportApiMode,
  TransportCacheStats,
  TransportMessage,
  TransportParams,
  TransportToolCall,
  TransportUsage,
} from "./types";
