import { describe, expect, it } from "vitest";
import { AnthropicTransport } from "@/lib/intelligence/transports/anthropic";
import type { OpenAIWireTool } from "@/lib/intelligence/transports/types";

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

function toolCallName(registered: readonly string[], wireName: string): string | undefined {
  const transport = new AnthropicTransport(new Set(registered));
  const normalized = transport.normalizeResponse({
    content: [{ type: "tool_use", id: "toolu_1", name: wireName, input: {} }],
    stop_reason: "tool_use",
  });
  return normalized.toolCalls?.[0]?.name;
}

describe("AnthropicTransport", () => {
  it("handles the anthropic_messages api mode", () => {
    expect(new AnthropicTransport().apiMode).toBe("anthropic_messages");
  });

  describe("convertMessages", () => {
    it("hoists system into the system field and keeps user/assistant turns", () => {
      const converted = new AnthropicTransport().convertMessages([
        { role: "system", content: "Eres Isabella" },
        { role: "user", content: "hola" },
        { role: "assistant", content: "buenas" },
      ]);
      expect(converted.system).toBe("Eres Isabella");
      expect(converted.messages).toEqual([
        { role: "user", content: "hola" },
        { role: "assistant", content: "buenas" },
      ]);
    });

    it("omits the system key when no system message exists", () => {
      const converted = new AnthropicTransport().convertMessages([
        { role: "user", content: "hola" },
      ]);
      expect(converted).not.toHaveProperty("system");
      expect(converted.messages).toEqual([{ role: "user", content: "hola" }]);
    });
  });

  describe("convertTools", () => {
    it("maps OpenAI function tools onto {name, description, input_schema}", () => {
      expect(new AnthropicTransport().convertTools(TOOLS)).toEqual([
        {
          name: "read_file",
          description: "Lee un archivo",
          input_schema: { type: "object", properties: { path: { type: "string" } } },
        },
      ]);
    });

    it("keeps optional fields absent instead of undefined", () => {
      const converted = new AnthropicTransport().convertTools([
        { type: "function", function: { name: "ping" } },
      ]);
      expect(converted).toEqual([
        { name: "ping", input_schema: { type: "object", properties: {} } },
      ]);
      expect(Object.keys(converted[0])).not.toContain("description");
    });
  });

  describe("buildKwargs", () => {
    it("builds model, max_tokens (default 16384) and temperature without undefined keys", () => {
      const kwargs = new AnthropicTransport().buildKwargs(
        "claude-test",
        [{ role: "user", content: "hola" }],
        null,
        { temperature: 0.4 },
      );
      expect(kwargs.model).toBe("claude-test");
      expect(kwargs.max_tokens).toBe(16384);
      expect(kwargs.temperature).toBe(0.4);
      expect(kwargs.messages).toEqual([{ role: "user", content: "hola" }]);
      expect(kwargs).not.toHaveProperty("system");
      expect(kwargs).not.toHaveProperty("tools");
      expect(kwargs).not.toHaveProperty("top_p");
      expect(kwargs).not.toHaveProperty("stop");
      expect(kwargs).not.toHaveProperty("tool_choice");
      expect(kwargs).not.toHaveProperty("thinking");
      expect(Object.values(kwargs).every((value) => value !== undefined)).toBe(true);
    });

    it("honours explicit max_tokens and forwards system, tools and optional params", () => {
      const kwargs = new AnthropicTransport().buildKwargs(
        "claude-test",
        [
          { role: "system", content: "reglas" },
          { role: "user", content: "hola" },
        ],
        TOOLS,
        {
          maxTokens: 99,
          topP: 0.9,
          stop: ["END"],
          toolChoice: { type: "auto" },
          reasoningConfig: { type: "enabled", budget_tokens: 2048 },
        },
      );
      expect(kwargs.max_tokens).toBe(99);
      expect(kwargs.system).toBe("reglas");
      expect(kwargs.top_p).toBe(0.9);
      expect(kwargs.stop).toEqual(["END"]);
      expect(kwargs.tool_choice).toEqual({ type: "auto" });
      expect(kwargs.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
      expect(kwargs.tools).toEqual([
        {
          name: "read_file",
          description: "Lee un archivo",
          input_schema: { type: "object", properties: { path: { type: "string" } } },
        },
      ]);
      expect(Object.values(kwargs).every((value) => value !== undefined)).toBe(true);
    });
  });

  describe("normalizeResponse", () => {
    it("extracts plain text and maps end_turn to stop", () => {
      const normalized = new AnthropicTransport().normalizeResponse({
        content: [{ type: "text", text: "hola mundo" }],
        stop_reason: "end_turn",
      });
      expect(normalized.content).toBe("hola mundo");
      expect(normalized.reasoning).toBeNull();
      expect(normalized.toolCalls).toBeNull();
      expect(normalized.finishReason).toBe("stop");
    });

    it("separates thinking from the visible text", () => {
      const normalized = new AnthropicTransport().normalizeResponse({
        content: [
          { type: "thinking", thinking: "primero calculo", signature: "sig-1" },
          { type: "text", text: "respuesta" },
        ],
        stop_reason: "end_turn",
      });
      expect(normalized.reasoning).toBe("primero calculo");
      expect(normalized.content).toBe("respuesta");
      expect(normalized.finishReason).toBe("stop");
    });

    it("collects tool_use blocks with JSON-encoded arguments", () => {
      const normalized = new AnthropicTransport().normalizeResponse({
        content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.txt" } }],
        stop_reason: "tool_use",
      });
      expect(normalized.toolCalls).toEqual([
        { id: "toolu_1", name: "read_file", arguments: '{"path":"a.txt"}' },
      ]);
      expect(normalized.content).toBeNull();
      expect(normalized.finishReason).toBe("tool_calls");
    });

    it("maps stop reasons onto the OpenAI vocabulary", () => {
      const transport = new AnthropicTransport();
      const expectations: Array<[string, string]> = [
        ["end_turn", "stop"],
        ["tool_use", "tool_calls"],
        ["max_tokens", "length"],
        ["refusal", "content_filter"],
      ];
      for (const [stopReason, finishReason] of expectations) {
        const normalized = transport.normalizeResponse({
          content: [{ type: "text", text: "x" }],
          stop_reason: stopReason,
        });
        expect(normalized.finishReason).toBe(finishReason);
      }
      expect(
        transport.normalizeResponse({ content: [], stop_reason: "not_a_reason" }).finishReason,
      ).toBe("stop");
    });

    it("reports Anthropic token usage as transport usage", () => {
      const normalized = new AnthropicTransport().normalizeResponse({
        content: [{ type: "text", text: "hola" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 7 },
      });
      expect(normalized.usage).toEqual({ promptTokens: 12, completionTokens: 7, totalTokens: 19 });
    });

    it("preserves the exact block order when thinking and tool_use interleave", () => {
      const transport = new AnthropicTransport();
      const thinkingThenTools = transport.normalizeResponse({
        content: [
          { type: "thinking", thinking: "paso 1", signature: "sig-1" },
          { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.txt" } },
        ],
        stop_reason: "tool_use",
      });
      expect(thinkingThenTools.providerData).toEqual({
        reasoning_details: [{ type: "thinking", thinking: "paso 1", signature: "sig-1" }],
        anthropic_content_blocks: [
          { type: "thinking", thinking: "paso 1", signature: "sig-1" },
          { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.txt" } },
        ],
      });

      const toolsThenThinking = transport.normalizeResponse({
        content: [
          { type: "tool_use", id: "toolu_2", name: "read_file", input: {} },
          { type: "thinking", thinking: "paso 2", signature: "sig-2" },
        ],
        stop_reason: "tool_use",
      });
      expect(toolsThenThinking.providerData).toEqual({
        reasoning_details: [{ type: "thinking", thinking: "paso 2", signature: "sig-2" }],
        anthropic_content_blocks: [
          { type: "tool_use", id: "toolu_2", name: "read_file", input: {} },
          { type: "thinking", thinking: "paso 2", signature: "sig-2" },
        ],
      });
    });

    it("drops non-replayable block fields before persisting them", () => {
      const normalized = new AnthropicTransport().normalizeResponse({
        content: [
          {
            type: "thinking",
            thinking: "paso 1",
            signature: "sig-1",
            parsed_output: { internal: true },
            caller: "runner",
          },
          { type: "text", text: "ok", citations: [{ url: "https://example.com" }] },
          { type: "tool_use", id: "toolu_1", name: "read_file", input: {} },
        ],
        stop_reason: "tool_use",
      });
      expect(normalized.providerData).toEqual({
        reasoning_details: [{ type: "thinking", thinking: "paso 1", signature: "sig-1" }],
        anthropic_content_blocks: [
          { type: "thinking", thinking: "paso 1", signature: "sig-1" },
          { type: "text", text: "ok" },
          { type: "tool_use", id: "toolu_1", name: "read_file", input: {} },
        ],
      });
      expect(normalized.content).toBe("ok");
    });

    it("does not emit the ordered-block channel for text-only turns", () => {
      const normalized = new AnthropicTransport().normalizeResponse({
        content: [{ type: "text", text: "hola" }],
        stop_reason: "end_turn",
      });
      expect(normalized.providerData).toBeNull();
    });
  });

  describe("mcp__ tool prefix", () => {
    it("resolves a bare native tool through the injected registry", () => {
      expect(toolCallName(["read_file"], "mcp__read_file")).toBe("read_file");
    });

    it("resolves an MCP server tool through the injected registry", () => {
      expect(toolCallName(["mcp_linear_get_issue"], "mcp__linear_get_issue")).toBe(
        "mcp_linear_get_issue",
      );
    });

    it("never rewrites a name that already resolves natively", () => {
      expect(toolCallName(["mcp__read_file"], "mcp__read_file")).toBe("mcp__read_file");
      expect(toolCallName([], "mcp__read_file")).toBe("mcp__read_file");
      expect(toolCallName(["read_file"], "read_file")).toBe("read_file");
    });
  });

  describe("validateResponse", () => {
    const transport = new AnthropicTransport();

    it("rejects null and non-list content", () => {
      expect(transport.validateResponse(null)).toBe(false);
      expect(transport.validateResponse(undefined)).toBe(false);
      expect(transport.validateResponse({ stop_reason: "end_turn" })).toBe(false);
      expect(transport.validateResponse({ content: "text", stop_reason: "end_turn" })).toBe(false);
      expect(transport.validateResponse("not-an-object")).toBe(false);
    });

    it("accepts an empty content list only for terminal end_turn/refusal", () => {
      expect(transport.validateResponse({ content: [], stop_reason: "end_turn" })).toBe(true);
      expect(transport.validateResponse({ content: [], stop_reason: "refusal" })).toBe(true);
      expect(transport.validateResponse({ content: [], stop_reason: "tool_use" })).toBe(false);
      expect(transport.validateResponse({ content: [] })).toBe(false);
    });

    it("accepts a non-empty content list", () => {
      expect(
        transport.validateResponse({
          content: [{ type: "text", text: "hola" }],
          stop_reason: "end_turn",
        }),
      ).toBe(true);
      expect(transport.validateResponse({ content: [null], stop_reason: "end_turn" })).toBe(true);
    });
  });

  describe("extractCacheStats", () => {
    const transport = new AnthropicTransport();

    it("returns both counters when the response reports cache activity", () => {
      expect(
        transport.extractCacheStats({
          usage: { cache_read_input_tokens: 120, cache_creation_input_tokens: 30 },
        }),
      ).toEqual({ cachedTokens: 120, creationTokens: 30 });
    });

    it("returns null without usage", () => {
      expect(transport.extractCacheStats({ content: [] })).toBeNull();
      expect(transport.extractCacheStats(null)).toBeNull();
      expect(transport.extractCacheStats({ usage: "broken" })).toBeNull();
    });

    it("returns null when both counters are zero", () => {
      expect(
        transport.extractCacheStats({
          usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
      ).toBeNull();
      expect(transport.extractCacheStats({ usage: {} })).toBeNull();
    });
  });

  describe("mapFinishReason", () => {
    const transport = new AnthropicTransport();

    it("maps every Anthropic stop reason", () => {
      expect(transport.mapFinishReason("end_turn")).toBe("stop");
      expect(transport.mapFinishReason("tool_use")).toBe("tool_calls");
      expect(transport.mapFinishReason("max_tokens")).toBe("length");
      expect(transport.mapFinishReason("stop_sequence")).toBe("stop");
      expect(transport.mapFinishReason("refusal")).toBe("content_filter");
      expect(transport.mapFinishReason("model_context_window_exceeded")).toBe("length");
      expect(transport.mapFinishReason("never_seen")).toBe("stop");
    });
  });
});
