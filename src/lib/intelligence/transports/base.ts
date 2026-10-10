import type {
  FinishReason,
  NormalizedResponse,
  OpenAIWireTool,
  TransportApiMode,
  TransportCacheStats,
  TransportMessage,
  TransportParams,
} from "./types";

const KNOWN_FINISH_REASONS = new Set<string>(["stop", "tool_calls", "length", "content_filter"]);

/**
 * Abstract base for provider transports.
 *
 * A transport owns the data path for one `apiMode`:
 *   convertMessages → convertTools → buildKwargs → normalizeResponse
 *
 * It does NOT own: client construction, streaming, credential refresh,
 * prompt caching, interrupt handling, or retry logic.
 */
export abstract class ProviderTransport {
  /** The api_mode string this transport handles. */
  abstract readonly apiMode: TransportApiMode;

  /**
   * Convert OpenAI-format messages to provider-native format.
   *
   * Returns the provider-specific structure (e.g. `{system, messages}` for
   * Anthropic, or the messages list unchanged for chat_completions).
   */
  abstract convertMessages(
    messages: readonly TransportMessage[],
    kwargs?: { baseUrl?: string | null },
  ): unknown;

  /** Convert OpenAI tool definitions to provider-native format. */
  abstract convertTools(tools: readonly OpenAIWireTool[]): unknown;

  /**
   * Build the complete API call kwargs object.
   *
   * The primary entry point — it calls `convertMessages` and `convertTools`
   * internally, then adds model-specific config. Returns a plain object ready
   * to be serialized (or handed to a provider SDK).
   */
  abstract buildKwargs(
    model: string,
    messages: readonly TransportMessage[],
    tools?: readonly OpenAIWireTool[] | null,
    params?: TransportParams,
  ): Record<string, unknown>;

  /** Normalize a raw provider response into the shared `NormalizedResponse`. */
  abstract normalizeResponse(
    response: unknown,
    kwargs?: Record<string, unknown>,
  ): NormalizedResponse;

  /**
   * Optional structural validity check for the raw response.
   *
   * Default accepts everything; transports whose API can legitimately return
   * an empty body override this so a completed response is not retried.
   */
  validateResponse(_response: unknown): boolean {
    return true;
  }

  /** Optional provider-specific prompt-cache counters. */
  extractCacheStats(_response: unknown): TransportCacheStats | null {
    return null;
  }

  /**
   * Map a provider-specific stop reason onto the OpenAI vocabulary.
   *
   * The default never widens the `FinishReason` union: unrecognised reasons
   * become `"unknown"` instead of leaking an arbitrary provider string.
   */
  mapFinishReason(rawReason: string): FinishReason {
    return KNOWN_FINISH_REASONS.has(rawReason) ? (rawReason as FinishReason) : "unknown";
  }
}
