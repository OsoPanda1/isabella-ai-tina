import type {
  IntelligenceProvider,
  IntelligenceRequest,
  IntelligenceResponse,
  Modality,
} from "./contracts";
import { OpenAICompatibleTransport } from "./transports/openai-compatible";

export interface HttpProviderOptions {
  providerId: string;
  modelId: string;
  endpoint: string;
  apiKey: string;
  modalities?: Modality[];
  timeoutMs?: number;
}

function assertHttps(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost")
    throw new Error("Intelligence upstream must use HTTPS");
}

const transport = new OpenAICompatibleTransport();

export class OpenAICompatibleProvider implements IntelligenceProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly capabilities: ReadonlySet<Modality>;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: HttpProviderOptions) {
    assertHttps(options.endpoint);
    if (!options.apiKey) throw new Error(`Missing credential for ${options.providerId}`);
    this.providerId = options.providerId;
    this.modelId = options.modelId;
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 8500;
    this.capabilities = new Set(options.modalities ?? ["text"]);
  }

  async health(): Promise<boolean> {
    return true;
  }

  async invoke(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = performance.now();
    try {
      const kwargs = transport.buildKwargs(this.modelId, request.messages, null, {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      });
      const response = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(kwargs),
      });
      if (!response.ok) throw new Error(`Upstream ${this.providerId} returned ${response.status}`);
      const payload: unknown = await response.json();
      const normalized = transport.normalizeResponse(payload);
      const text = normalized.content;
      if (!text) throw new Error(`Upstream ${this.providerId} returned no text`);
      const cache = transport.extractCacheStats(payload);
      return {
        requestId: request.requestId,
        modelId: this.modelId,
        providerId: this.providerId,
        text,
        latencyMs: performance.now() - started,
        degraded: false,
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
    } finally {
      clearTimeout(timer);
    }
  }
}
