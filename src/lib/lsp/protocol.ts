/**
 * Framing JSON-RPC 2.0 sobre stdio para el protocolo LSP.
 *
 * Formato de trama LSP:
 *
 *     Content-Length: <bytes>\r\n
 *     \r\n
 *     <cuerpo JSON UTF-8>
 *
 * El cuerpo es un sobre JSON-RPC 2.0: request, response o notification.
 * Este módulo es el equivalente de `vscode-jsonrpc` para este repositorio,
 * deliberadamente pequeño (solo trama + helpers de sobre) para que
 * `client.ts` se ocupe de la semántica del protocolo.
 */

export const ERROR_CONTENT_MODIFIED = -32801;
export const ERROR_REQUEST_CANCELLED = -32800;
export const ERROR_METHOD_NOT_FOUND = -32601;

const DEFAULT_MAX_HEADER_BYTES = 8192;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

/** Se violó el framing o el sobre JSON-RPC (indistinguible de un error del servidor). */
export class LSPProtocolError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LSPProtocolError";
  }
}

/** El servidor respondió un error JSON-RPC con forma válida. */
export class LSPRequestError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(`LSP error ${code}: ${message}`);
    this.name = "LSPRequestError";
    this.code = code;
    this.data = data;
  }
}

/** Una operación no tuvo respuesta dentro del presupuesto asignado. */
export class LSPTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number, options?: { cause?: unknown }) {
    super(`${operation} timed out after ${timeoutMs}ms`, options);
    this.name = "LSPTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface LSPResponseError {
  code: number;
  message: string;
  data?: unknown;
}

export interface LSPMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: LSPResponseError;
  [key: string]: unknown;
}

export type LSPMessageKind = "request" | "response" | "notification" | "invalid";

export interface LSPClassifiedMessage {
  kind: LSPMessageKind;
  key: number | string | null;
}

/**
 * Codifica un sobre JSON-RPC como bytes con trama Content-Length.
 *
 * El cuerpo es JSON compacto UTF-8 (sin separadores), igual que
 * `vscode-jsonrpc`, para que el conteo de Content-Length sea exacto en
 * bytes y no en caracteres.
 */
export function encodeMessage(obj: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, body]);
}

/** Construye un sobre request JSON-RPC 2.0. */
export function makeRequest(id: number, method: string, params?: unknown): LSPMessage {
  const msg: LSPMessage = { jsonrpc: "2.0", id, method };
  if (params !== null && params !== undefined) msg.params = params;
  return msg;
}

/** Construye un sobre notification JSON-RPC 2.0 (sin `id`). */
export function makeNotification(method: string, params?: unknown): LSPMessage {
  const msg: LSPMessage = { jsonrpc: "2.0", method };
  if (params !== null && params !== undefined) msg.params = params;
  return msg;
}

/** Construye un sobre de respuesta exitosa JSON-RPC 2.0. */
export function makeResponse(id: number | string | null, result: unknown): LSPMessage {
  return { jsonrpc: "2.0", id, result };
}

/** Construye un sobre de respuesta con error JSON-RPC 2.0. */
export function makeErrorResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): LSPMessage {
  const error: LSPResponseError = { code, message };
  if (data !== null && data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

/**
 * Clasifica un mensaje recibido.
 *
 * Devuelve `kind` (`request` | `response` | `notification` | `invalid`) y la
 * clave de correlación: el id para request/response, el nombre del método
 * para notification y `null` para mensajes inválidos.
 */
export function classifyMessage(msg: unknown): LSPClassifiedMessage {
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    return { kind: "invalid", key: null };
  }
  const candidate = msg as Record<string, unknown>;
  if (candidate.jsonrpc !== "2.0") return { kind: "invalid", key: null };
  const hasId = "id" in candidate;
  const hasMethod = "method" in candidate;
  if (hasId && hasMethod) {
    const key = candidate.id;
    if (typeof key === "number" || typeof key === "string") return { kind: "request", key };
    return { kind: "invalid", key: null };
  }
  if (hasId && ("result" in candidate || "error" in candidate)) {
    const key = candidate.id;
    if (key === null || typeof key === "number" || typeof key === "string") {
      return { kind: "response", key };
    }
    return { kind: "invalid", key: null };
  }
  if (hasMethod && !hasId) {
    const method = candidate.method;
    if (typeof method === "string") return { kind: "notification", key: method };
    return { kind: "invalid", key: null };
  }
  return { kind: "invalid", key: null };
}

export interface LSPFrameReaderOptions {
  /** Tope de bytes del bloque de cabeceras antes del terminador CRLF-CRLF. */
  maxHeaderBytes?: number;
  /** Tope sanidad para Content-Length. */
  maxBodyBytes?: number;
}

/**
 * Acumulador incremental de tramas Content-Length.
 *
 * `push()` entrega chunks del stdout del servidor y devuelve los mensajes
 * JSON ya completos; los bytes parciales permanecen en el buffer hasta que
 * llegue el resto. `end()` marca EOF limpio: un buffer vacío es un cierre
 * normal (típico shutdown), cualquier resto es un framing incompleto.
 */
export class LSPFrameReader {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly maxHeaderBytes: number;
  private readonly maxBodyBytes: number;

  constructor(options: LSPFrameReaderOptions = {}) {
    this.maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  /** Bytes retenidos sin completar una trama (para diagnósticos). */
  get pendingBytes(): number {
    return this.buffer.length;
  }

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];

    for (;;) {
      const terminator = this.buffer.indexOf("\r\n\r\n");
      if (terminator === -1) {
        if (this.buffer.length > this.maxHeaderBytes) {
          throw new LSPProtocolError("LSP header block exceeded its limit without terminator");
        }
        return messages;
      }
      const headerBytes = terminator + 4;
      if (headerBytes > this.maxHeaderBytes) {
        throw new LSPProtocolError("LSP header block exceeded its limit");
      }

      const headerText = this.buffer.subarray(0, terminator).toString("latin1");
      const headers = parseHeaders(headerText);
      const rawLength = headers.get("content-length");
      if (rawLength === undefined) {
        throw new LSPProtocolError(`LSP message missing Content-Length: ${headerText}`);
      }
      const bodyLength = Number(rawLength);
      if (!Number.isInteger(bodyLength)) {
        throw new LSPProtocolError(`non-integer Content-Length: ${rawLength}`);
      }
      if (bodyLength < 0 || bodyLength > this.maxBodyBytes) {
        throw new LSPProtocolError(`unreasonable Content-Length: ${bodyLength}`);
      }
      if (this.buffer.length < headerBytes + bodyLength) return messages;

      const body = this.buffer.subarray(headerBytes, headerBytes + bodyLength);
      this.buffer = this.buffer.subarray(headerBytes + bodyLength);
      messages.push(parseJsonBody(body));
    }
  }

  /** Marca EOF: sin resto hay cierre limpio, con resto el framing quedó incompleto. */
  end(): void {
    if (this.buffer.length > 0) {
      const partial = this.buffer;
      this.buffer = Buffer.alloc(0);
      throw new LSPProtocolError(
        `unexpected EOF while reading LSP headers (partial=${partial.length}B)`,
      );
    }
  }
}

function parseHeaders(headerText: string): Map<string, string> {
  const headers = new Map<string, string>();
  if (headerText.length === 0) return headers;
  for (const line of headerText.split("\r\n")) {
    if (line.length === 0) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new LSPProtocolError(`malformed LSP header line: ${JSON.stringify(line)}`);
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers.set(key, value);
  }
  return headers;
}

function parseJsonBody(body: Buffer): unknown {
  const text = body.toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new LSPProtocolError(`invalid JSON in LSP body: ${String(error)}`, { cause: error });
  }
}
