import { config } from "@/lib/config";
import { SecuritySystem } from "@/lib/security";
import { OpenAICompatibleTransport } from "./transports/openai-compatible";
import type { IntelligenceProvider, IntelligenceRequest, IntelligenceResponse } from "./contracts";

const transport = new OpenAICompatibleTransport();

export type FreeAIEndpoint = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  license: "local-open-weight" | "provider-free-tier";
  requiresKey: boolean;
};

/**
 * A governed catalog, not a claim that a provider is permanently free or certified.
 * Local inference is the only zero-cost path. Remote endpoints are opt-in and must
 * be supplied by the operator so terms, residency, quotas and privacy can be checked.
 */
export const FREE_AI_CATALOG = [
  { id: "ollama", label: "Ollama local", license: "local-open-weight" },
  { id: "llama-cpp", label: "llama.cpp / vLLM", license: "local-open-weight" },
  { id: "lm-studio", label: "LM Studio local", license: "local-open-weight" },
  { id: "provider-free-tier", label: "Operator-approved free tier", license: "provider-free-tier" },
] as const;

function parseEndpoints(raw: string | undefined): FreeAIEndpoint[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): FreeAIEndpoint[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Record<string, unknown>;
      const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
      const baseUrl = typeof candidate.baseUrl === "string" ? candidate.baseUrl.trim() : "";
      const model = typeof candidate.model === "string" ? candidate.model.trim() : "";
      const label = typeof candidate.label === "string" ? candidate.label.trim() : id;
      const requiresKey = candidate.requiresKey === true;
      if (!id || !model || !/^https:\/\//i.test(baseUrl) || !/^[a-zA-Z0-9._:/-]+$/.test(model))
        return [];
      return [
        {
          id,
          label,
          baseUrl: baseUrl.replace(/\/$/, ""),
          model,
          license: requiresKey ? "provider-free-tier" : "local-open-weight",
          requiresKey,
        },
      ];
    });
  } catch {
    return [];
  }
}

class FreeCompatibleProvider implements IntelligenceProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly capabilities = new Set(["text"] as const);
  constructor(private readonly endpoint: FreeAIEndpoint) {
    this.providerId = `free-federation:${endpoint.id}`;
    this.modelId = endpoint.model;
  }
  async health(): Promise<boolean> {
    try {
      const response = await SecuritySystem.fetchSafeUpstream(`${this.endpoint.baseUrl}/models`, {
        method: "GET",
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  async invoke(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    const started = performance.now();
    const kwargs = transport.buildKwargs(this.modelId, request.messages, null, {
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });
    const response = await SecuritySystem.fetchSafeUpstream(
      `${this.endpoint.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kwargs),
      },
    );
    if (!response.ok) throw new Error(`free federation upstream returned ${response.status}`);
    const payload: unknown = await response.json();
    const normalized = transport.normalizeResponse(payload);
    const text = normalized.content?.trim();
    if (!text) throw new Error("free federation upstream returned no text");
    const cache = transport.extractCacheStats(payload);
    return {
      requestId: request.requestId,
      modelId: this.modelId,
      providerId: this.providerId,
      text,
      latencyMs: performance.now() - started,
      degraded: true,
      risk: "MEDIUM",
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

export function registerFreeAIFederation(
  register: (provider: IntelligenceProvider) => void,
): FreeAIEndpoint[] {
  const runtime = config();
  if (!runtime.FREE_AI_FEDERATION_ENABLED) return [];
  const endpoints = parseEndpoints(runtime.FREE_AI_FEDERATION_ENDPOINTS);
  for (const endpoint of endpoints) register(new FreeCompatibleProvider(endpoint));
  return endpoints;
}

export function getFreeAICatalog() {
  return FREE_AI_CATALOG;
}

export function parseFreeAIEndpoints(raw?: string): FreeAIEndpoint[] {
  return parseEndpoints(raw);
}
