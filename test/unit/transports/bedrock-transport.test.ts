import { describe, it, expect } from "vitest";
import {
  BedrockTransport,
  BEDROCK_CONVERSE_SENTINEL,
  BEDROCK_REGION_SENTINEL,
  BEDROCK_DEFAULT_MAX_TOKENS,
} from "@/lib/intelligence/transports/bedrock";
import type { OpenAIWireTool, TransportMessage } from "@/lib/intelligence/transports/types";

/**
 * Contrato del transporte Bedrock Converse (test/unit/transports/bedrock-transport.test.ts)
 * Verifica el puerto del BedrockTransport de Python: system separado del listado
 * de turnos, toolSpec/toolConfig, centinelas de dispatch, normalización de la
 * forma cruda de Converse y de la forma ya normalizada con `choices`,
 * validateResponse y mapFinishReason. Ninguna prueba se ejecuta contra AWS.
 */

const transport = new BedrockTransport();

const WEATHER_TOOL: OpenAIWireTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Obtiene el clima de una ciudad",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

describe("BedrockTransport · identidad", () => {
  it("declara apiMode bedrock_converse", () => {
    expect(transport.apiMode).toBe("bedrock_converse");
  });
});

describe("BedrockTransport · convertMessages", () => {
  it("separa system en la lista superior y deja turnos con content:[{text}]", () => {
    const result = transport.convertMessages([
      { role: "system", content: "Eres un economista." },
      { role: "user", content: "Hola" },
      { role: "assistant", content: "Encantado" },
    ]);

    expect(result.system).toEqual([{ text: "Eres un economista." }]);
    expect(result.messages).toEqual([
      { role: "user", content: [{ text: "Hola" }] },
      { role: "assistant", content: [{ text: "Encantado" }] },
    ]);
    expect(result.messages.some((message) => message.role === "system")).toBe(false);
  });

  it("acumula varios system en orden y no genera turnos vacíos", () => {
    const messages: TransportMessage[] = [
      { role: "system", content: "Regla uno" },
      { role: "user", content: "Pregunta" },
      { role: "system", content: "Regla dos" },
    ];
    const result = transport.convertMessages(messages);

    expect(result.system).toEqual([{ text: "Regla uno" }, { text: "Regla dos" }]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("devuelve listas vacías sin mensajes", () => {
    expect(transport.convertMessages([])).toEqual({ system: [], messages: [] });
  });
});

describe("BedrockTransport · convertTools", () => {
  it("convierte la tool OpenAI a toolSpec con inputSchema.json", () => {
    expect(transport.convertTools([WEATHER_TOOL])).toEqual([
      {
        toolSpec: {
          name: "get_weather",
          description: "Obtiene el clima de una ciudad",
          inputSchema: {
            json: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
      },
    ]);
  });

  it("usa un JSON Schema por defecto y omite description cuando no existe", () => {
    const bare: OpenAIWireTool = { type: "function", function: { name: "noop" } };
    const [tool] = transport.convertTools([bare]);

    expect(tool.toolSpec.name).toBe("noop");
    expect(tool.toolSpec.description).toBeUndefined();
    expect(tool.toolSpec.inputSchema.json).toEqual({ type: "object", properties: {} });
  });
});

describe("BedrockTransport · buildKwargs", () => {
  const messages: TransportMessage[] = [
    { role: "system", content: "Sé breve" },
    { role: "user", content: "Hola" },
  ];

  it("incluye los centinelas de dispatch y los defaults del port", () => {
    const kwargs = transport.buildKwargs("amazon.titan-text-express-v1", messages);

    expect(kwargs[BEDROCK_CONVERSE_SENTINEL]).toBe(true);
    expect(kwargs[BEDROCK_REGION_SENTINEL]).toBe("us-east-1");
    expect(kwargs.model).toBe("amazon.titan-text-express-v1");
    expect(kwargs.inferenceConfig).toEqual({ maxTokens: BEDROCK_DEFAULT_MAX_TOKENS });
    expect(kwargs.inferenceConfig).toEqual({ maxTokens: 4096 });
    expect(kwargs.system).toEqual([{ text: "Sé breve" }]);
    expect(kwargs.messages).toEqual([{ role: "user", content: [{ text: "Hola" }] }]);
    expect(kwargs.toolConfig).toBeUndefined();
    expect(kwargs.guardrailConfig).toBeUndefined();
  });

  it("respeta region, maxTokens, temperature, toolConfig y guardrailConfig", () => {
    const kwargs = transport.buildKwargs("model-id", messages, [WEATHER_TOOL], {
      region: "eu-west-1",
      maxTokens: 128,
      temperature: 0.2,
      toolChoice: { auto: {} },
      guardrailConfig: { guardrailIdentifier: "guard-1", guardrailVersion: "1" },
    });

    expect(kwargs[BEDROCK_REGION_SENTINEL]).toBe("eu-west-1");
    expect(kwargs.inferenceConfig).toEqual({ maxTokens: 128, temperature: 0.2 });
    expect(kwargs.toolConfig).toEqual({
      tools: [
        {
          toolSpec: {
            name: "get_weather",
            description: "Obtiene el clima de una ciudad",
            inputSchema: {
              json: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
          },
        },
      ],
      toolChoice: { auto: {} },
    });
    expect(kwargs.guardrailConfig).toEqual({
      guardrailIdentifier: "guard-1",
      guardrailVersion: "1",
    });
  });

  it("omite temperature cuando no viene en params", () => {
    const kwargs = transport.buildKwargs("model-id", messages, null, { region: "us-west-2" });

    expect(kwargs.inferenceConfig).toEqual({ maxTokens: 4096 });
    expect(kwargs[BEDROCK_REGION_SENTINEL]).toBe("us-west-2");
  });
});

describe("BedrockTransport · normalizeResponse (forma cruda Converse)", () => {
  it("normaliza texto, stopReason y usage", () => {
    const normalized = transport.normalizeResponse({
      output: {
        message: { role: "assistant", content: [{ text: "Hola mundo" }] },
      },
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    expect(normalized.content).toBe("Hola mundo");
    expect(normalized.finishReason).toBe("stop");
    expect(normalized.toolCalls).toBeNull();
    expect(normalized.reasoning).toBeNull();
    expect(normalized.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(normalized.providerData).toBeNull();
  });

  it("convierte toolUse en toolCalls con arguments en JSON y mapea tool_use", () => {
    const normalized = transport.normalizeResponse({
      output: {
        message: {
          role: "assistant",
          content: [
            { toolUse: { toolUseId: "toolu_01", name: "get_weather", input: { city: "CDMX" } } },
          ],
        },
      },
      stopReason: "tool_use",
      usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
    });

    expect(normalized.content).toBeNull();
    expect(normalized.finishReason).toBe("tool_calls");
    expect(normalized.toolCalls).toEqual([
      { id: "toolu_01", name: "get_weather", arguments: JSON.stringify({ city: "CDMX" }) },
    ]);
  });

  it("concatena bloques de texto y lee reasoning desde reasoningContent", () => {
    const normalized = transport.normalizeResponse({
      output: {
        message: {
          role: "assistant",
          content: [
            { reasoningContent: { reasoningText: { text: "primero deduzco" } } },
            { text: "respuesta final" },
          ],
        },
      },
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });

    expect(normalized.content).toBe("respuesta final");
    expect(normalized.reasoning).toBe("primero deduzco");
  });

  it("devuelve usage null cuando la respuesta no trae usage", () => {
    const normalized = transport.normalizeResponse({
      output: { message: { role: "assistant", content: [{ text: "sin usage" }] } },
      stopReason: "end_turn",
    });

    expect(normalized.usage).toBeNull();
    expect(normalized.content).toBe("sin usage");
  });

  it("lanza ante una forma no reconocida en vez de fabricar contenido", () => {
    expect(() => transport.normalizeResponse({})).toThrow("bedrock_response_unrecognized_shape");
    expect(() => transport.normalizeResponse(undefined)).toThrow(
      "bedrock_response_unrecognized_shape",
    );
  });
});

describe("BedrockTransport · normalizeResponse (forma ya normalizada con choices)", () => {
  it("lee content, finishReason, reasoning y usage camelCase", () => {
    const normalized = transport.normalizeResponse({
      choices: [
        {
          message: { content: "respuesta normalizada", toolCalls: null, reasoning: "pensando" },
          finishReason: "stop",
        },
      ],
      usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
    });

    expect(normalized.content).toBe("respuesta normalizada");
    expect(normalized.finishReason).toBe("stop");
    expect(normalized.toolCalls).toBeNull();
    expect(normalized.reasoning).toBe("pensando");
    expect(normalized.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
  });

  it("aplana toolCalls anidados en function y acepta claves snake_case", () => {
    const normalized = transport.normalizeResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                function: { name: "get_weather", arguments: '{"city":"CDMX"}' },
              },
            ],
          },
          finish_reason: "tool_use",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });

    expect(normalized.content).toBeNull();
    expect(normalized.finishReason).toBe("tool_calls");
    expect(normalized.toolCalls).toEqual([
      { id: "call_1", name: "get_weather", arguments: '{"city":"CDMX"}' },
    ]);
    expect(normalized.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
  });
});

describe("BedrockTransport · validateResponse", () => {
  it("acepta dicts con output y choices con un elemento; rechaza el resto", () => {
    expect(transport.validateResponse(null)).toBe(false);
    expect(transport.validateResponse(undefined)).toBe(false);
    expect(transport.validateResponse({})).toBe(false);
    expect(transport.validateResponse({ output: { message: {} } })).toBe(true);
    expect(transport.validateResponse({ choices: [] })).toBe(false);
    expect(transport.validateResponse({ choices: [{}] })).toBe(true);
    expect(transport.validateResponse("respuesta inesperada")).toBe(false);
    expect(transport.validateResponse(42)).toBe(false);
  });
});

describe("BedrockTransport · mapFinishReason", () => {
  it("mapea los seis stopReason conocidos", () => {
    expect(transport.mapFinishReason("end_turn")).toBe("stop");
    expect(transport.mapFinishReason("tool_use")).toBe("tool_calls");
    expect(transport.mapFinishReason("max_tokens")).toBe("length");
    expect(transport.mapFinishReason("stop_sequence")).toBe("stop");
    expect(transport.mapFinishReason("guardrail_intervened")).toBe("content_filter");
    expect(transport.mapFinishReason("content_filtered")).toBe("content_filter");
  });

  it("usa stop como default para stopReason desconocidos", () => {
    expect(transport.mapFinishReason("malformed_tool_use")).toBe("stop");
    expect(transport.mapFinishReason("")).toBe("stop");
  });
});

describe("BedrockTransport · extractCacheStats", () => {
  it("lee los contadores de cache de usage y devuelve null si no existen", () => {
    expect(
      transport.extractCacheStats({
        usage: { cacheReadInputTokens: 120, cacheWriteInputTokens: 40 },
      }),
    ).toEqual({ cachedTokens: 120, creationTokens: 40 });
    expect(transport.extractCacheStats({ usage: { inputTokens: 5 } })).toBeNull();
    expect(transport.extractCacheStats({})).toBeNull();
  });
});
