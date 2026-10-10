import { ProviderTransport } from "./base";
import type {
  FinishReason,
  NormalizedResponse,
  OpenAIWireTool,
  ToolCall,
  TransportApiMode,
  TransportCacheStats,
  TransportMessage,
  TransportParams,
  TransportUsage,
} from "./types";

/**
 * Sentinel key placed by `buildKwargs` so the dispatch site knows the payload
 * must go through the Converse endpoint. It must be removed before the body
 * is serialized for the HTTP request.
 */
export const BEDROCK_CONVERSE_SENTINEL = "__bedrock_converse__";

/**
 * Sentinel key carrying the AWS region used for signing and egress. It must be
 * removed before the body is serialized for the HTTP request.
 */
export const BEDROCK_REGION_SENTINEL = "__bedrock_region__";

/** `inferenceConfig.maxTokens` applied when the caller does not override it. */
export const BEDROCK_DEFAULT_MAX_TOKENS = 4096;

/** Region applied when `params.region` is absent, mirroring the Python port. */
export const BEDROCK_DEFAULT_REGION = "us-east-1";

/** Message roles accepted by Converse. System turns are hoisted to the top level. */
export type ConverseRole = "user" | "assistant" | "system";

/** A single text block: Converse never takes plain strings as content. */
export interface ConverseTextBlock {
  text: string;
}

/** A single top-level system block. Converse takes `system` as an array, not a turn. */
export interface ConverseSystemBlock {
  text: string;
}

/** One Converse message turn. */
export interface ConverseMessage {
  role: ConverseRole;
  content: ConverseTextBlock[];
}

/**
 * Result of `convertMessages`: `system` is hoisted out of the turn list because
 * Converse accepts system prompts only through the top-level `system` array.
 */
export interface ConverseMessageSet {
  system: ConverseSystemBlock[];
  messages: ConverseMessage[];
}

/** Converse `ToolSpecification`: JSON Schema under `inputSchema.json`. */
export interface ConverseToolSpec {
  name: string;
  description?: string;
  inputSchema: { json: Record<string, unknown> };
}

/** Converse `Tool` union member used for user-defined tools. */
export interface ConverseTool {
  toolSpec: ConverseToolSpec;
}

const FINISH_REASON_MAP: Readonly<Record<string, FinishReason>> = {
  end_turn: "stop",
  tool_use: "tool_calls",
  max_tokens: "length",
  stop_sequence: "stop",
  guardrail_intervened: "content_filter",
  content_filtered: "content_filter",
};

const DEFAULT_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
};

function mapStopReason(rawReason: string): FinishReason {
  return FINISH_REASON_MAP[rawReason] ?? "stop";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function toToolCall(value: unknown): ToolCall | null {
  if (!isRecord(value)) return null;
  const id = readString(value, "id");
  if (id === null) return null;
  const directName = readString(value, "name");
  const directArguments = readString(value, "arguments");
  if (directName !== null && directArguments !== null) {
    return { id, name: directName, arguments: directArguments };
  }
  const fn = value.function;
  if (isRecord(fn)) {
    const name = readString(fn, "name");
    const args = readString(fn, "arguments");
    if (name !== null && args !== null) return { id, name, arguments: args };
  }
  return null;
}

function readMessageReasoning(message: Record<string, unknown>): string | null {
  return readString(message, "reasoning", "reasoningContent", "reasoning_content");
}

function readBlockReasoning(block: Record<string, unknown>): string | null {
  const content = block.reasoningContent;
  if (!isRecord(content)) return null;
  const textBlock = content.reasoningText;
  if (!isRecord(textBlock)) return null;
  return readString(textBlock, "text");
}

function normalizeConverse(raw: Record<string, unknown>): NormalizedResponse {
  const output = raw.output;
  const message = isRecord(output) && isRecord(output.message) ? output.message : null;
  const blocks = message !== null && Array.isArray(message.content) ? message.content : [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  let reasoning: string | null = null;
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const text = readString(block, "text");
    if (text !== null) {
      textParts.push(text);
      continue;
    }
    const toolUse = block.toolUse;
    if (isRecord(toolUse)) {
      const id = readString(toolUse, "toolUseId");
      const name = readString(toolUse, "name");
      if (id !== null && name !== null) {
        const input = toolUse.input;
        toolCalls.push({ id, name, arguments: JSON.stringify(input === undefined ? {} : input) });
      }
      continue;
    }
    if (reasoning === null) reasoning = readBlockReasoning(block);
  }
  const rawUsage = raw.usage;
  const usage: TransportUsage | null = isRecord(rawUsage)
    ? {
        promptTokens: readNumber(rawUsage, "inputTokens") ?? 0,
        completionTokens: readNumber(rawUsage, "outputTokens") ?? 0,
        totalTokens: readNumber(rawUsage, "totalTokens") ?? 0,
      }
    : null;
  const stopReason = readString(raw, "stopReason");
  return {
    content: textParts.length > 0 ? textParts.join("") : null,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
    finishReason: stopReason !== null ? mapStopReason(stopReason) : "stop",
    reasoning,
    usage,
    providerData: null,
  };
}

function normalizeDispatched(raw: Record<string, unknown>): NormalizedResponse {
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const first = choices[0];
  const choice = isRecord(first) ? first : null;
  const message = choice !== null && isRecord(choice.message) ? choice.message : null;
  let toolCalls: ToolCall[] | null = null;
  if (message !== null) {
    const calls = Array.isArray(message.toolCalls)
      ? message.toolCalls
      : Array.isArray(message.tool_calls)
        ? message.tool_calls
        : null;
    if (calls !== null) {
      const parsed = calls.map(toToolCall).filter((call): call is ToolCall => call !== null);
      toolCalls = parsed.length > 0 ? parsed : null;
    }
  }
  const finishRaw = choice !== null ? readString(choice, "finishReason", "finish_reason") : null;
  const rawUsage = raw.usage;
  const usage: TransportUsage | null = isRecord(rawUsage)
    ? {
        promptTokens: readNumber(rawUsage, "promptTokens", "prompt_tokens") ?? 0,
        completionTokens: readNumber(rawUsage, "completionTokens", "completion_tokens") ?? 0,
        totalTokens: readNumber(rawUsage, "totalTokens", "total_tokens") ?? 0,
      }
    : null;
  return {
    content: message !== null ? readString(message, "content") : null,
    toolCalls,
    finishReason: finishRaw !== null ? mapStopReason(finishRaw) : "stop",
    reasoning: message !== null ? readMessageReasoning(message) : null,
    usage,
    providerData: null,
  };
}

/**
 * Faithful port of the Python `BedrockTransport` for the Converse API.
 *
 * Porting notes:
 * - Converse takes system prompts as a top-level `system: [{text}]` array, so
 *   every `system` message is hoisted there in order and never appears as a turn.
 * - Tool definitions map to `{toolSpec:{name, description, inputSchema:{json}}}`
 *   inside `toolConfig: {tools, toolChoice}`.
 * - `buildKwargs` carries the dispatch sentinels
 *   {@link BEDROCK_CONVERSE_SENTINEL} / {@link BEDROCK_REGION_SENTINEL}; callers
 *   must strip them before serializing the request body.
 */
export class BedrockTransport extends ProviderTransport {
  readonly apiMode: TransportApiMode = "bedrock_converse";

  /**
   * Convert OpenAI messages into Converse turns, hoisting `system` messages into
   * the separate top-level system list (in original order).
   */
  convertMessages(messages: readonly TransportMessage[]): ConverseMessageSet {
    const system: ConverseSystemBlock[] = [];
    const turns: ConverseMessage[] = [];
    for (const message of messages) {
      if (message.role === "system") {
        system.push({ text: message.content });
        continue;
      }
      turns.push({ role: message.role, content: [{ text: message.content }] });
    }
    return { system, messages: turns };
  }

  /** Convert OpenAI function tools into Converse `toolSpec` entries. */
  convertTools(tools: readonly OpenAIWireTool[]): ConverseTool[] {
    return tools.map((tool) => {
      const spec: ConverseToolSpec = {
        name: tool.function.name,
        inputSchema: {
          json: tool.function.parameters ?? { ...DEFAULT_TOOL_INPUT_SCHEMA },
        },
      };
      if (tool.function.description !== undefined) spec.description = tool.function.description;
      return { toolSpec: spec };
    });
  }

  /**
   * Build the Converse request object. Returns `Record<string, unknown>` with the
   * dispatch sentinels included; `maxTokens` defaults to 4096 and the region
   * defaults to `us-east-1`.
   */
  buildKwargs(
    model: string,
    messages: readonly TransportMessage[],
    tools?: readonly OpenAIWireTool[] | null,
    params?: TransportParams,
  ): Record<string, unknown> {
    const converted = this.convertMessages(messages);
    const kwargs: Record<string, unknown> = {
      model,
      messages: converted.messages,
      inferenceConfig: {
        maxTokens: params?.maxTokens ?? BEDROCK_DEFAULT_MAX_TOKENS,
        ...(params?.temperature !== undefined ? { temperature: params.temperature } : {}),
      },
      [BEDROCK_CONVERSE_SENTINEL]: true,
      [BEDROCK_REGION_SENTINEL]: params?.region ?? BEDROCK_DEFAULT_REGION,
    };
    if (converted.system.length > 0) kwargs.system = converted.system;
    if (tools !== undefined && tools !== null && tools.length > 0) {
      kwargs.toolConfig = {
        tools: this.convertTools(tools),
        ...(params?.toolChoice !== undefined ? { toolChoice: params.toolChoice } : {}),
      };
    }
    if (params?.guardrailConfig !== undefined) kwargs.guardrailConfig = params.guardrailConfig;
    return kwargs;
  }

  /**
   * Normalize either the raw Converse shape (`output.message` / `stopReason` /
   * `usage`) or an already-normalized shape carrying `choices` (dispatch-site
   * compatibility). Unrecognized shapes throw instead of fabricating a result.
   */
  normalizeResponse(response: unknown, _kwargs?: Record<string, unknown>): NormalizedResponse {
    if (isRecord(response)) {
      if (Array.isArray(response.choices) && response.choices.length > 0) {
        return normalizeDispatched(response);
      }
      if ("output" in response) return normalizeConverse(response);
    }
    throw new Error("bedrock_response_unrecognized_shape");
  }

  /** Structural validity: raw boto3/Converse dicts expose `output`, normalized ones expose `choices`. */
  override validateResponse(response: unknown): boolean {
    if (response === null || response === undefined) return false;
    if (isRecord(response)) {
      if ("output" in response) return true;
      if (Array.isArray(response.choices)) return response.choices.length > 0;
      return false;
    }
    return false;
  }

  /** Prompt-cache counters from Converse `usage.cacheReadInputTokens` / `cacheWriteInputTokens`. */
  override extractCacheStats(response: unknown): TransportCacheStats | null {
    if (!isRecord(response)) return null;
    const usage = response.usage;
    if (!isRecord(usage)) return null;
    const read = readNumber(usage, "cacheReadInputTokens");
    const write = readNumber(usage, "cacheWriteInputTokens");
    if (read === null && write === null) return null;
    return { cachedTokens: read ?? 0, creationTokens: write ?? 0 };
  }

  /** Map a Converse `stopReason` onto the shared vocabulary; unknown reasons become `stop`. */
  override mapFinishReason(rawReason: string): FinishReason {
    return mapStopReason(rawReason);
  }
}
