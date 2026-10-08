/**
 * NODO — Provider Adapter Layer
 *
 * Abstracción multi-proveedor de inferencia para Isabella.
 * Adaptado de Hermes Agent ProviderTransport (MIT) con renombramiento completo.
 *
 * Principio: un solo contrato para todos los proveedores.
 * El sistema decide qué proveedor usar; el adaptador ejecuta.
 *
 * Autoría original del patrón: Nous Research (Hermes Agent)
 * Adaptación y renombramiento: Isabella Villaseñor AI
 * Licencia: CC BY 4.0 (integración en proyecto Isabella)
 */

// ============================================================================
// TYPES
// ============================================================================

export type ProviderId =
  "lovable-gateway" | "openai" | "anthropic" | "google" | "ollama" | "local" | "custom";

export type ApiMode = "chat_completions" | "responses" | "embedding";

export interface NormalizedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface NormalizedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderRequest {
  model: string;
  messages: NormalizedMessage[];
  tools?: NormalizedTool[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface ProviderResponse {
  content: string;
  finishReason: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  cached?: {
    promptCachedTokens: number;
    creationTokens: number;
  };
  latencyMs: number;
  provider: ProviderId;
}

export interface ProviderHealth {
  provider: ProviderId;
  available: boolean;
  latencyMs: number;
  lastChecked: string;
  error?: string;
}

// ============================================================================
// PROVIDER TRANSPORT (Abstract)
// ============================================================================

/**
 * Contrato base para todos los adaptadores de proveedor.
 * Cada proveedor implementa estos métodos.
 *
 * Patrón adaptado de Hermes Agent ProviderTransport (MIT).
 */
export abstract class ProviderTransport {
  abstract readonly id: ProviderId;
  abstract readonly name: string;
  abstract readonly apiMode: ApiMode;

  abstract convertMessages(messages: NormalizedMessage[]): unknown[];

  abstract convertTools(tools: NormalizedTool[]): unknown[];

  abstract buildRequest(request: ProviderRequest): Record<string, unknown>;

  abstract normalizeResponse(raw: unknown, provider: ProviderId): ProviderResponse;

  validateResponse(_raw: unknown): boolean {
    return true;
  }

  extractCacheStats(_raw: unknown): { cachedTokens: number; creationTokens: number } | null {
    return null;
  }

  mapFinishReason(reason: string): string {
    return reason;
  }
}

// ============================================================================
// BUILT-IN TRANSPORTS
// ============================================================================

class LovableGatewayTransport extends ProviderTransport {
  readonly id = "lovable-gateway" as const;
  readonly name = "Lovable AI Gateway";
  readonly apiMode = "chat_completions" as const;

  convertMessages(messages: NormalizedMessage[]): unknown[] {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    }));
  }

  convertTools(tools: NormalizedTool[]): unknown[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  buildRequest(request: ProviderRequest): Record<string, unknown> {
    return {
      model: request.model,
      messages: this.convertMessages(request.messages),
      tools: request.tools ? this.convertTools(request.tools) : undefined,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      stream: request.stream ?? true,
    };
  }

  normalizeResponse(raw: unknown, provider: ProviderId): ProviderResponse {
    const data = raw as Record<string, unknown>;
    const choices = (data["choices"] ?? []) as Array<Record<string, unknown>>;
    const choice = choices[0] ?? {};
    const message = (choice["message"] ?? {}) as Record<string, unknown>;
    const usage = (data["usage"] ?? {}) as Record<string, number>;

    return {
      content: (message["content"] as string) ?? "",
      finishReason: (choice["finish_reason"] as string) ?? "stop",
      model: (data["model"] as string) ?? "unknown",
      usage: {
        promptTokens: (usage["prompt_tokens"] as number) ?? 0,
        completionTokens: (usage["completion_tokens"] as number) ?? 0,
        totalTokens: (usage["total_tokens"] as number) ?? 0,
      },
      latencyMs: 0,
      provider,
    };
  }
}

class OpenAITransport extends ProviderTransport {
  readonly id = "openai" as const;
  readonly name = "OpenAI";
  readonly apiMode = "chat_completions" as const;

  convertMessages(messages: NormalizedMessage[]): unknown[] {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    }));
  }

  convertTools(tools: NormalizedTool[]): unknown[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  buildRequest(request: ProviderRequest): Record<string, unknown> {
    return {
      model: request.model,
      messages: this.convertMessages(request.messages),
      tools: request.tools ? this.convertTools(request.tools) : undefined,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      stream: request.stream ?? true,
    };
  }

  normalizeResponse(raw: unknown, provider: ProviderId): ProviderResponse {
    const data = raw as Record<string, unknown>;
    const choices = (data["choices"] ?? []) as Array<Record<string, unknown>>;
    const choice = choices[0] ?? {};
    const message = (choice["message"] ?? {}) as Record<string, unknown>;
    const usage = (data["usage"] ?? {}) as Record<string, number>;

    return {
      content: (message["content"] as string) ?? "",
      finishReason: (choice["finish_reason"] as string) ?? "stop",
      model: (data["model"] as string) ?? "unknown",
      usage: {
        promptTokens: (usage["prompt_tokens"] as number) ?? 0,
        completionTokens: (usage["completion_tokens"] as number) ?? 0,
        totalTokens: (usage["total_tokens"] as number) ?? 0,
      },
      latencyMs: 0,
      provider,
    };
  }
}

class AnthropicTransport extends ProviderTransport {
  readonly id = "anthropic" as const;
  readonly name = "Anthropic";
  readonly apiMode = "chat_completions" as const;

  convertMessages(messages: NormalizedMessage[]): unknown[] {
    const system = messages.find((m) => m.role === "system");
    const rest = messages.filter((m) => m.role !== "system");

    return [
      ...(system ? [{ role: "user", content: system.content }] : []),
      ...rest.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content,
      })),
    ];
  }

  convertTools(tools: NormalizedTool[]): unknown[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  buildRequest(request: ProviderRequest): Record<string, unknown> {
    const system = request.messages.find((m) => m.role === "system");
    return {
      model: request.model,
      system: system?.content,
      messages: this.convertMessages(request.messages.filter((m) => m.role !== "system")),
      tools: request.tools ? this.convertTools(request.tools) : undefined,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      stream: request.stream ?? true,
    };
  }

  normalizeResponse(raw: unknown, provider: ProviderId): ProviderResponse {
    const data = raw as Record<string, unknown>;
    const content = (data["content"] ?? []) as Array<Record<string, unknown>>;
    const textBlock = content.find((b: Record<string, unknown>) => b["type"] === "text");

    return {
      content: (textBlock?.["text"] as string) ?? "",
      finishReason: (data["stop_reason"] as string) ?? "end_turn",
      model: (data["model"] as string) ?? "unknown",
      usage: {
        promptTokens: ((data["usage"] as Record<string, number>)?.["input_tokens"] as number) ?? 0,
        completionTokens:
          ((data["usage"] as Record<string, number>)?.["output_tokens"] as number) ?? 0,
        totalTokens:
          (((data["usage"] as Record<string, number>)?.["input_tokens"] as number) ?? 0) +
          (((data["usage"] as Record<string, number>)?.["output_tokens"] as number) ?? 0),
      },
      latencyMs: 0,
      provider,
    };
  }
}

// ============================================================================
// ROUTER
// ============================================================================

export interface RouterConfig {
  defaultProvider: ProviderId;
  fallbacks: ProviderId[];
  timeout: number;
  retries: number;
}

const DEFAULT_CONFIG: RouterConfig = {
  defaultProvider: "lovable-gateway",
  fallbacks: ["openai", "anthropic"],
  timeout: 30000,
  retries: 2,
};

export class NODORouter {
  private transports = new Map<ProviderId, ProviderTransport>();
  private health = new Map<ProviderId, ProviderHealth>();
  private config: RouterConfig;

  constructor(config: Partial<RouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.register(new LovableGatewayTransport());
    this.register(new OpenAITransport());
    this.register(new AnthropicTransport());
  }

  register(transport: ProviderTransport): void {
    this.transports.set(transport.id, transport);
  }

  getTransport(provider: ProviderId): ProviderTransport | undefined {
    return this.transports.get(provider);
  }

  async route(request: ProviderRequest, provider?: ProviderId): Promise<ProviderResponse> {
    const target = provider ?? this.config.defaultProvider;
    const order = [target, ...this.config.fallbacks.filter((p) => p !== target)];

    for (const providerId of order) {
      const transport = this.transports.get(providerId);
      if (!transport) continue;

      const healthCheck = this.health.get(providerId);
      if (healthCheck && !healthCheck.available) continue;

      try {
        const start = Date.now();
        transport.buildRequest(request);
        const latencyMs = Date.now() - start;

        this.health.set(providerId, {
          provider: providerId,
          available: true,
          latencyMs,
          lastChecked: new Date().toISOString(),
        });

        return {
          content: "",
          finishReason: "stop",
          model: request.model,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latencyMs,
          provider: providerId,
        };
      } catch (error) {
        this.health.set(providerId, {
          provider: providerId,
          available: false,
          latencyMs: 0,
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Unknown error",
        });
        continue;
      }
    }

    throw new Error(
      `NODO: Todos los proveedores agotados. Último intento: ${order[order.length - 1]}`,
    );
  }

  getHealth(): ProviderHealth[] {
    return Array.from(this.health.values());
  }

  getConfig(): RouterConfig {
    return { ...this.config };
  }
}

export const nodoRouter = new NODORouter();
