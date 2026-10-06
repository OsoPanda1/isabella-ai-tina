import { config } from "@/lib/config";
import { secrets } from "@/lib/secrets";
import { SecuritySystem } from "@/lib/security";
import type { IntelligenceProvider, IntelligenceRequest, IntelligenceResponse } from "./contracts";
import { AnthropicTransport } from "./transports/anthropic";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION_HEADER = "2023-06-01";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A response with an empty content list and no payload is a completed turn,
 * not a malformed one: `validateResponse` only accepts that shape for the
 * terminal `end_turn`/`refusal` stop reasons, so reaching this check means the
 * turn legitimately ended without visible text.
 */
function completedWithoutPayload(raw: unknown): boolean {
  return isRecord(raw) && Array.isArray(raw.content) && raw.content.length === 0;
}

/**
 * Anthropic Messages API provider.
 *
 * Owns credentials, endpoint and the HTTP call; every payload conversion and
 * response normalization is delegated to {@link AnthropicTransport}. All
 * egress goes through `SecuritySystem.fetchSafeUpstream`, so the base URL must
 * resolve to an allowlisted host (`api.anthropic.com` by default, plus the
 * hostname declared in `ANTHROPIC_BASE_URL`).
 */
export class AnthropicProvider implements IntelligenceProvider {
  readonly providerId = "anthropic-messages";
  readonly modelId: string;
  readonly capabilities = new Set(["text"] as const);
  private readonly transport = new AnthropicTransport();
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(modelId: string) {
    this.modelId = modelId;
    this.apiKey = secrets.getOptional("ANTHROPIC_API_KEY");
    this.baseUrl = (config().ANTHROPIC_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, "");
  }

  async health(): Promise<boolean> {
    try {
      return Boolean(secrets.getOptional("ANTHROPIC_API_KEY"));
    } catch {
      return false;
    }
  }

  async invoke(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error("Anthropic API key is not configured");
    const started = performance.now();
    const kwargs = this.transport.buildKwargs(this.modelId, request.messages, undefined, {
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      baseUrl: this.baseUrl,
    });
    const upstream = await SecuritySystem.fetchSafeUpstream(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION_HEADER,
      },
      body: JSON.stringify(kwargs),
    });
    if (!upstream.ok) throw new Error(`Anthropic upstream returned ${upstream.status}`);
    const raw: unknown = await upstream.json();
    if (!this.transport.validateResponse(raw)) {
      throw new Error("Anthropic upstream returned a structurally invalid response");
    }
    const normalized = this.transport.normalizeResponse(raw);
    if (normalized.content === null && !normalized.toolCalls && !completedWithoutPayload(raw)) {
      throw new Error("Anthropic returned no text");
    }
    const cacheStats = this.transport.extractCacheStats(raw);
    const response: IntelligenceResponse = {
      requestId: request.requestId,
      modelId: this.modelId,
      providerId: this.providerId,
      text: normalized.content ?? "",
      latencyMs: performance.now() - started,
      degraded: false,
      risk: "LOW",
      finishReason: normalized.finishReason,
    };
    if (normalized.usage) {
      response.usage = {
        inputTokens: normalized.usage.promptTokens,
        outputTokens: normalized.usage.completionTokens,
        totalTokens: normalized.usage.totalTokens,
        ...(cacheStats
          ? {
              cachedTokens: cacheStats.cachedTokens,
              creationTokens: cacheStats.creationTokens,
            }
          : {}),
      };
    } else if (cacheStats) {
      response.usage = {
        cachedTokens: cacheStats.cachedTokens,
        creationTokens: cacheStats.creationTokens,
      };
    }
    if (normalized.toolCalls) response.toolCalls = normalized.toolCalls;
    if (normalized.reasoning) response.reasoning = normalized.reasoning;
    return response;
  }
}
