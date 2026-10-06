import { describe, expect, it } from "vitest";
import {
  createLineDecoder,
  encodeJsonRpcMessage,
  jsonRpcFailure,
  jsonRpcSuccess,
  parseJsonRpcMessage,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_PARSE_ERROR,
} from "@/lib/mcp-server/protocol";

/**
 * PROTOCOLO MCP (test/unit/mcp-server/protocol.test.ts)
 * Framing newline-delimited JSON-RPC 2.0 sobre stdio (spec MCP 2025-06-18).
 */

describe("parseJsonRpcMessage", () => {
  it("acepta solicitud con id numérico", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") return;
    expect(parsed.message).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
  });

  it("acepta solicitud con params objeto y sin id como notificación", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","method":"notifications/initialized","params":{"ok":true}}',
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") return;
    expect("id" in parsed.message).toBe(false);
  });

  it("acepta respuesta de éxito y de error entrantes", () => {
    const ok = parseJsonRpcMessage('{"jsonrpc":"2.0","id":"a","result":{"x":1}}');
    expect(ok.kind === "message" && ok.message).toHaveProperty("result");
    const bad = parseJsonRpcMessage('{"jsonrpc":"2.0","id":2,"error":{"code":-1,"message":"x"}}');
    expect(bad.kind === "message" && bad.message).toHaveProperty("error");
  });

  it("rechaza JSON no decodificable con -32700", () => {
    expect(parseJsonRpcMessage("{no-json").kind).toBe("parse-error");
    const parsed = parseJsonRpcMessage("{no-json");
    expect(JSON_RPC_PARSE_ERROR).toBe(-32700);
    expect(parsed.kind === "parse-error").toBe(true);
  });

  it("rechaza jsonrpc distinto de 2.0 conservando el id", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"1.0","id":9,"method":"ping"}');
    expect(parsed.kind).toBe("invalid-request");
    if (parsed.kind !== "invalid-request") return;
    expect(parsed.id).toBe(9);
  });

  it("rechaza id inválido con id null", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":{"x":1},"method":"ping"}');
    expect(parsed.kind).toBe("invalid-request");
    if (parsed.kind !== "invalid-request") return;
    expect(parsed.id).toBeNull();
  });

  it("rechaza method con result, params escalares y mensajes vacíos", () => {
    expect(parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"method":"a","result":{}}').kind).toBe(
      "invalid-request",
    );
    expect(parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"method":"a","params":3}').kind).toBe(
      "invalid-request",
    );
    expect(parseJsonRpcMessage('{"jsonrpc":"2.0","id":1}').kind).toBe("invalid-request");
    expect(parseJsonRpcMessage('"cadena"').kind).toBe("invalid-request");
    expect(JSON_RPC_INVALID_REQUEST).toBe(-32600);
  });

  it("rechaza result y error simultáneos e error malformado", () => {
    expect(
      parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":1,"message":"m"}}')
        .kind,
    ).toBe("invalid-request");
    expect(parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"error":{"code":"x"}}').kind).toBe(
      "invalid-request",
    );
  });
});

describe("encodeJsonRpcMessage", () => {
  it("termina en \\n y no deja saltos de línea embebidos", () => {
    const line = encodeJsonRpcMessage(jsonRpcSuccess(1, { text: "línea uno\nlínea dos" }));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { text: "línea uno\nlínea dos" },
    });
  });

  it("serializa errores con el código recibido", () => {
    expect(JSON.parse(encodeJsonRpcMessage(jsonRpcFailure(5, -32601, "no")))).toEqual({
      jsonrpc: "2.0",
      id: 5,
      error: { code: -32601, message: "no" },
    });
  });
});

describe("createLineDecoder", () => {
  it("reúne líneas desde chunks parciales y acepta \\r\\n", () => {
    const decoder = createLineDecoder();
    expect(decoder.push('{"a":').lines).toEqual([]);
    const second = decoder.push('1}\r\n{"b":2}\n');
    expect(second.lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(decoder.pending()).toBe("");
  });

  it("mantiene el fragmento final sin salto de línea", () => {
    const decoder = createLineDecoder();
    decoder.push('{"a":1}\n{"b"');
    expect(decoder.pending()).toBe('{"b"');
  });

  it("marca overflow y descarta líneas que exceden el límite (DoS)", () => {
    const decoder = createLineDecoder(10);
    const result = decoder.push("x".repeat(50) + "\nok\n");
    expect(result.overflow).toBe(true);
    expect(result.lines).toEqual(["ok"]);
  });
});
