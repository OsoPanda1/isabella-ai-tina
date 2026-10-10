/**
 * Framing JSON-RPC 2.0 sobre stdio del subsistema LSP (`src/lib/lsp/protocol.ts`).
 *
 * Todo corre en memoria: sin procesos reales y sin red.
 */
import { describe, expect, it } from "vitest";

import {
  ERROR_METHOD_NOT_FOUND,
  LSPFrameReader,
  LSPProtocolError,
  LSPRequestError,
  LSPTimeoutError,
  classifyMessage,
  encodeMessage,
  makeErrorResponse,
  makeNotification,
  makeRequest,
  makeResponse,
} from "@/lib/lsp";

describe("protocol — trama Content-Length", () => {
  it("codifica Content-Length en bytes UTF-8 y hace roundtrip", () => {
    const envelope = { jsonrpc: "2.0", id: 1, method: "demo", params: { texto: "ñ" } };
    const bytes = encodeMessage(envelope);
    const headerEnd = bytes.indexOf("\r\n\r\n");
    expect(headerEnd).toBeGreaterThan(0);

    const header = bytes.subarray(0, headerEnd).toString("latin1");
    expect(header).toMatch(/^Content-Length: \d+$/);
    const declared = Number(header.slice("Content-Length:".length).trim());
    const body = bytes.subarray(headerEnd + 4);
    expect(declared).toBe(body.length);
    expect(declared).toBe(Buffer.byteLength(JSON.stringify(envelope), "utf8"));

    const reader = new LSPFrameReader();
    expect(reader.push(bytes)).toEqual([envelope]);
    expect(reader.pendingBytes).toBe(0);
    expect(() => reader.end()).not.toThrow();
  });

  it("acepta Content-Length en minúsculas y cabeceras adicionales", () => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 7, result: null }), "utf8");
    const frame = Buffer.concat([
      Buffer.from(
        `content-length: ${body.length}\r\n` +
          "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n",
        "latin1",
      ),
      body,
    ]);
    const reader = new LSPFrameReader();
    expect(reader.push(frame)).toEqual([{ jsonrpc: "2.0", id: 7, result: null }]);
  });

  it("ensambla una trama repartida en varios chunks", () => {
    const frame = encodeMessage({ jsonrpc: "2.0", id: 3, method: "textDocument/diagnostic" });
    const reader = new LSPFrameReader();

    expect(reader.push(frame.subarray(0, 10))).toEqual([]);
    expect(reader.pendingBytes).toBe(10);
    expect(reader.push(frame.subarray(10, 24))).toEqual([]);
    expect(reader.push(frame.subarray(24))).toEqual([
      { jsonrpc: "2.0", id: 3, method: "textDocument/diagnostic" },
    ]);
    expect(reader.pendingBytes).toBe(0);
  });

  it("parsea varias tramas encadenadas en un solo chunk", () => {
    const first = { jsonrpc: "2.0", id: 1, method: "a" };
    const second = { jsonrpc: "2.0", method: "b" };
    const chunk = Buffer.concat([encodeMessage(first), encodeMessage(second)]);
    const reader = new LSPFrameReader();
    expect(reader.push(chunk)).toEqual([first, second]);
  });

  it("EOF parcial lanza LSPProtocolError con el mensaje esperado", () => {
    const reader = new LSPFrameReader();
    reader.push(Buffer.from('Content-Length: 32\r\n\r\n{"jsonrpc":"2.0"', "utf8"));
    expect(reader.pendingBytes).toBeGreaterThan(0);

    let message = "";
    try {
      reader.end();
    } catch (error) {
      expect(error).toBeInstanceOf(LSPProtocolError);
      if (error instanceof LSPProtocolError) message = error.message;
    }
    expect(message).toContain("unexpected EOF while reading LSP headers");
    expect(reader.pendingBytes).toBe(0);
  });

  it("rechaza cabeceras sin Content-Length o con valores inválidos", () => {
    expect(() => new LSPFrameReader().push(Buffer.from("X-Thing: 1\r\n\r\n{}", "utf8"))).toThrow(
      /missing Content-Length/,
    );
    expect(() =>
      new LSPFrameReader().push(Buffer.from("Content-Length: abc\r\n\r\n{}", "utf8")),
    ).toThrow(/non-integer Content-Length/);
    expect(() =>
      new LSPFrameReader({ maxBodyBytes: 10 }).push(
        Buffer.from("Content-Length: 9999\r\n\r\n{}", "utf8"),
      ),
    ).toThrow(/unreasonable Content-Length/);
    expect(() => new LSPFrameReader().push(Buffer.from("mal-formada\r\n\r\n{}", "utf8"))).toThrow(
      /malformed LSP header line/,
    );
  });

  it("respeta el tope de bytes del bloque de cabeceras", () => {
    const reader = new LSPFrameReader({ maxHeaderBytes: 16 });
    expect(() => reader.push(Buffer.from("Content-Length: 100\r\nXX", "utf8"))).toThrow(
      /exceeded its limit/,
    );
  });
});

describe("protocol — errores", () => {
  it("LSPTimeoutError tiene name exacto, mensaje y presupuesto", () => {
    const error = new LSPTimeoutError("initialize", 45_000);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("LSPTimeoutError");
    expect(error.timeoutMs).toBe(45_000);
    expect(error.message).toBe("initialize timed out after 45000ms");
  });

  it("LSPProtocolError expone el nombre del tipo", () => {
    expect(new LSPProtocolError("framing roto").name).toBe("LSPProtocolError");
  });

  it("LSPRequestError conserva code y data del error del servidor", () => {
    const error = new LSPRequestError(ERROR_METHOD_NOT_FOUND, "no soportado", { hint: 1 });
    expect(error.name).toBe("LSPRequestError");
    expect(error.code).toBe(ERROR_METHOD_NOT_FOUND);
    expect(error.data).toEqual({ hint: 1 });
    expect(error.message).toBe(`LSP error ${ERROR_METHOD_NOT_FOUND}: no soportado`);
  });
});

describe("protocol — sobre JSON-RPC", () => {
  it("makeRequest/makeNotification omiten params undefined", () => {
    expect(makeRequest(5, "initialize")).toEqual({ jsonrpc: "2.0", id: 5, method: "initialize" });
    expect(makeNotification("exit")).toEqual({ jsonrpc: "2.0", method: "exit" });
    expect(makeRequest(5, "m", { a: 1 })).toEqual({
      jsonrpc: "2.0",
      id: 5,
      method: "m",
      params: { a: 1 },
    });
  });

  it("makeResponse/makeErrorResponse construyen ambos sobres", () => {
    expect(makeResponse(9, null)).toEqual({ jsonrpc: "2.0", id: 9, result: null });
    expect(makeErrorResponse(9, -32601, "method not found")).toEqual({
      jsonrpc: "2.0",
      id: 9,
      error: { code: -32601, message: "method not found" },
    });
    expect(makeErrorResponse(9, -1, "x", "detalle")).toEqual({
      jsonrpc: "2.0",
      id: 9,
      error: { code: -1, message: "x", data: "detalle" },
    });
  });

  it("classifyMessage separa request, response, notification e invalid", () => {
    expect(classifyMessage({ jsonrpc: "2.0", id: 1, method: "m" })).toEqual({
      kind: "request",
      key: 1,
    });
    expect(classifyMessage({ jsonrpc: "2.0", id: 1, result: null })).toEqual({
      kind: "response",
      key: 1,
    });
    expect(
      classifyMessage({ jsonrpc: "2.0", id: null, error: { code: -1, message: "x" } }),
    ).toEqual({ kind: "response", key: null });
    expect(classifyMessage({ jsonrpc: "2.0", method: "n" })).toEqual({
      kind: "notification",
      key: "n",
    });
    expect(classifyMessage({ jsonrpc: "1.0", id: 1, method: "m" })).toEqual({
      kind: "invalid",
      key: null,
    });
    expect(classifyMessage({ jsonrpc: "2.0", id: null, method: "m" })).toEqual({
      kind: "invalid",
      key: null,
    });
    expect(classifyMessage(null)).toEqual({ kind: "invalid", key: null });
    expect(classifyMessage([1, 2])).toEqual({ kind: "invalid", key: null });
    expect(classifyMessage("texto")).toEqual({ kind: "invalid", key: null });
  });
});
