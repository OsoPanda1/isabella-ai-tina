import { describe, expect, it } from "vitest";
import {
  ResponsesTransport,
  boundedPromptCacheKey,
  cacheScopeFromSessionId,
  contentCacheKey,
  renameReservedTools,
} from "@/lib/intelligence/transports/responses";
import { buildToolCall } from "@/lib/intelligence/transports/types";
import type { ResponsesTool } from "@/lib/intelligence/transports/responses";
import type { OpenAIWireTool, TransportMessage } from "@/lib/intelligence/transports/types";

const TOOLS: OpenAIWireTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Lee un archivo",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  },
];

const MESSAGES: TransportMessage[] = [
  { role: "system", content: "reglas" },
  { role: "user", content: "hola" },
];

const TEXT_OUTPUT = {
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: "hola" }] }],
};

describe("ResponsesTransport", () => {
  const transport = new ResponsesTransport();

  it("maneja el api mode responses", () => {
    expect(transport.apiMode).toBe("responses");
  });

  describe("convertMessages", () => {
    it("saca el system a instructions y convierte los turnos en items de entrada", () => {
      const converted = transport.convertMessages([
        { role: "system", content: "  Eres Isabella  " },
        { role: "user", content: "hola" },
        { role: "assistant", content: "buenas" },
      ]);
      expect(converted.instructions).toBe("Eres Isabella");
      expect(converted.input).toEqual([
        { role: "user", content: [{ type: "input_text", text: "hola" }] },
        { role: "assistant", content: [{ type: "output_text", text: "buenas" }] },
      ]);
    });

    it("omite instructions cuando no hay turno system", () => {
      const converted = transport.convertMessages([{ role: "user", content: "hola" }]);
      expect(converted).not.toHaveProperty("instructions");
      expect(converted.input).toEqual([
        { role: "user", content: [{ type: "input_text", text: "hola" }] },
      ]);
    });

    it("prefiere las instructions explícitas y nunca mete el system en input", () => {
      const converted = transport.convertMessages(
        [
          { role: "system", content: "reglas del sistema" },
          { role: "user", content: "hola" },
        ],
        { baseUrl: "https://example.com/v1", instructions: "identidad explícita" },
      );
      expect(converted.instructions).toBe("identidad explícita");
      expect(converted.input).toEqual([
        { role: "user", content: [{ type: "input_text", text: "hola" }] },
      ]);
    });

    it("concatena varios system con un salto de línea en blanco", () => {
      const converted = transport.convertMessages([
        { role: "system", content: "reglas" },
        { role: "system", content: "tono" },
        { role: "user", content: "hola" },
      ]);
      expect(converted.instructions).toBe("reglas\n\ntono");
    });
  });

  describe("convertTools", () => {
    it("aplana function a {type, name, description, parameters}", () => {
      expect(transport.convertTools(TOOLS)).toEqual([
        {
          type: "function",
          name: "read_file",
          description: "Lee un archivo",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      ]);
    });

    it("mantiene los campos opcionales ausentes en vez de undefined", () => {
      const converted = transport.convertTools([{ type: "function", function: { name: "ping" } }]);
      expect(converted).toEqual([{ type: "function", name: "ping" }]);
      expect(Object.keys(converted[0])).not.toContain("description");
      expect(Object.keys(converted[0])).not.toContain("parameters");
      expect(Object.values(converted[0]).every((value) => value !== undefined)).toBe(true);
    });
  });

  describe("buildKwargs", () => {
    it("construye model, input, instructions y store sin claves undefined", () => {
      const kwargs = transport.buildKwargs("gpt-test", MESSAGES, null, { temperature: 0.4 });
      expect(kwargs.model).toBe("gpt-test");
      expect(kwargs.instructions).toBe("reglas");
      expect(kwargs.store).toBe(false);
      expect(kwargs.input).toEqual([
        { role: "user", content: [{ type: "input_text", text: "hola" }] },
      ]);
      expect(kwargs.prompt_cache_key).toMatch(/^pck_[0-9a-f]{24}$/);
      expect(kwargs).not.toHaveProperty("temperature");
      expect(kwargs).not.toHaveProperty("top_p");
      expect(kwargs).not.toHaveProperty("stop");
      expect(kwargs).not.toHaveProperty("stream");
      expect(kwargs).not.toHaveProperty("max_output_tokens");
      expect(kwargs).not.toHaveProperty("tools");
      expect(kwargs).not.toHaveProperty("tool_choice");
      expect(kwargs).not.toHaveProperty("reasoning");
      expect(Object.values(kwargs).every((value) => value !== undefined)).toBe(true);
    });

    it("omite instructions y prompt_cache_key cuando no hay prefijo estático", () => {
      const kwargs = transport.buildKwargs("gpt-test", [{ role: "user", content: "hola" }]);
      expect(kwargs).not.toHaveProperty("instructions");
      expect(kwargs).not.toHaveProperty("prompt_cache_key");
      expect(Object.values(kwargs).every((value) => value !== undefined)).toBe(true);
    });

    it("usa params.instructions cuando el system viene por separado", () => {
      const kwargs = transport.buildKwargs("gpt-test", [{ role: "user", content: "hola" }], null, {
        instructions: "identidad",
      });
      expect(kwargs.instructions).toBe("identidad");
    });

    it("añade tools con tool_choice auto y parallel_tool_calls", () => {
      const kwargs = transport.buildKwargs("gpt-test", MESSAGES, TOOLS);
      expect(kwargs.tools).toEqual([
        {
          type: "function",
          name: "read_file",
          description: "Lee un archivo",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      ]);
      expect(kwargs.tool_choice).toBe("auto");
      expect(kwargs.parallel_tool_calls).toBe(true);
      expect(Object.values(kwargs).every((value) => value !== undefined)).toBe(true);
    });

    it("omite tools por completo cuando la lista está vacía", () => {
      const kwargs = transport.buildKwargs("gpt-test", MESSAGES, []);
      expect(kwargs).not.toHaveProperty("tools");
      expect(kwargs).not.toHaveProperty("tool_choice");
      expect(kwargs).not.toHaveProperty("parallel_tool_calls");
    });

    it("respeta un tool_choice explícito", () => {
      const kwargs = transport.buildKwargs("gpt-test", MESSAGES, TOOLS, {
        toolChoice: { type: "function", name: "read_file" },
      });
      expect(kwargs.tool_choice).toEqual({ type: "function", name: "read_file" });
    });

    it("mapea maxTokens a max_output_tokens y lo omite si no viene", () => {
      expect(
        transport.buildKwargs("gpt-test", MESSAGES, null, { maxTokens: 99 }).max_output_tokens,
      ).toBe(99);
      expect(transport.buildKwargs("gpt-test", MESSAGES, null)).not.toHaveProperty(
        "max_output_tokens",
      );
    });

    it("no envía reasoning por defecto", () => {
      expect(transport.buildKwargs("gpt-test", MESSAGES, null)).not.toHaveProperty("reasoning");
      expect(
        transport.buildKwargs("gpt-test", MESSAGES, null, { reasoningConfig: {} }),
      ).not.toHaveProperty("reasoning");
      expect(
        transport.buildKwargs("gpt-test", MESSAGES, null, {
          reasoningConfig: { effort: "high", enabled: false },
        }),
      ).not.toHaveProperty("reasoning");
    });

    it("usa reasoningConfig como objeto wire y retira el flag enabled", () => {
      const kwargs = transport.buildKwargs("gpt-test", MESSAGES, null, {
        reasoningConfig: { effort: "high", summary: "auto", enabled: true },
      });
      expect(kwargs.reasoning).toEqual({ effort: "high", summary: "auto" });
    });

    it("mergea requestOverrides después del shaping del transporte", () => {
      const kwargs = transport.buildKwargs("gpt-test", MESSAGES, null, {
        requestOverrides: { metadata: { origen: "isabella" } },
      });
      expect(kwargs.metadata).toEqual({ origen: "isabella" });
      expect(kwargs.store).toBe(false);
    });
  });

  describe("prompt_cache_key", () => {
    it("es estable entre llamadas con el mismo prefijo estático", () => {
      const first = transport.buildKwargs("gpt-test", MESSAGES, TOOLS);
      const second = transport.buildKwargs("gpt-test", MESSAGES, TOOLS);
      expect(first.prompt_cache_key).toMatch(/^pck_[0-9a-f]{24}$/);
      expect(first.prompt_cache_key).toBe(second.prompt_cache_key);
    });

    it("separa los ámbitos de sesión dentro del digest", () => {
      const one = transport.buildKwargs("gpt-test", MESSAGES, null, { sessionId: "sesion-1" });
      const other = transport.buildKwargs("gpt-test", MESSAGES, null, { sessionId: "sesion-2" });
      expect(one.prompt_cache_key).toMatch(/^pck_[0-9a-f]{24}$/);
      expect(one.prompt_cache_key).not.toBe(other.prompt_cache_key);
    });

    it("usa el scope crudo como clave cuando no hay prefijo estático", () => {
      const userOnly: TransportMessage[] = [{ role: "user", content: "hola" }];
      expect(
        transport.buildKwargs("gpt-test", userOnly, null, { sessionId: "sesion-1" })
          .prompt_cache_key,
      ).toBe("sesion-1");
      expect(
        transport.buildKwargs("gpt-test", userOnly, null, {
          sessionId: "sesion-2",
          cacheScopeId: "lineage-1",
        }).prompt_cache_key,
      ).toBe("lineage-1");
    });

    it("quita el timestamp por disparo de los session id de cron", () => {
      const kwargs = transport.buildKwargs("gpt-test", [{ role: "user", content: "hola" }], null, {
        sessionId: "cron_job-7_20261005_120000",
      });
      expect(kwargs.prompt_cache_key).toBe("cron_job-7");
    });

    it("acota la clave aunque llegue por requestOverrides", () => {
      const kwargs = transport.buildKwargs("gpt-test", MESSAGES, null, {
        requestOverrides: { prompt_cache_key: "k".repeat(80) },
      });
      expect(kwargs.prompt_cache_key).toMatch(/^pck_[0-9a-f]{24}$/);
    });

    it("elimina la clave cuando el override la anula", () => {
      const kwargs = transport.buildKwargs("gpt-test", MESSAGES, null, {
        requestOverrides: { prompt_cache_key: null },
      });
      expect(kwargs).not.toHaveProperty("prompt_cache_key");
    });

    it("respeta una clave corta explícita", () => {
      const kwargs = transport.buildKwargs("gpt-test", MESSAGES, null, {
        requestOverrides: { prompt_cache_key: "mi-clave" },
      });
      expect(kwargs.prompt_cache_key).toBe("mi-clave");
    });
  });

  describe("tools reservados en el wire", () => {
    const reserved: OpenAIWireTool[] = [{ type: "function", function: { name: "web_search" } }];

    it("aliasa los nombres reservados cuando el endpoint es opencode.ai", () => {
      const apex = transport.buildKwargs("gpt-test", MESSAGES, reserved, {
        baseUrl: "https://opencode.ai/v1",
      });
      expect(apex.tools).toEqual([{ type: "function", name: "isabella_web_search" }]);

      const gateway = transport.buildKwargs("gpt-test", MESSAGES, reserved, {
        baseUrl: "https://gateway.opencode.ai/v1",
      });
      expect(gateway.tools).toEqual([{ type: "function", name: "isabella_web_search" }]);
    });

    it("no aliasa en otros endpoints ni cuando el host solo aparece en la ruta", () => {
      const otherHost = transport.buildKwargs("gpt-test", MESSAGES, reserved, {
        baseUrl: "https://api.example.com/v1",
      });
      expect(otherHost.tools).toEqual([{ type: "function", name: "web_search" }]);

      const lookalike = transport.buildKwargs("gpt-test", MESSAGES, reserved, {
        baseUrl: "https://notopencode.ai/v1",
      });
      expect(lookalike.tools).toEqual([{ type: "function", name: "web_search" }]);

      const pathOnly = transport.buildKwargs("gpt-test", MESSAGES, reserved, {
        baseUrl: "https://api.example.com/opencode.ai/v1",
      });
      expect(pathOnly.tools).toEqual([{ type: "function", name: "web_search" }]);

      const noScheme = transport.buildKwargs("gpt-test", MESSAGES, reserved, {
        baseUrl: "gateway.opencode.ai/v1",
      });
      expect(noScheme.tools).toEqual([{ type: "function", name: "web_search" }]);
    });
  });

  describe("normalizeResponse", () => {
    it("concatena el texto de salida sin toolCalls ni providerData", () => {
      const normalized = transport.normalizeResponse(TEXT_OUTPUT);
      expect(normalized.content).toBe("hola");
      expect(normalized.toolCalls).toBeNull();
      expect(normalized.reasoning).toBeNull();
      expect(normalized.providerData).toBeNull();
      expect(normalized.usage).toBeNull();
      expect(normalized.finishReason).toBe("stop");
    });

    it("separa el razonamiento del texto visible", () => {
      const reasoningItem = {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "primero calculo" }],
      };
      const normalized = transport.normalizeResponse({
        status: "completed",
        output: [
          reasoningItem,
          { type: "message", content: [{ type: "output_text", text: "ok" }] },
        ],
      });
      expect(normalized.reasoning).toBe("primero calculo");
      expect(normalized.content).toBe("ok");
      expect(normalized.providerData).toEqual({ reasoning_details: [reasoningItem] });
    });

    it("construye function_call con call_id, item id y argumentos JSON", () => {
      const normalized = transport.normalizeResponse({
        status: "completed",
        output: [
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "read_file",
            arguments: '{"path":"a.txt"}',
          },
        ],
      });
      expect(normalized.toolCalls).toEqual([
        {
          id: "call_1",
          name: "read_file",
          arguments: '{"path":"a.txt"}',
          providerData: { call_id: "call_1", response_item_id: "fc_1" },
        },
      ]);
      expect(normalized.content).toBeNull();
      expect(normalized.finishReason).toBe("tool_calls");
    });

    it("recupera los alias de nombres reservados", () => {
      const normalized = transport.normalizeResponse({
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "isabella_web_search",
            arguments: "{}",
          },
          {
            type: "function_call",
            call_id: "call_2",
            name: "isabella_search_files",
            arguments: "{}",
          },
          { type: "function_call", call_id: "call_3", name: "read_file", arguments: "{}" },
        ],
      });
      expect(normalized.toolCalls?.map((call) => call.name)).toEqual([
        "web_search",
        "search_files",
        "read_file",
      ]);
    });

    it("serializa argumentos que no llegan como cadena y usa el nombre como id", () => {
      const normalized = transport.normalizeResponse({
        status: "completed",
        output: [{ type: "function_call", name: "ping", arguments: { hard: true } }],
      });
      expect(normalized.toolCalls).toEqual([
        { id: "ping", name: "ping", arguments: '{"hard":true}' },
      ]);
    });

    it("lee el uso de tokens de la respuesta", () => {
      expect(
        transport.normalizeResponse({
          ...TEXT_OUTPUT,
          usage: { input_tokens: 12, output_tokens: 7 },
        }).usage,
      ).toEqual({ promptTokens: 12, completionTokens: 7, totalTokens: 19 });
      expect(
        transport.normalizeResponse({
          ...TEXT_OUTPUT,
          usage: { input_tokens: 12, output_tokens: 7, total_tokens: 30 },
        }).usage,
      ).toEqual({ promptTokens: 12, completionTokens: 7, totalTokens: 30 });
    });

    it("mapea status e incomplete_details al vocabulario OpenAI", () => {
      const functionCall = {
        type: "function_call",
        call_id: "call_1",
        name: "read_file",
        arguments: "{}",
      };
      const expectations: Array<[Record<string, unknown>, string]> = [
        [{ status: "completed", output: [TEXT_OUTPUT.output[0]] }, "stop"],
        [{ status: "failed", output: [TEXT_OUTPUT.output[0]] }, "stop"],
        [{ status: "cancelled", output: [TEXT_OUTPUT.output[0]] }, "stop"],
        [{ status: "never_seen", output: [TEXT_OUTPUT.output[0]] }, "stop"],
        [{ output: [TEXT_OUTPUT.output[0]] }, "stop"],
        [{ status: "completed", output: [functionCall] }, "tool_calls"],
        [
          {
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: [TEXT_OUTPUT.output[0]],
          },
          "length",
        ],
        [
          {
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: [functionCall],
          },
          "length",
        ],
        [
          { status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] },
          "content_filter",
        ],
      ];
      for (const [response, finishReason] of expectations) {
        expect(transport.normalizeResponse(response).finishReason).toBe(finishReason);
      }
    });

    it("devuelve un estado vacío sin cuerpo como stop", () => {
      const normalized = transport.normalizeResponse(null);
      expect(normalized).toEqual({
        content: null,
        toolCalls: null,
        finishReason: "stop",
        reasoning: null,
        usage: null,
        providerData: null,
      });
    });
  });

  describe("validateResponse", () => {
    it("rechaza valores que no son un objeto con output", () => {
      expect(transport.validateResponse(null)).toBe(false);
      expect(transport.validateResponse(undefined)).toBe(false);
      expect(transport.validateResponse("resp_1")).toBe(false);
      expect(transport.validateResponse({ status: "completed" })).toBe(false);
      expect(transport.validateResponse({ status: "completed", output: "texto" })).toBe(false);
      expect(transport.validateResponse([])).toBe(false);
    });

    it("acepta un output no vacío y rechaza uno vacío en estado normal", () => {
      expect(transport.validateResponse({ status: "completed", output: [{}] })).toBe(true);
      expect(transport.validateResponse({ status: "completed", output: [] })).toBe(false);
      expect(transport.validateResponse({ output: [null] })).toBe(true);
    });

    it("acepta la negación por content filter con output vacío", () => {
      expect(
        transport.validateResponse({
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
          output: [],
        }),
      ).toBe(true);
      expect(
        transport.validateResponse({
          status: "INCOMPLETE",
          incomplete_details: { reason: "Content_Filter" },
          output: [],
        }),
      ).toBe(true);
      expect(
        transport.validateResponse({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [],
        }),
      ).toBe(false);
      expect(transport.validateResponse({ status: "incomplete", output: [] })).toBe(false);
    });
  });

  describe("extractCacheStats", () => {
    it("lee input_tokens_details.cached_tokens", () => {
      expect(
        transport.extractCacheStats({ usage: { input_tokens_details: { cached_tokens: 42 } } }),
      ).toEqual({ cachedTokens: 42, creationTokens: 0 });
    });

    it("devuelve null sin uso o sin actividad de caché", () => {
      expect(transport.extractCacheStats(null)).toBeNull();
      expect(transport.extractCacheStats({})).toBeNull();
      expect(transport.extractCacheStats({ usage: {} })).toBeNull();
      expect(transport.extractCacheStats({ usage: "roto" })).toBeNull();
      expect(
        transport.extractCacheStats({ usage: { input_tokens_details: { cached_tokens: 0 } } }),
      ).toBeNull();
    });
  });

  describe("mapFinishReason", () => {
    it("mapea los status de la Responses API", () => {
      expect(transport.mapFinishReason("completed")).toBe("stop");
      expect(transport.mapFinishReason("incomplete")).toBe("length");
      expect(transport.mapFinishReason("failed")).toBe("stop");
      expect(transport.mapFinishReason("cancelled")).toBe("stop");
      expect(transport.mapFinishReason("never_seen")).toBe("stop");
    });
  });
});

describe("cacheScopeFromSessionId", () => {
  it("quita el timestamp por disparo de los session id de cron", () => {
    expect(cacheScopeFromSessionId("cron_job-7_20261005_120000")).toBe("cron_job-7");
    expect(cacheScopeFromSessionId("cron_agent_abc_20261005_120000")).toBe("cron_agent_abc");
  });

  it("deja intactos el resto de identificadores", () => {
    expect(cacheScopeFromSessionId("main_run_42")).toBe("main_run_42");
    expect(cacheScopeFromSessionId("cron_job-7")).toBe("cron_job-7");
    expect(cacheScopeFromSessionId("")).toBe("");
    expect(cacheScopeFromSessionId(null)).toBe("");
    expect(cacheScopeFromSessionId(undefined)).toBe("");
  });
});

describe("boundedPromptCacheKey", () => {
  it("deja pasar las claves cortas recortadas", () => {
    expect(boundedPromptCacheKey("sesion-1")).toBe("sesion-1");
    expect(boundedPromptCacheKey("  sesion-1  ")).toBe("sesion-1");
    expect(boundedPromptCacheKey("k".repeat(64))).toBe("k".repeat(64));
  });

  it("colapsa las claves que superan 64 caracteres", () => {
    const longKey = "k".repeat(65);
    const bounded = boundedPromptCacheKey(longKey);
    expect(bounded).toMatch(/^pck_[0-9a-f]{24}$/);
    expect(bounded).not.toContain(longKey);
  });

  it("devuelve null para valores vacíos o ausentes", () => {
    expect(boundedPromptCacheKey(null)).toBeNull();
    expect(boundedPromptCacheKey(undefined)).toBeNull();
    expect(boundedPromptCacheKey("")).toBeNull();
    expect(boundedPromptCacheKey("   ")).toBeNull();
  });
});

describe("contentCacheKey", () => {
  it("devuelve null cuando no hay nada estático", () => {
    expect(contentCacheKey("", [], "scope")).toBeNull();
    expect(contentCacheKey("", [], "")).toBeNull();
  });

  it("prefija el digest con pck_ y 24 hex", () => {
    expect(contentCacheKey("reglas", [], "scope")).toMatch(/^pck_[0-9a-f]{24}$/);
  });

  it("separa ámbitos, instrucciones y tool set", () => {
    const tools = [{ type: "function", name: "ping" }];
    const base = contentCacheKey("reglas", tools, "scope-a");
    expect(contentCacheKey("reglas", tools, "scope-b")).not.toBe(base);
    expect(contentCacheKey("otras reglas", tools, "scope-a")).not.toBe(base);
    expect(contentCacheKey("reglas", [], "scope-a")).not.toBe(base);
  });

  it("no depende del orden de la lista de tools", () => {
    const ping = { type: "function", name: "ping" };
    const alpha = { type: "function", name: "alpha" };
    expect(contentCacheKey("reglas", [ping, alpha], "scope")).toBe(
      contentCacheKey("reglas", [alpha, ping], "scope"),
    );
  });

  it("no depende del orden de las claves del schema", () => {
    const first = {
      type: "function",
      name: "read_file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    };
    const reordered = {
      parameters: { properties: { path: { type: "string" } }, type: "object" },
      name: "read_file",
      type: "function",
    };
    expect(contentCacheKey("reglas", [first], "scope")).toBe(
      contentCacheKey("reglas", [reordered], "scope"),
    );
  });
});

describe("renameReservedTools", () => {
  const tools: ResponsesTool[] = [
    { type: "function", name: "web_search" },
    { type: "function", name: "search_files" },
    { type: "function", name: "read_file" },
  ];

  it("aliasa solo los nombres reservados", () => {
    expect(renameReservedTools(tools).map((tool) => tool.name)).toEqual([
      "isabella_web_search",
      "isabella_search_files",
      "read_file",
    ]);
  });

  it("devuelve una lista nueva sin tocar el original", () => {
    const rewritten = renameReservedTools(tools);
    expect(rewritten).not.toBe(tools);
    expect(tools.map((tool) => tool.name)).toEqual(["web_search", "search_files", "read_file"]);
    expect(rewritten[2]).toBe(tools[2]);
  });
});

describe("buildToolCall", () => {
  it("codifica objetos y conserva las cadenas", () => {
    expect(buildToolCall("call_1", "ping", { a: 1 })).toEqual({
      id: "call_1",
      name: "ping",
      arguments: '{"a":1}',
    });
    expect(buildToolCall("call_1", "ping", '{"a":1}').arguments).toBe('{"a":1}');
    expect(buildToolCall("call_1", "ping", undefined).arguments).toBe("{}");
  });

  it("reúne los campos de protocolo en providerData", () => {
    expect(buildToolCall("call_1", "ping", "{}", { call_id: "call_1" }).providerData).toEqual({
      call_id: "call_1",
    });
  });

  it("omite providerData cuando no hay campos de protocolo", () => {
    expect(buildToolCall("call_1", "ping", "{}")).not.toHaveProperty("providerData");
    expect(buildToolCall("call_1", "ping", "{}", null)).not.toHaveProperty("providerData");
    expect(buildToolCall("call_1", "ping", "{}", {})).not.toHaveProperty("providerData");
  });

  it("usa el nombre como id cuando el proveedor omite uno", () => {
    expect(buildToolCall(null, "ping", "{}").id).toBe("ping");
    expect(buildToolCall(undefined, "ping", "{}").id).toBe("ping");
    expect(buildToolCall("", "ping", "{}").id).toBe("ping");
  });
});
