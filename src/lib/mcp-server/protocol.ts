/**
 * PROTOCOLO MCP — JSON-RPC 2.0 sobre stdio (src/lib/mcp-server/protocol.ts)
 * -----------------------------------------------------------------
 * Framing implementado: DELIMITADO POR SALTOS DE LÍNEA (newline-delimited).
 * El transporte stdio de MCP (spec 2025-06-18, sección "stdio") define cada
 * mensaje como un JSON-RPC individual separado por "\n", sin saltos de línea
 * embebidos; el framing `Content-Length` pertenece a LSP, no a MCP. El código
 * fuente Python portado delega ese framing en el SDK `mcp` (`MCPServer.run()`
 * sobre stdio), que usa exactamente este esquema.
 *
 * Este módulo es puro: parsea, valida, serializa y decodifica de forma
 * incremental. No abre stdio, no escribe y no tiene efectos de importación.
 */

/** Error de parseo JSON-RPC (JSON no decodificable). */
export const JSON_RPC_PARSE_ERROR = -32700;
/** Solicitud malformada (jsonrpc/id/method/params inválidos). */
export const JSON_RPC_INVALID_REQUEST = -32600;
/** Método desconocido por el servidor. */
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
/** Parámetros del método inválidos o fuera del esquema anunciado. */
export const JSON_RPC_INVALID_PARAMS = -32602;
/** Fallo interno sin detalles vulnerables (sin stack traces). */
export const JSON_RPC_INTERNAL_ERROR = -32603;
/** MCP: petición recibida antes de `initialize` (ServerNotInitialized). */
export const MCP_SERVER_NOT_INITIALIZED = -32002;

/** Tamaño máximo de una línea (mensaje) aceptado por el decodificador. */
export const DEFAULT_MAX_LINE_LENGTH = 4 * 1024 * 1024;

export type JsonRpcId = string | number | null;
export type JsonRpcParams = Record<string, unknown> | unknown[];

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: JsonRpcParams;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: JsonRpcParams;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

export type JsonRpcParseResult =
  | { kind: "message"; message: JsonRpcMessage }
  | { kind: "parse-error" }
  | { kind: "invalid-request"; id: JsonRpcId | null; reason: string };

/** Construye una respuesta de éxito JSON-RPC. */
export function jsonRpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

/** Construye una respuesta de error JSON-RPC. */
export function jsonRpcFailure(id: JsonRpcId, code: number, message: string): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidJsonRpcId(value: unknown): value is JsonRpcId {
  if (value === null || typeof value === "string") return true;
  return typeof value === "number" && Number.isFinite(value);
}

type ParamsClassification =
  { kind: "absent" } | { kind: "present"; params: JsonRpcParams } | { kind: "invalid" };

function classifyParams(raw: Record<string, unknown>): ParamsClassification {
  if (!("params" in raw)) return { kind: "absent" };
  const params: unknown = raw.params;
  if (isPlainJsonObject(params)) return { kind: "present", params };
  if (Array.isArray(params)) return { kind: "present", params };
  return { kind: "invalid" };
}

function invalidRequest(id: JsonRpcId | null, reason: string): JsonRpcParseResult {
  return { kind: "invalid-request", id, reason };
}

/**
 * Parsea una línea ya delimitada como mensaje JSON-RPC 2.0.
 * Distingue parse error (-32700) de solicitud inválida (-32600) para poder
 * responder con el código correcto y el `id` correcto (null cuando el `id`
 * recibido no es utilizable).
 */
export function parseJsonRpcMessage(line: string): JsonRpcParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { kind: "parse-error" };
  }
  if (!isPlainJsonObject(raw)) {
    return invalidRequest(null, "El mensaje debe ser un objeto JSON-RPC 2.0.");
  }
  if ("id" in raw && !isValidJsonRpcId(raw.id)) {
    return invalidRequest(null, 'El campo "id" debe ser string, number o null.');
  }
  const id: JsonRpcId = "id" in raw && isValidJsonRpcId(raw.id) ? raw.id : null;
  if (raw.jsonrpc !== "2.0") {
    return invalidRequest(id, 'El campo "jsonrpc" debe ser "2.0".');
  }
  const hasMethod = "method" in raw;
  const hasResult = "result" in raw;
  const hasError = "error" in raw;
  if (hasMethod && (hasResult || hasError)) {
    return invalidRequest(id, "Un mensaje no puede combinar method con result/error.");
  }
  if (hasMethod) {
    const method: unknown = raw.method;
    if (typeof method !== "string" || method.length === 0) {
      return invalidRequest(id, 'El campo "method" debe ser una cadena no vacía.');
    }
    const classified = classifyParams(raw);
    if (classified.kind === "invalid") {
      return invalidRequest(id, 'El campo "params" debe ser un objeto o un arreglo.');
    }
    const message =
      classified.kind === "absent"
        ? { jsonrpc: "2.0" as const, method }
        : { jsonrpc: "2.0" as const, method, params: classified.params };
    return {
      kind: "message",
      message: "id" in raw ? { ...message, id } : message,
    };
  }
  if (hasResult || hasError) {
    if (hasResult && hasError) {
      return invalidRequest(id, "Un mensaje no puede llevar result y error a la vez.");
    }
    if (hasError) {
      const error: unknown = raw.error;
      if (
        !isPlainJsonObject(error) ||
        typeof error.code !== "number" ||
        typeof error.message !== "string"
      ) {
        return invalidRequest(id, 'El campo "error" debe ser { code, message }.');
      }
      const failure: JsonRpcFailure = {
        jsonrpc: "2.0",
        id,
        error: { code: error.code, message: error.message },
      };
      if ("data" in error) failure.error.data = error.data;
      return { kind: "message", message: failure };
    }
    const success: JsonRpcSuccess = { jsonrpc: "2.0", id, result: raw.result };
    return { kind: "message", message: success };
  }
  return invalidRequest(id, "El mensaje no contiene method, result ni error.");
}

/**
 * Serializa un mensaje como línea MCP: JSON compacto terminado en "\n".
 * El framing por salto de línea prohíbe saltos embebidos; `JSON.stringify`
 * escapa cualquier carácter de control proveniente de datos no confiables.
 */
export function encodeJsonRpcMessage(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export interface LineDecoderResult {
  readonly lines: readonly string[];
  readonly overflow: boolean;
}

export interface LineDecoder {
  /** Acumula un chunk binario o textual y devuelve las líneas completas. */
  push(chunk: Uint8Array | string): LineDecoderResult;
  /** Fragmento acumulado que aún no tiene salto de línea final. */
  pending(): string;
}

/**
 * Decodificador incremental de líneas UTF-8: tolera buffers parciales,
 * separadores "\n" y "\r\n", y descarta líneas que excedan el límite
 * permitido (control de DoS por mensaje, fail-closed).
 */
export function createLineDecoder(maxLineLength: number = DEFAULT_MAX_LINE_LENGTH): LineDecoder {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  return {
    push(chunk: Uint8Array | string): LineDecoderResult {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      const lines: string[] = [];
      let overflow = false;
      for (const line of parts) {
        if (line.length > maxLineLength) overflow = true;
        else lines.push(line);
      }
      if (buffer.length > maxLineLength) {
        buffer = "";
        overflow = true;
      }
      return { lines, overflow };
    },
    pending(): string {
      return buffer;
    },
  };
}
