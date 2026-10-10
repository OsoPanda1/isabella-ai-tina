import { ProviderTransport } from "./base";
import type {
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

const MCP_PREFIX = "mcp__";
const DEFAULT_MAX_TOKENS = 16384;

/**
 * Block fields that are output-only or provider-internal. They must never be
 * persisted into `providerData` and replayed as request input: the Messages API
 * rejects them with "Extra inputs are not permitted". Signature-bearing fields
 * (`signature`, `data`) are deliberately kept — they are what makes a thinking
 * block replayable.
 */
const NON_REPLAYABLE_BLOCK_FIELDS = new Set(["citations", "parsed_output", "caller"]);

const STOP_REASON_MAP: Readonly<Partial<Record<string, FinishReason>>> = {
  end_turn: "stop",
  tool_use: "tool_calls",
  max_tokens: "length",
  stop_sequence: "stop",
  refusal: "content_filter",
  model_context_window_exceeded: "length",
};

const EMPTY_TOOL_SCHEMA: Record<string, unknown> = { type: "object", properties: {} };

/** Anthropic message entry. Anthropic has no `system` role; it is hoisted out. */
export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string;
};

/** Result of `convertMessages`: system prompt plus the remaining turn list. */
export type AnthropicMessageBatch = {
  system?: string;
  messages: AnthropicMessage[];
};

/** Anthropic-native tool definition. `input_schema` follows the wire spelling. */
export type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Shallow-copy a content block without its non-replayable fields.
 *
 * The Python reference converts SDK objects to plain data and then sanitizes
 * them; here the payload already arrives as JSON, so sanitizing is a field
 * allow-list by exclusion. The block is always returned — the reference's
 * `None` branch covered SDK objects that were not dicts, which `isRecord`
 * already filters out.
 */
function sanitizeReplayBlock(block: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    if (!NON_REPLAYABLE_BLOCK_FIELDS.has(key)) clean[key] = value;
  }
  return clean;
}

function encodeToolArguments(input: unknown): string {
  if (input === undefined) return "{}";
  const encoded: string | undefined = JSON.stringify(input);
  return encoded === undefined ? "{}" : encoded;
}

function extractUsage(raw: Record<string, unknown> | null): TransportUsage | null {
  const usage = raw && isRecord(raw.usage) ? raw.usage : null;
  if (!usage) return null;
  const promptTokens = toTokenCount(usage.input_tokens);
  const completionTokens = toTokenCount(usage.output_tokens);
  if (promptTokens === null && completionTokens === null) return null;
  const declaredTotal = toTokenCount(usage.total_tokens);
  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: declaredTotal ?? (promptTokens ?? 0) + (completionTokens ?? 0),
  };
}

/**
 * Anthropic Messages API transport (`/v1/messages`).
 *
 * Port of the Python `AnthropicTransport`. Adaptations, all deliberate:
 * - `convertMessages`, `convertTools` and `buildKwargs` are implemented inline:
 *   the reference delegates to `agent/anthropic_adapter.py`, which does not
 *   exist in this repository.
 * - Request-shaping flags in `TransportParams` (`isOAuth`, `preserveDots`,
 *   `fastMode`, `dropContext1mBeta`, `contextLength`) concern headers/betas, not
 *   the JSON body, so they are not encoded here.
 * - `reasoningConfig` is passed through as the Anthropic-native `thinking`
 *   object; this transport does not translate a provider-agnostic budget.
 * - `usage` is populated from the response's `input_tokens`/`output_tokens`
 *   instead of the reference's `usage=None`, because the shared
 *   `IntelligenceResponse` contract reports token counts.
 */
export class AnthropicTransport extends ProviderTransport {
  readonly apiMode: TransportApiMode = "anthropic_messages";

  /**
   * @param registeredToolNames Tool names known to the local registry. Used to
   * reverse the `mcp__` wire prefix; an empty set (default) leaves every name
   * untouched.
   */
  constructor(private readonly registeredToolNames: ReadonlySet<string> = new Set()) {
    super();
  }

  /**
   * Hoist `system` messages into the top-level `system` field; every other
   * message becomes a `user`/`assistant` entry.
   *
   * `_kwargs` mirrors the reference's `base_url`, which it uses only to adjust
   * thinking-signature handling. Messages here are plain strings with no
   * thinking blocks to rewrite, so the argument has no effect.
   */
  convertMessages(
    messages: readonly TransportMessage[],
    _kwargs?: { baseUrl?: string | null },
  ): AnthropicMessageBatch {
    const systemParts: string[] = [];
    const turn: AnthropicMessage[] = [];
    for (const message of messages) {
      if (message.role === "system") {
        systemParts.push(message.content);
        continue;
      }
      turn.push({ role: message.role, content: message.content });
    }
    return systemParts.length > 0
      ? { system: systemParts.join("\n\n"), messages: turn }
      : { messages: turn };
  }

  /** Map OpenAI `function` tools onto Anthropic `{name, input_schema}` tools. */
  convertTools(tools: readonly OpenAIWireTool[]): AnthropicTool[] {
    return tools.map((tool) => {
      const definition: AnthropicTool = {
        name: tool.function.name,
        input_schema: tool.function.parameters ?? EMPTY_TOOL_SCHEMA,
      };
      if (tool.function.description !== undefined) {
        definition.description = tool.function.description;
      }
      return definition;
    });
  }

  /**
   * Build the `/v1/messages` body. Undefined optional fields are omitted so
   * they never serialize as `null`.
   */
  buildKwargs(
    model: string,
    messages: readonly TransportMessage[],
    tools?: readonly OpenAIWireTool[] | null,
    params?: TransportParams,
  ): Record<string, unknown> {
    const converted = this.convertMessages(
      messages,
      params ? { baseUrl: params.baseUrl } : undefined,
    );
    const payload: {
      model: string;
      max_tokens: number;
      messages: AnthropicMessage[];
      system?: string;
      tools?: AnthropicTool[];
      temperature?: number;
      top_p?: number;
      stop?: string[];
      tool_choice?: Record<string, unknown>;
      thinking?: Record<string, unknown>;
    } = {
      model,
      max_tokens: params?.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: converted.messages,
    };
    if (converted.system !== undefined) payload.system = converted.system;
    if (tools && tools.length > 0) payload.tools = this.convertTools(tools);
    if (params?.temperature !== undefined) payload.temperature = params.temperature;
    if (params?.topP !== undefined) payload.top_p = params.topP;
    if (params?.stop !== undefined) payload.stop = params.stop;
    if (params?.toolChoice !== undefined) payload.tool_choice = params.toolChoice;
    if (params?.reasoningConfig !== undefined) payload.thinking = params.reasoningConfig;
    return payload;
  }

  /**
   * Parse `text`, `thinking`/`redacted_thinking` and `tool_use` blocks, map
   * `stop_reason` onto the OpenAI finish-reason vocabulary and collect the
   * replayable block payload in `providerData`.
   *
   * Content blocks are captured verbatim, order-preserving. Anthropic signs
   * each thinking block against the turn content that precedes it at its
   * position; when a turn interleaves thinking and tool_use (adaptive /
   * interleaved thinking), the parallel `reasoning_details` + `tool_calls`
   * lists lose that cross-type ordering. Replaying the latest assistant
   * message in the wrong order invalidates the signatures and returns HTTP 400
   * "thinking ... blocks in the latest assistant message cannot be modified",
   * so the exact block sequence is preserved for replay.
   */
  normalizeResponse(response: unknown): NormalizedResponse {
    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    const reasoningDetails: Array<Record<string, unknown>> = [];
    const toolCalls: TransportToolCall[] = [];

    /**
     * Ordered copy of every content block in the turn. Only carried in
     * `providerData` when it actually reconstructs something the parallel
     * lists cannot (see below).
     */
    const orderedBlocks: Array<Record<string, unknown>> = [];

    const source = isRecord(response) ? response : null;
    const rawBlocks = source && Array.isArray(source.content) ? source.content : [];
    const stopReason = source && typeof source.stop_reason === "string" ? source.stop_reason : "";

    for (const blockValue of rawBlocks) {
      if (!isRecord(blockValue)) continue;
      const cleanBlock = sanitizeReplayBlock(blockValue);
      orderedBlocks.push(cleanBlock);
      const blockType = typeof blockValue.type === "string" ? blockValue.type : "";
      if (blockType === "text") {
        if (typeof blockValue.text === "string") textParts.push(blockValue.text);
      } else if (blockType === "thinking" || blockType === "redacted_thinking") {
        if (blockType === "thinking" && typeof blockValue.thinking === "string") {
          reasoningParts.push(blockValue.thinking);
        }
        reasoningDetails.push(cleanBlock);
      } else if (blockType === "tool_use") {
        toolCalls.push({
          id: typeof blockValue.id === "string" ? blockValue.id : "",
          name: this.resolveToolName(typeof blockValue.name === "string" ? blockValue.name : ""),
          arguments: encodeToolArguments(blockValue.input),
        });
      }
    }

    const providerData: Record<string, unknown> = {};
    if (reasoningDetails.length > 0) providerData.reasoning_details = reasoningDetails;

    /**
     * The ordered channel is only worth carrying when the turn interleaves
     * signed thinking with tool_use — the only shape the parallel lists
     * reconstruct incorrectly. A purely text turn, or thinking-then-tools with
     * a single leading thinking block, replays correctly without it.
     */
    const hasSignedThinking = orderedBlocks.some(
      (block) =>
        (block.type === "thinking" || block.type === "redacted_thinking") &&
        Boolean(block.signature ?? block.data),
    );
    const hasToolUse = orderedBlocks.some((block) => block.type === "tool_use");
    if (hasSignedThinking && hasToolUse) {
      providerData.anthropic_content_blocks = orderedBlocks;
    }

    return {
      content: textParts.length > 0 ? textParts.join("\n") : null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      finishReason: this.mapFinishReason(stopReason),
      reasoning: reasoningParts.length > 0 ? reasoningParts.join("\n\n") : null,
      usage: extractUsage(source),
      providerData: Object.keys(providerData).length > 0 ? providerData : null,
    };
  }

  /**
   * An empty content list is legitimate for terminal stop reasons without
   * payload: `end_turn` (the model's "nothing more to add" after a tool turn)
   * and `refusal` (Claude 4.5+ declined; the API returns empty content).
   * Treating either as invalid falsely retries a completed response.
   */
  validateResponse(response: unknown): boolean {
    if (!isRecord(response)) return false;
    if (!Array.isArray(response.content)) return false;
    if (response.content.length === 0) {
      const stopReason =
        typeof response.stop_reason === "string" ? response.stop_reason : undefined;
      return stopReason === "end_turn" || stopReason === "refusal";
    }
    return true;
  }

  /** Anthropic prompt-cache counters, or `null` when neither counter is set. */
  extractCacheStats(response: unknown): TransportCacheStats | null {
    if (!isRecord(response) || !isRecord(response.usage)) return null;
    const cached = toTokenCount(response.usage.cache_read_input_tokens) ?? 0;
    const written = toTokenCount(response.usage.cache_creation_input_tokens) ?? 0;
    if (cached === 0 && written === 0) return null;
    return { cachedTokens: cached, creationTokens: written };
  }

  mapFinishReason(rawReason: string): FinishReason {
    return STOP_REASON_MAP[rawReason] ?? "stop";
  }

  /**
   * Reverse the `mcp__` wire prefix back to the name the local registry knows.
   * Two original forms map onto the same `mcp__` wire name (the OAuth wire adds
   * a double-underscore prefix to every tool): `mcp__read_file` for a bare
   * native tool `read_file`, and `mcp__linear_get_issue` for an MCP server tool
   * `mcp_linear_get_issue`. Resolution prefers whichever original is actually
   * registered and never rewrites a name that already resolves natively.
   */
  private resolveToolName(name: string): string {
    if (!name.startsWith(MCP_PREFIX) || this.registeredToolNames.has(name)) return name;
    const bare = name.slice(MCP_PREFIX.length);
    const single = `mcp_${bare}`;
    if (this.registeredToolNames.has(single)) return single;
    if (this.registeredToolNames.has(bare)) return bare;
    return name;
  }
}
