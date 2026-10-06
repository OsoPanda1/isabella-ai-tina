import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "@/lib/intelligence/http-provider";
import { OpenAICompatibleLocalProvider } from "@/lib/intelligence/openai-compatible-provider";
import { OllamaProvider } from "@/lib/intelligence/ollama-provider";
import { registerFreeAIFederation } from "@/lib/intelligence/free-ai-federation";
import { OpenAICompatibleTransport } from "@/lib/intelligence/transports/openai-compatible";
import type { OpenAIWireTool, TransportMessage } from "@/lib/intelligence/transports/types";
import type {
  IntelligenceProvider,
  IntelligenceMessage,
  IntelligenceRequest,
} from "@/lib/intelligence/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(responder: (url: string, init?: RequestInit) => Response) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    responder(String(input), init),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

type FetchMock = ReturnType<typeof stubFetch>;

function readBody(mock: FetchMock, callIndex = 0): Record<string, unknown> {
  const raw = mock.mock.calls[callIndex]?.[1]?.body;
  if (typeof raw !== "string") throw new Error("request body no serializado como string");
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("request body no es un objeto JSON");
  return parsed;
}

function requestedUrl(mock: FetchMock, callIndex = 0): string {
  return String(mock.mock.calls[callIndex]?.[0]);
}

function makeRequest(overrides: Partial<IntelligenceRequest> = {}): IntelligenceRequest {
  const messages: IntelligenceMessage[] = [
    { role: "system", content: "reglas" },
    { role: "user", content: "hola" },
  ];
  return {
    requestId: "req-test-1",
    tenantId: "tenant-1",
    actorId: "actor-1",
    messages,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OpenAICompatibleTransport", () => {
  const transport = new OpenAICompatibleTransport();
  const messages: TransportMessage[] = [
    { role: "system", content: "reglas" },
    { role: "user", content: "hola" },
  ];
  const tools: OpenAIWireTool[] = [
    {
      type: "function",
      function: {
        name: "buscar",
        description: "busca",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  it("declara apiMode chat_completions", () => {
    expect(transport.apiMode).toBe("chat_completions");
  });

  it("convertMessages devuelve la lista sin cambios", () => {
    const converted = transport.convertMessages(messages);
    expect(converted).toEqual(messages);
    expect(Array.isArray(converted)).toBe(true);
    const readonlyMessages: readonly TransportMessage[] = messages;
    expect(transport.convertMessages(readonlyMessages)).toEqual(readonlyMessages);
  });

  it("convertTools devuelve la lista sin cambios", () => {
    const converted = transport.convertTools(tools);
    expect(converted).toEqual(tools);
    expect(Array.isArray(converted)).toBe(true);
    const readonlyTools: readonly OpenAIWireTool[] = tools;
    expect(transport.convertTools(readonlyTools)).toEqual(readonlyTools);
  });

  it("buildKwargs aplica los defaults y no serializa undefined", () => {
    const kwargs = transport.buildKwargs("modelo-1", messages);
    expect(kwargs).toEqual({
      model: "modelo-1",
      messages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: false,
    });
    expect(Object.keys(kwargs).sort()).toEqual([
      "max_tokens",
      "messages",
      "model",
      "stream",
      "temperature",
    ]);
    expect(Object.values(kwargs)).not.toContain(undefined);
  });

  it("buildKwargs omite tools/top_p/stop/tool_choice cuando no se pasan", () => {
    const kwargs = transport.buildKwargs("modelo-1", messages, null, { maxTokens: 64 });
    expect(kwargs.tools).toBeUndefined();
    expect(kwargs.top_p).toBeUndefined();
    expect(kwargs.stop).toBeUndefined();
    expect(kwargs.tool_choice).toBeUndefined();
    expect(kwargs.max_tokens).toBe(64);
    expect(Object.values(kwargs)).not.toContain(undefined);
  });

  it("buildKwargs incluye tools/top_p/stop/tool_choice solo cuando se pasan", () => {
    const toolChoice: Record<string, unknown> = {
      type: "function",
      function: { name: "buscar" },
    };
    const kwargs = transport.buildKwargs("modelo-1", messages, tools, {
      temperature: 0.2,
      maxTokens: 128,
      topP: 0.9,
      stop: ["\n"],
      toolChoice,
    });
    expect(kwargs).toEqual({
      model: "modelo-1",
      messages,
      temperature: 0.2,
      max_tokens: 128,
      stream: false,
      tools,
      top_p: 0.9,
      stop: ["\n"],
      tool_choice: toolChoice,
    });
    expect(Object.values(kwargs)).not.toContain(undefined);
  });

  it("buildKwargs respeta temperature/maxTokens explicitamente definidos en 0", () => {
    const kwargs = transport.buildKwargs("modelo-1", messages, undefined, {
      temperature: 0,
      maxTokens: 0,
    });
    expect(kwargs.temperature).toBe(0);
    expect(kwargs.max_tokens).toBe(0);
  });

  it("normalizeResponse extrae texto, finish_reason y usage", () => {
    const normalized = transport.normalizeResponse({
      id: "chatcmpl-1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "respuesta" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    });
    expect(normalized).toEqual({
      content: "respuesta",
      toolCalls: null,
      finishReason: "stop",
      reasoning: null,
      usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      providerData: null,
    });
  });

  it("normalizeResponse convierte tool_calls con arguments string", () => {
    const normalized = transport.normalizeResponse({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "buscar", arguments: '{"q":"isabella"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(normalized.toolCalls).toEqual([
      { id: "call_1", name: "buscar", arguments: '{"q":"isabella"}' },
    ]);
    expect(normalized.content).toBeNull();
    expect(normalized.finishReason).toBe("tool_calls");
  });

  it("normalizeResponse convierte tool_calls con arguments objeto", () => {
    const normalized = transport.normalizeResponse({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_2", function: { name: "buscar", arguments: { q: "isabella" } } },
            ],
          },
        },
      ],
    });
    expect(normalized.toolCalls).toEqual([
      { id: "call_2", name: "buscar", arguments: '{"q":"isabella"}' },
    ]);
  });

  it("normalizeResponse mapea finish_reason desconocido o ausente a unknown", () => {
    const unknownReason = transport.normalizeResponse({
      choices: [{ message: { content: "x" }, finish_reason: "function_call" }],
    });
    expect(unknownReason.finishReason).toBe("unknown");
    const missingReason = transport.normalizeResponse({
      choices: [{ message: { content: "x" } }],
    });
    expect(missingReason.finishReason).toBe("unknown");
  });

  it("normalizeResponse extrae reasoning_content o reasoning", () => {
    const withContent = transport.normalizeResponse({
      choices: [{ message: { content: "", reasoning_content: "pienso" } }],
    });
    expect(withContent.reasoning).toBe("pienso");
    const withReasoning = transport.normalizeResponse({
      choices: [{ message: { content: "", reasoning: "tambien pienso" } }],
    });
    expect(withReasoning.reasoning).toBe("tambien pienso");
    const withoutReasoning = transport.normalizeResponse({
      choices: [{ message: { content: "ok" } }],
    });
    expect(withoutReasoning.reasoning).toBeNull();
  });

  it("extractCacheStats devuelve contadores de cache", () => {
    expect(
      transport.extractCacheStats({
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 42 },
          completion_tokens_details: { cache_creation_tokens: 9 },
        },
      }),
    ).toEqual({ cachedTokens: 42, creationTokens: 9 });
  });

  it("extractCacheStats devuelve null sin usage o con todo en cero", () => {
    expect(transport.extractCacheStats(undefined)).toBeNull();
    expect(transport.extractCacheStats(null)).toBeNull();
    expect(transport.extractCacheStats({})).toBeNull();
    expect(transport.extractCacheStats({ usage: { prompt_tokens: 3 } })).toBeNull();
    expect(
      transport.extractCacheStats({
        usage: {
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { cache_creation_tokens: 0 },
        },
      }),
    ).toBeNull();
  });

  it("validateResponse distingue payloads OpenAI validos de invalidos", () => {
    expect(transport.validateResponse(null)).toBe(false);
    expect(transport.validateResponse(undefined)).toBe(false);
    expect(transport.validateResponse({})).toBe(false);
    expect(transport.validateResponse({ choices: [] })).toBe(false);
    expect(transport.validateResponse({ choices: [{ message: { content: "x" } }] })).toBe(true);
  });
});

describe("OpenAICompatibleProvider (http)", () => {
  const provider = new OpenAICompatibleProvider({
    providerId: "acme-remote",
    modelId: "acme-1",
    endpoint: "https://api.acme.example/v1/chat/completions",
    apiKey: "test-key",
    timeoutMs: 1000,
  });

  it("conserva providerId, modelId, capabilities y health", async () => {
    expect(provider.providerId).toBe("acme-remote");
    expect(provider.modelId).toBe("acme-1");
    expect([...provider.capabilities]).toEqual(["text"]);
    await expect(provider.health()).resolves.toBe(true);
  });

  it("valida HTTPS y credencial en el constructor", () => {
    expect(
      () =>
        new OpenAICompatibleProvider({
          providerId: "acme-remote",
          modelId: "acme-1",
          endpoint: "http://api.acme.example/v1/chat/completions",
          apiKey: "test-key",
        }),
    ).toThrow("Intelligence upstream must use HTTPS");
    expect(
      () =>
        new OpenAICompatibleProvider({
          providerId: "acme-remote",
          modelId: "acme-1",
          endpoint: "https://api.acme.example/v1/chat/completions",
          apiKey: "",
        }),
    ).toThrow("Missing credential for acme-remote");
  });

  it("conserva headers, body chat_completions y propaga metadatos", async () => {
    const mock = stubFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: "  hola  ",
              reasoning_content: "paso 1",
              tool_calls: [{ id: "call_9", function: { name: "buscar", arguments: '{"q":1}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
          prompt_tokens_details: { cached_tokens: 1 },
        },
      }),
    );

    const response = await provider.invoke(makeRequest());

    expect(requestedUrl(mock)).toBe("https://api.acme.example/v1/chat/completions");
    const init = mock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeDefined();
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer test-key",
    });
    expect(readBody(mock)).toEqual({
      model: "acme-1",
      messages: makeRequest().messages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: false,
    });
    expect(response).toMatchObject({
      requestId: "req-test-1",
      modelId: "acme-1",
      providerId: "acme-remote",
      text: "  hola  ",
      degraded: false,
      risk: "LOW",
      finishReason: "tool_calls",
      reasoning: "paso 1",
      toolCalls: [{ id: "call_9", name: "buscar", arguments: '{"q":1}' }],
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
        cachedTokens: 1,
        creationTokens: 0,
      },
    });
  });

  it("mensajes de error de invoke identicos", async () => {
    stubFetch(() => jsonResponse({ error: "bad" }, 400));
    await expect(provider.invoke(makeRequest())).rejects.toThrow(
      "Upstream acme-remote returned 400",
    );

    stubFetch(() => jsonResponse({ choices: [{ message: { content: "" } }] }));
    await expect(provider.invoke(makeRequest())).rejects.toThrow(
      "Upstream acme-remote returned no text",
    );
  });
});

describe("OpenAICompatibleLocalProvider", () => {
  const provider = new OpenAICompatibleLocalProvider(
    "qwen-local",
    "http://127.0.0.1:8000/v1",
    "local-key",
  );

  it("conserva providerId, modelId, capabilities y health", async () => {
    expect(provider.providerId).toBe("openai-compatible-local");
    expect(provider.modelId).toBe("qwen-local");
    expect([...provider.capabilities]).toEqual(["text"]);

    const mock = stubFetch(() => jsonResponse({ data: [] }));
    await expect(provider.health()).resolves.toBe(true);
    expect(requestedUrl(mock)).toBe("http://127.0.0.1:8000/v1/models");
    expect(mock.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: "Bearer local-key",
    });
  });

  it("conserva body chat_completions, canal de egress local y trim", async () => {
    const mock = stubFetch(() =>
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "  hola  " }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      }),
    );

    const response = await provider.invoke(makeRequest({ temperature: 0.3, maxTokens: 64 }));

    expect(requestedUrl(mock)).toBe("http://127.0.0.1:8000/v1/chat/completions");
    expect(readBody(mock)).toEqual({
      model: "qwen-local",
      messages: makeRequest().messages,
      temperature: 0.3,
      max_tokens: 64,
      stream: false,
    });
    expect(response).toMatchObject({
      providerId: "openai-compatible-local",
      modelId: "qwen-local",
      text: "hola",
      degraded: true,
      risk: "LOW",
      finishReason: "stop",
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    });
  });

  it("mensajes de error de invoke identicos", async () => {
    stubFetch(() => jsonResponse({ error: "bad" }, 400));
    await expect(provider.invoke(makeRequest())).rejects.toThrow(
      "OpenAI-compatible upstream returned 400",
    );

    stubFetch(() => jsonResponse({ choices: [{ message: { content: "   " } }] }));
    await expect(provider.invoke(makeRequest())).rejects.toThrow(
      "OpenAI-compatible upstream returned no text",
    );
  });

  it("sigue usando el canal de egress local", async () => {
    const remote = new OpenAICompatibleLocalProvider(
      "qwen-local",
      "https://upstream.example/v1",
      "local-key",
    );
    await expect(remote.invoke(makeRequest())).rejects.toThrow("Endpoint no autorizado");
  });
});

describe("OllamaProvider", () => {
  const provider = new OllamaProvider("qwen3:8b", "http://127.0.0.1:11434");

  it("conserva providerId, modelId, capabilities y health", async () => {
    expect(provider.providerId).toBe("ollama-local");
    expect(provider.modelId).toBe("qwen3:8b");
    expect([...provider.capabilities]).toEqual(["text"]);

    const mock = stubFetch(() => jsonResponse({ models: [{ name: "qwen3:8b" }] }));
    await expect(provider.health()).resolves.toBe(true);
    expect(requestedUrl(mock)).toBe("http://127.0.0.1:11434/api/tags");
  });

  it("conserva el body /api/chat con options y su propio parseo", async () => {
    const mock = stubFetch(() =>
      jsonResponse({
        model: "qwen3:8b",
        message: { role: "assistant", content: "  hola  " },
        prompt_eval_count: 4,
        eval_count: 2,
        done_reason: "stop",
      }),
    );

    const response = await provider.invoke(makeRequest({ temperature: 0.3, maxTokens: 64 }));

    expect(requestedUrl(mock)).toBe("http://127.0.0.1:11434/api/chat");
    expect(readBody(mock)).toEqual({
      model: "qwen3:8b",
      stream: false,
      messages: makeRequest().messages,
      options: { temperature: 0.3, num_predict: 64 },
    });
    expect(response).toMatchObject({
      providerId: "ollama-local",
      modelId: "qwen3:8b",
      text: "hola",
      degraded: true,
      risk: "LOW",
      usage: { inputTokens: 4, outputTokens: 2 },
    });
    expect(response.usage?.totalTokens).toBeUndefined();
    expect(response.finishReason).toBeUndefined();
  });

  it("mensajes de error de invoke identicos", async () => {
    stubFetch(() => jsonResponse({ error: "bad" }, 400));
    await expect(provider.invoke(makeRequest())).rejects.toThrow("Ollama upstream returned 400");

    stubFetch(() => jsonResponse({ message: { content: "" }, done: true }));
    await expect(provider.invoke(makeRequest())).rejects.toThrow("Ollama returned no text");
  });
});

describe("FreeCompatibleProvider (federacion free AI)", () => {
  function registeredProviders(): IntelligenceProvider[] {
    vi.stubEnv("FREE_AI_FEDERATION_ENABLED", "true");
    vi.stubEnv(
      "FREE_AI_FEDERATION_ENDPOINTS",
      JSON.stringify([
        {
          id: "groq-free",
          label: "Groq free tier",
          baseUrl: "https://api.groq.com/v1",
          model: "llama-3.3-70b",
          requiresKey: true,
        },
        {
          id: "rogue",
          label: "Rogue",
          baseUrl: "https://evil.example/v1",
          model: "rogue-1",
          requiresKey: false,
        },
      ]),
    );
    const providers: IntelligenceProvider[] = [];
    registerFreeAIFederation((provider) => providers.push(provider));
    return providers;
  }

  function byId(providers: IntelligenceProvider[], providerId: string): IntelligenceProvider {
    const found = providers.find((provider) => provider.providerId === providerId);
    if (!found) throw new Error(`provider no registrado: ${providerId}`);
    return found;
  }

  it("conserva providerId, modelId, capabilities y health", async () => {
    const providers = registeredProviders();
    expect(providers).toHaveLength(2);
    const provider = byId(providers, "free-federation:groq-free");
    expect(provider.providerId).toBe("free-federation:groq-free");
    expect(provider.modelId).toBe("llama-3.3-70b");
    expect([...provider.capabilities]).toEqual(["text"]);

    const mock = stubFetch(() => jsonResponse({ data: [] }));
    await expect(provider.health()).resolves.toBe(true);
    expect(requestedUrl(mock)).toBe("https://api.groq.com/v1/models");
  });

  it("conserva body chat_completions, degraded/risk y trim", async () => {
    const provider = byId(registeredProviders(), "free-federation:groq-free");
    const mock = stubFetch(() =>
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "  hola  " }, finish_reason: "stop" }],
        usage: { prompt_tokens: 6, completion_tokens: 3, total_tokens: 9 },
      }),
    );

    const response = await provider.invoke(makeRequest());

    expect(requestedUrl(mock)).toBe("https://api.groq.com/v1/chat/completions");
    expect(mock.mock.calls[0]?.[1]?.headers).toEqual({ "content-type": "application/json" });
    expect(readBody(mock)).toEqual({
      model: "llama-3.3-70b",
      messages: makeRequest().messages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: false,
    });
    expect(response).toMatchObject({
      providerId: "free-federation:groq-free",
      modelId: "llama-3.3-70b",
      text: "hola",
      degraded: true,
      risk: "MEDIUM",
      finishReason: "stop",
      usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9 },
    });
  });

  it("mensajes de error de invoke identicos", async () => {
    const provider = byId(registeredProviders(), "free-federation:groq-free");

    stubFetch(() => jsonResponse({ error: "bad" }, 400));
    await expect(provider.invoke(makeRequest())).rejects.toThrow(
      "free federation upstream returned 400",
    );

    stubFetch(() => jsonResponse({ choices: [{ message: { content: "  " } }] }));
    await expect(provider.invoke(makeRequest())).rejects.toThrow(
      "free federation upstream returned no text",
    );
  });

  it("sigue usando el canal de egress remoto gobernado", async () => {
    const rogue = byId(registeredProviders(), "free-federation:rogue");
    await expect(rogue.invoke(makeRequest())).rejects.toThrow("Host no autorizado");
  });
});
