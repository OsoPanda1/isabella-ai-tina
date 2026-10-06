import { localProviderConfig } from "./local-provider-config";
import { fetchSafeLocalModel } from "./local-egress";
import { OpenAICompatibleTransport } from "./transports/openai-compatible";
import type { IntelligenceProvider, IntelligenceRequest, IntelligenceResponse } from "./contracts";

const transport = new OpenAICompatibleTransport();

/** Adapter for self-hosted vLLM/llama.cpp/LM Studio and similar OpenAI-compatible runtimes. */
export class OpenAICompatibleLocalProvider implements IntelligenceProvider {
  readonly providerId = "openai-compatible-local";
  readonly modelId: string;
  readonly capabilities = new Set(["text"] as const);
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(modelId?: string, baseUrl?: string, apiKey?: string) {
    const runtime = localProviderConfig();
    this.modelId = modelId ?? runtime.openaiCompatibleModel;
    this.baseUrl = (baseUrl ?? runtime.openaiCompatibleBaseUrl).replace(/\/$/, "");
    this.apiKey = apiKey ?? runtime.openaiCompatibleApiKey;
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetchSafeLocalModel(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async invoke(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    const started = performance.now();
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const kwargs = transport.buildKwargs(this.modelId, request.messages, null, {
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });
    const response = await fetchSafeLocalModel(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(kwargs),
    });
    if (!response.ok) throw new Error(`OpenAI-compatible upstream returned ${response.status}`);
    const payload: unknown = await response.json();
    const normalized = transport.normalizeResponse(payload);
    const text = normalized.content?.trim();
    if (!text) throw new Error("OpenAI-compatible upstream returned no text");
    const cache = transport.extractCacheStats(payload);
    return {
      requestId: request.requestId,
      modelId: this.modelId,
      providerId: this.providerId,
      text,
      latencyMs: performance.now() - started,
      degraded: true,
      risk: "LOW",
      usage: {
        inputTokens: normalized.usage?.promptTokens,
        outputTokens: normalized.usage?.completionTokens,
        ...(normalized.usage ? { totalTokens: normalized.usage.totalTokens } : {}),
        ...(cache
          ? { cachedTokens: cache.cachedTokens, creationTokens: cache.creationTokens }
          : {}),
      },
      ...(normalized.finishReason !== "unknown" ? { finishReason: normalized.finishReason } : {}),
      ...(normalized.toolCalls ? { toolCalls: normalized.toolCalls } : {}),
      ...(normalized.reasoning ? { reasoning: normalized.reasoning } : {}),
    };
  }
}
