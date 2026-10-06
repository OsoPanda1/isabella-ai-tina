import { createHash } from "node:crypto";
import { ProviderTransport } from "./base";
import { buildToolCall } from "./types";
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

/**
 * OpenAI Responses API transport (`/v1/responses`).
 *
 * Port of the Python `ResponsesApiTransport`. Deliberate adaptations:
 * - Message and tool conversion are implemented inline: the reference delegates
 *   to `agent/codex_responses_adapter.py`, which does not exist in this
 *   repository. Isabella messages carry plain text only, so there is no
 *   encrypted-reasoning or foreign-issuer item to replay or drop.
 * - Endpoint classification and wire extras (Codex/xAI/GitHub headers, `extra_body`,
 *   `include`, `service_tier`, timeouts, prompt-cache retention, Azure Foundry
 *   reasoning suppression, native-compaction `context_management`) read provider
 *   config or drive HTTP, so they belong to the provider layer and are absent here.
 * - `temperature`, `top_p` and `stop` are never sent: the reference omits them and
 *   GPT-5 Responses endpoints reject non-default sampling values.
 * - `reasoning` is opt-in through `params.reasoningConfig` (mirroring the Anthropic
 *   transport's `thinking`), instead of the reference's model-metadata-gated
 *   default: without a model table this transport cannot know which targets accept
 *   a `reasoning` key at all.
 *
 * Pure transport: no config, secrets, credentials or HTTP at import time.
 */

/** Cron fires build session ids as `cron_<job_id>_<YYYYMMDD_HHMMSS>`; the trailing timestamp is per-fire noise. */
const CRON_SESSION_ID_PATTERN = /^(cron_.+)_\d{8}_\d{6}$/;

/**
 * Function names some `/v1/responses` gateways reserve server-side and reject in
 * client tools with HTTP 400 ("custom function name 'X' is reserved"). They are
 * aliased on the wire and mapped back during normalization, so local dispatch is
 * unaffected.
 */
const RESERVED_TOOL_NAMES = new Set(["web_search", "search_files"]);
const RESERVED_TOOL_ALIAS_PREFIX = "isabella_";
const RESERVED_ALIAS_TO_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  [...RESERVED_TOOL_NAMES].map((name) => [`${RESERVED_TOOL_ALIAS_PREFIX}${name}`, name]),
);

/** Domain whose `/v1/responses` endpoints reserve those function names, subdomains included. */
const RESERVED_TOOL_BACKEND_HOSTNAME = "opencode.ai";

/** Responses `status` → OpenAI finish-reason vocabulary. */
const STATUS_FINISH_REASON_MAP: Readonly<Record<string, FinishReason>> = {
  completed: "stop",
  incomplete: "length",
  failed: "stop",
  cancelled: "stop",
};

/** Responses message part carried in an input item. */
export type ResponsesTextPart = {
  type: "input_text" | "output_text";
  text: string;
};

/** Responses input item: a chat turn expressed as content parts. */
export type ResponsesInputItem = {
  role: "user" | "assistant";
  content: ResponsesTextPart[];
};

/**
 * Result of `convertMessages`: system turns are hoisted into `instructions`
 * because the Responses API takes the system prompt as a separate top-level
 * field rather than a message.
 */
export type ResponsesMessageBatch = {
  instructions?: string;
  input: ResponsesInputItem[];
};

/** Responses-native function tool: the OpenAI nested `function` key is flattened. */
export type ResponsesTool = {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTextParts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const parts: string[] = [];
  for (const part of value) {
    if (isRecord(part) && typeof part.text === "string" && part.text.length > 0) {
      parts.push(part.text);
    }
  }
  return parts;
}

/** Deterministic JSON for cache keying: object keys sorted at every depth. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Normalize a physical session id into a stable logical cache scope.
 *
 * Every non-cron session id already identifies one conversation instance and is
 * used unchanged; only cron's per-fire timestamp is stripped so repeat fires of
 * the same job share a warm prefix bucket.
 */
export function cacheScopeFromSessionId(sessionId: string | null | undefined): string {
  const raw = String(sessionId ?? "");
  const match = CRON_SESSION_ID_PATTERN.exec(raw);
  return match ? match[1] : raw;
}

/**
 * Return a provider-safe prompt cache key without changing session identity.
 * Values of 64 characters or less are passed through; longer ones collapse to a
 * `pck_<sha256[:24]>` digest so the body never carries an unbounded key.
 */
export function boundedPromptCacheKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const key = String(value).trim();
  if (key.length === 0) return null;
  if (key.length <= 64) return key;
  const digest = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 24);
  return `pck_${digest}`;
}

/**
 * Content-address the prompt cache key within a logical cache scope.
 *
 * Returns `pck_<sha256[:24]>` over (scope + instructions + sorted tool schemas),
 * or `null` when there is nothing static to key on. The key is a routing hint
 * only — never a correctness boundary — so requests sharing a scope, system
 * prompt and tool set intentionally resolve to the same warm prefix bucket.
 * Tools are sorted by name and their schema keys at every depth, so the digest
 * is independent of list and key insertion order.
 */
export function contentCacheKey(
  instructions: string,
  tools: readonly Record<string, unknown>[],
  scopeId: string,
): string | null {
  if (!instructions && tools.length === 0) return null;
  let toolsPart = "";
  if (tools.length > 0) {
    const sortedTools = [...tools].sort((a, b) =>
      String(a.name ?? a.type ?? "").localeCompare(String(b.name ?? b.type ?? "")),
    );
    toolsPart = stableStringify(sortedTools);
  }
  const content = `${scopeId}\x00${instructions || ""}\x00${toolsPart}`;
  const digest = createHash("sha256").update(content, "utf8").digest("hex").slice(0, 24);
  return `pck_${digest}`;
}

/** Alias reserved function names on the wire; `normalizeResponse` maps them back. */
export function renameReservedTools(tools: readonly ResponsesTool[]): ResponsesTool[] {
  return tools.map((tool) =>
    RESERVED_TOOL_NAMES.has(tool.name)
      ? { ...tool, name: `${RESERVED_TOOL_ALIAS_PREFIX}${tool.name}` }
      : tool,
  );
}

/**
 * True when the target endpoint reserves `web_search` / `search_files` as
 * function names. Matched on the parsed hostname only, so a reserved domain in
 * a path or query segment cannot reclassify an unrelated gateway.
 */
function isReservedToolBackend(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return (
      hostname === RESERVED_TOOL_BACKEND_HOSTNAME ||
      hostname.endsWith(`.${RESERVED_TOOL_BACKEND_HOSTNAME}`)
    );
  } catch {
    return false;
  }
}

function resolveWireToolName(name: string): string {
  return RESERVED_ALIAS_TO_NAME[name] ?? name;
}

/**
 * `params.reasoningConfig` → the wire `reasoning` object, or `null` when the
 * caller did not opt in. `enabled` is a transport control flag, not a wire
 * field, so it is stripped; an empty payload is dropped instead of sent.
 */
function resolveReasoningPayload(
  config: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (config === undefined || config.enabled === false) return null;
  if (config.enabled === undefined) {
    return Object.keys(config).length > 0 ? config : null;
  }
  const wire: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key !== "enabled") wire[key] = value;
  }
  return Object.keys(wire).length > 0 ? wire : null;
}

function readUsage(root: Record<string, unknown>): TransportUsage | null {
  if (!isRecord(root.usage)) return null;
  const usage = root.usage;
  const promptTokens = readNumber(usage, "input_tokens");
  const completionTokens = readNumber(usage, "output_tokens");
  if (promptTokens === null && completionTokens === null) return null;
  const reportedTotal = readNumber(usage, "total_tokens");
  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: reportedTotal ?? (promptTokens ?? 0) + (completionTokens ?? 0),
  };
}

/** Transport for `apiMode='responses'`. */
export class ResponsesTransport extends ProviderTransport {
  readonly apiMode: TransportApiMode = "responses";

  /**
   * Hoist `system` turns into `instructions` and express every other turn as a
   * Responses input item. An explicit `kwargs.instructions` wins over the
   * hoisted text (the reference falls back the other way round when it is empty);
   * system turns stay out of `input` either way.
   *
   * `kwargs.baseUrl` is accepted to satisfy the base signature; this converter
   * has no endpoint-dependent rewriting to do.
   */
  convertMessages(
    messages: readonly TransportMessage[],
    kwargs?: { baseUrl?: string | null; instructions?: string },
  ): ResponsesMessageBatch {
    const systemParts: string[] = [];
    const input: ResponsesInputItem[] = [];
    for (const message of messages) {
      if (message.role === "system") {
        systemParts.push(message.content);
        continue;
      }
      input.push({
        role: message.role,
        content: [
          {
            type: message.role === "assistant" ? "output_text" : "input_text",
            text: message.content,
          },
        ],
      });
    }
    const hoisted = systemParts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join("\n\n");
    const explicit = typeof kwargs?.instructions === "string" ? kwargs.instructions : "";
    const instructions = explicit !== "" ? explicit : hoisted;

    const batch: ResponsesMessageBatch = { input };
    if (instructions !== "") batch.instructions = instructions;
    return batch;
  }

  /** Flatten OpenAI `function` tools onto the Responses tool shape. */
  convertTools(tools: readonly OpenAIWireTool[]): ResponsesTool[] {
    return tools.map((tool) => {
      const definition: ResponsesTool = { type: "function", name: tool.function.name };
      if (tool.function.description !== undefined) {
        definition.description = tool.function.description;
      }
      if (tool.function.parameters !== undefined) {
        definition.parameters = tool.function.parameters;
      }
      return definition;
    });
  }

  /**
   * Build the `/v1/responses` body. Keys whose value would be `undefined` are
   * never set, so nothing serializes as an explicit null. `tools` is omitted
   * entirely when there is no function to expose.
   */
  buildKwargs(
    model: string,
    messages: readonly TransportMessage[],
    tools?: readonly OpenAIWireTool[] | null,
    params?: TransportParams,
  ): Record<string, unknown> {
    const converted = this.convertMessages(messages, {
      baseUrl: params?.baseUrl ?? null,
      instructions: params?.instructions,
    });
    const scopeId = cacheScopeFromSessionId(params?.cacheScopeId ?? params?.sessionId);

    let wireTools: ResponsesTool[] | null = null;
    if (tools !== undefined && tools !== null && tools.length > 0) {
      wireTools = this.convertTools(tools);
      if (isReservedToolBackend(params?.baseUrl)) {
        wireTools = renameReservedTools(wireTools);
      }
    }

    const kwargs: Record<string, unknown> = { model, input: converted.input, store: false };
    if (converted.instructions !== undefined) kwargs.instructions = converted.instructions;
    if (wireTools !== null) {
      kwargs.tools = wireTools;
      kwargs.tool_choice = params?.toolChoice ?? "auto";
      kwargs.parallel_tool_calls = true;
    }
    if (params?.maxTokens !== undefined) kwargs.max_output_tokens = params.maxTokens;

    const reasoning = resolveReasoningPayload(params?.reasoningConfig);
    if (reasoning !== null) kwargs.reasoning = reasoning;

    // The cache key is content-addressed from the static prefix (instructions +
    // wire tools) inside a session scope, never the raw session id: recurring
    // cron jobs carry a per-fire timestamp that would make every run cache-cold.
    const contentKey = contentCacheKey(converted.instructions ?? "", wireTools ?? [], scopeId);
    const cacheKey = contentKey ?? (scopeId !== "" ? boundedPromptCacheKey(scopeId) : null);
    if (cacheKey !== null) kwargs.prompt_cache_key = cacheKey;

    if (params?.requestOverrides !== undefined) {
      Object.assign(kwargs, params.requestOverrides);
    }

    // Re-bound after the merge so an explicit override governs the field without
    // being able to smuggle an unbounded key onto the wire.
    if ("prompt_cache_key" in kwargs) {
      const bounded = boundedPromptCacheKey(kwargs.prompt_cache_key);
      if (bounded !== null) kwargs.prompt_cache_key = bounded;
      else delete kwargs.prompt_cache_key;
    }

    return kwargs;
  }

  /**
   * Normalize a Responses payload: concatenate `output_text` parts, surface
   * reasoning summaries, pair `function_call` items and map `status` plus
   * `incomplete_details.reason` onto the OpenAI finish-reason vocabulary.
   *
   * Each call carries its `call_id` (what a later `function_call_output` must
   * reference) and its response item id in `providerData`. Reserved wire aliases
   * are reversed so tool dispatch sees the registered name.
   */
  normalizeResponse(response: unknown): NormalizedResponse {
    const root = isRecord(response) ? response : null;
    const output = root !== null && Array.isArray(root.output) ? root.output : [];

    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    const reasoningItems: Array<Record<string, unknown>> = [];
    const toolCalls: TransportToolCall[] = [];

    for (const rawItem of output) {
      if (!isRecord(rawItem)) continue;
      const itemType = typeof rawItem.type === "string" ? rawItem.type : "";
      if (itemType === "message") {
        textParts.push(...readTextParts(rawItem.content));
      } else if (itemType === "reasoning") {
        reasoningItems.push(rawItem);
        reasoningParts.push(...readTextParts(rawItem.summary), ...readTextParts(rawItem.content));
      } else if (itemType === "function_call") {
        const name = resolveWireToolName(typeof rawItem.name === "string" ? rawItem.name : "");
        const callId = typeof rawItem.call_id === "string" ? rawItem.call_id : null;
        const itemId = typeof rawItem.id === "string" ? rawItem.id : null;
        const providerFields: Record<string, unknown> = {};
        if (callId !== null && callId !== "") providerFields.call_id = callId;
        if (itemId !== null && itemId !== "") providerFields.response_item_id = itemId;
        toolCalls.push(buildToolCall(callId ?? itemId, name, rawItem.arguments, providerFields));
      }
    }

    const providerData: Record<string, unknown> = {};
    if (reasoningItems.length > 0) providerData.reasoning_details = reasoningItems;

    return {
      content: textParts.length > 0 ? textParts.join("\n") : null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      finishReason: this.resolveFinishReason(root, toolCalls.length > 0),
      reasoning: reasoningParts.length > 0 ? reasoningParts.join("\n\n") : null,
      usage: root !== null ? readUsage(root) : null,
      providerData: Object.keys(providerData).length > 0 ? providerData : null,
    };
  }

  /**
   * A response is structurally valid when `output` is a non-empty list. An empty
   * output is also accepted for the terminal content-filter refusal
   * (`status=incomplete` + `incomplete_details.reason=content_filter`): that is a
   * provider refusal signal, not a malformed body, and must reach normalization
   * instead of being retried as an invalid response.
   */
  validateResponse(response: unknown): boolean {
    if (!isRecord(response)) return false;
    if (!Array.isArray(response.output) || response.output.length === 0) {
      const status = typeof response.status === "string" ? response.status.toLowerCase() : "";
      const details = isRecord(response.incomplete_details) ? response.incomplete_details : null;
      const reason =
        details !== null && typeof details.reason === "string" ? details.reason.toLowerCase() : "";
      return status === "incomplete" && reason === "content_filter";
    }
    return true;
  }

  /**
   * Responses prompt-cache counters. The API reports reuse on
   * `usage.input_tokens_details.cached_tokens`; Responses has no cache-creation
   * concept, so that counter is always `0` and no activity yields `null`.
   */
  override extractCacheStats(response: unknown): TransportCacheStats | null {
    if (!isRecord(response) || !isRecord(response.usage)) return null;
    const details = isRecord(response.usage.input_tokens_details)
      ? response.usage.input_tokens_details
      : null;
    const cached = details !== null ? readNumber(details, "cached_tokens") : null;
    if (cached === null || cached <= 0) return null;
    return { cachedTokens: cached, creationTokens: 0 };
  }

  /**
   * Map `response.status` onto the OpenAI vocabulary. Unknown statuses collapse
   * to `stop` rather than leaking a provider string, matching the reference;
   * `incomplete_details.reason` is resolved before this in `normalizeResponse`.
   */
  override mapFinishReason(rawReason: string): FinishReason {
    return STATUS_FINISH_REASON_MAP[rawReason] ?? "stop";
  }

  private resolveFinishReason(
    root: Record<string, unknown> | null,
    hasToolCalls: boolean,
  ): FinishReason {
    if (root === null) return "stop";
    const details = isRecord(root.incomplete_details) ? root.incomplete_details : null;
    const reason = details !== null && typeof details.reason === "string" ? details.reason : "";
    if (reason === "content_filter") return "content_filter";
    if (reason === "max_output_tokens") return "length";
    if (hasToolCalls) return "tool_calls";
    const status = typeof root.status === "string" ? root.status : "";
    return this.mapFinishReason(status);
  }
}
