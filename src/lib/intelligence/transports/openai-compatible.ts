import { ProviderTransport } from "./base";
import type {
  NormalizedResponse,
  OpenAIWireTool,
  TransportCacheStats,
  TransportMessage,
  TransportParams,
  TransportToolCall,
  TransportUsage,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function encodeToolArguments(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object") {
    const encoded: string | undefined = JSON.stringify(raw);
    return encoded ?? "{}";
  }
  return "{}";
}

function readToolCalls(raw: unknown): TransportToolCall[] | null {
  if (!Array.isArray(raw)) return null;
  const calls: TransportToolCall[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const fn = isRecord(entry.function) ? entry.function : null;
    const id = typeof entry.id === "string" ? entry.id : null;
    const entryName = typeof entry.name === "string" ? entry.name : null;
    const name = fn && typeof fn.name === "string" ? fn.name : entryName;
    if (id === null || name === null) continue;
    const rawArguments = fn ? fn.arguments : entry.arguments;
    calls.push({ id, name, arguments: encodeToolArguments(rawArguments) });
  }
  return calls.length > 0 ? calls : null;
}

function readReasoning(message: Record<string, unknown>): string | null {
  if (typeof message.reasoning_content === "string") return message.reasoning_content;
  if (typeof message.reasoning === "string") return message.reasoning;
  return null;
}

function readUsage(root: Record<string, unknown>): TransportUsage | null {
  const rawUsage: unknown = root.usage;
  if (!isRecord(rawUsage)) return null;
  const promptTokens = readNumber(rawUsage, "prompt_tokens");
  const completionTokens = readNumber(rawUsage, "completion_tokens");
  if (promptTokens === null || completionTokens === null) return null;
  const reportedTotal = readNumber(rawUsage, "total_tokens");
  return {
    promptTokens,
    completionTokens,
    totalTokens: reportedTotal ?? promptTokens + completionTokens,
  };
}

function readCacheStats(root: Record<string, unknown>): TransportCacheStats | null {
  const rawUsage: unknown = root.usage;
  if (!isRecord(rawUsage)) return null;
  const promptDetails = isRecord(rawUsage.prompt_tokens_details)
    ? rawUsage.prompt_tokens_details
    : null;
  const completionDetails = isRecord(rawUsage.completion_tokens_details)
    ? rawUsage.completion_tokens_details
    : null;
  const cachedTokens = promptDetails ? readNumber(promptDetails, "cached_tokens") : null;
  const creationTokens = completionDetails
    ? (readNumber(completionDetails, "cache_creation_tokens") ??
      readNumber(completionDetails, "creation_tokens"))
    : null;
  const cached = cachedTokens ?? 0;
  const creation = creationTokens ?? 0;
  if (cached === 0 && creation === 0) return null;
  return { cachedTokens: cached, creationTokens: creation };
}

/**
 * Transport for the OpenAI `chat_completions` wire format.
 *
 * The OpenAI request shape is the interchange format of the system, so
 * messages and tools pass through unchanged and only the response payload is
 * normalized into `NormalizedResponse`.
 */
export class OpenAICompatibleTransport extends ProviderTransport {
  readonly apiMode = "chat_completions";

  convertMessages(messages: readonly TransportMessage[]): unknown {
    return [...messages];
  }

  convertTools(tools: readonly OpenAIWireTool[]): unknown {
    return [...tools];
  }

  buildKwargs(
    model: string,
    messages: readonly TransportMessage[],
    tools?: readonly OpenAIWireTool[] | null,
    params?: TransportParams,
  ): Record<string, unknown> {
    const kwargs: Record<string, unknown> = {
      model,
      messages: this.convertMessages(messages),
      temperature: params?.temperature ?? 0.7,
      max_tokens: params?.maxTokens ?? 2048,
      stream: false,
    };
    if (tools !== undefined && tools !== null) kwargs.tools = this.convertTools(tools);
    if (params?.topP !== undefined) kwargs.top_p = params.topP;
    if (params?.stop !== undefined) kwargs.stop = params.stop;
    if (params?.toolChoice !== undefined) kwargs.tool_choice = params.toolChoice;
    return kwargs;
  }

  normalizeResponse(response: unknown): NormalizedResponse {
    const root = isRecord(response) ? response : null;
    const choices: unknown[] = root && Array.isArray(root.choices) ? root.choices : [];
    const rawChoice: unknown = choices.length > 0 ? choices[0] : null;
    const choice = isRecord(rawChoice) ? rawChoice : null;
    const rawMessage: unknown = choice ? choice.message : null;
    const message = isRecord(rawMessage) ? rawMessage : null;
    const rawFinishReason: unknown = choice ? choice.finish_reason : null;
    return {
      content: message && typeof message.content === "string" ? message.content : null,
      toolCalls: message ? readToolCalls(message.tool_calls) : null,
      finishReason:
        typeof rawFinishReason === "string" ? this.mapFinishReason(rawFinishReason) : "unknown",
      reasoning: message ? readReasoning(message) : null,
      usage: root ? readUsage(root) : null,
      providerData: null,
    };
  }

  validateResponse(response: unknown): boolean {
    if (!isRecord(response)) return false;
    if (!Array.isArray(response.choices)) return false;
    return response.choices.length > 0;
  }

  extractCacheStats(response: unknown): TransportCacheStats | null {
    if (!isRecord(response)) return null;
    return readCacheStats(response);
  }
}
