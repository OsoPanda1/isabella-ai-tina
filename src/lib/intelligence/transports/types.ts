import type { FinishReason, IntelligenceMessage, ToolCall } from "../contracts";

export type { FinishReason, ToolCall };
export type TransportToolCall = ToolCall;

/**
 * Transport layer types.
 *
 * A transport owns the data path for one `apiMode`:
 *   convertMessages → convertTools → buildKwargs → normalizeResponse
 *
 * It does NOT own client construction, streaming, credential refresh, prompt
 * caching, interrupt handling or retry logic — those stay on the provider that
 * implements `IntelligenceProvider`.
 */
export type TransportApiMode =
  "chat_completions" | "anthropic_messages" | "bedrock_converse" | "responses";

export interface TransportUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TransportCacheStats {
  cachedTokens: number;
  creationTokens: number;
}

export interface NormalizedResponse {
  content: string | null;
  toolCalls: TransportToolCall[] | null;
  finishReason: FinishReason;
  reasoning: string | null;
  usage: TransportUsage | null;
  providerData: Record<string, unknown> | null;
}

/** OpenAI tool schema. Transports convert this into their provider-native form. */
export interface OpenAIWireTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type TransportMessage = IntelligenceMessage;

/**
 * Provider-agnostic call parameters accepted by `buildKkwargs`.
 * Every field is optional; each transport picks the ones its API understands.
 */
export interface TransportParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  toolChoice?: Record<string, unknown>;
  reasoningConfig?: Record<string, unknown>;
  /** Anthropic OAuth/header shaping. */
  isOAuth?: boolean;
  preserveDots?: boolean;
  contextLength?: number | null;
  baseUrl?: string | null;
  fastMode?: boolean;
  dropContext1mBeta?: boolean;
  /** Bedrock Converse. */
  region?: string;
  guardrailConfig?: Record<string, unknown>;
  /** OpenAI Responses API: system prompt, session identity and cache scope. */
  instructions?: string;
  sessionId?: string;
  cacheScopeId?: string;
  /** OpenAI Responses API: last-resort body merge applied after transport shaping. */
  requestOverrides?: Record<string, unknown>;
}

/** Encode tool arguments onto the wire: strings pass through, structured data is serialised. */
function encodeToolArguments(args: unknown): string {
  if (typeof args === "string") return args;
  if (args === undefined) return "{}";
  const encoded: string | undefined = JSON.stringify(args);
  return encoded ?? "{}";
}

/**
 * Build a `ToolCall`, encoding `args` when it arrives as structured data.
 *
 * Anything passed in `providerFields` becomes `providerData`, so protocol
 * metadata (Responses `call_id` and item ids, Gemini thought signatures) travels
 * with the call instead of a parallel array; an empty collection stays unset.
 *
 * The Python factory allowed `id=None` for providers that omit one; Isabella's
 * `ToolCall.id` is required, so the tool name is used as the last resort.
 */
export function buildToolCall(
  id: string | null | undefined,
  name: string,
  args: unknown,
  providerFields?: Record<string, unknown> | null,
): ToolCall {
  const resolvedId = id !== null && id !== undefined && id.length > 0 ? id : name;
  const call: ToolCall = { id: resolvedId, name, arguments: encodeToolArguments(args) };
  if (
    providerFields !== null &&
    providerFields !== undefined &&
    Object.keys(providerFields).length > 0
  ) {
    call.providerData = providerFields;
  }
  return call;
}
