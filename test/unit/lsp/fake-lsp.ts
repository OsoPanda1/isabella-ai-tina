/**
 * Procesos LSP falsos para los tests del subsistema LSP.
 *
 * Regla del repo: ningún test spawnea un binario real ni abre red. Este
 * doble implementa `LSPSpawnProcess` y `LSPChildProcess` en memoria: capta
 * lo que el cliente escribe en stdin (usando el mismo framing del repo) y
 * responde por stdout con tramas `Content-Length`, sin salir del proceso de
 * test.
 */
import { EventEmitter } from "node:events";

import {
  LSPFrameReader,
  classifyMessage,
  encodeMessage,
  type LSPChildProcess,
  type LSPMessage,
  type LSPSpawnOptions,
  type LSPSpawnProcess,
  type LSPWritableLike,
} from "@/lib/lsp";

/** Request del cliente capturado en stdin del hijo falso. */
export interface CapturedRequest {
  id: number;
  method: string;
  params: unknown;
}

/** Notification del cliente capturada en stdin del hijo falso. */
export interface CapturedNotification {
  method: string;
  params: unknown;
}

/** Intento de spawn capturado (comando, args y opciones). */
export interface CapturedSpawn {
  command: string;
  args: string[];
  options: LSPSpawnOptions;
}

export interface FakeLSPServerOptions {
  /** Emite el evento `spawn` del hijo (por defecto `true`); `false` simula un binario que nunca arranca. */
  emitSpawn?: boolean;
  /** Capabilities devueltas en la respuesta automática a `initialize`. */
  capabilities?: Record<string, unknown>;
  /** Si está presente, todo pull `textDocument/diagnostic` se responde con estos items. */
  autoDiagnostics?: readonly unknown[];
}

class FakeChild extends EventEmitter implements LSPChildProcess {
  readonly stdin: LSPWritableLike;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  exitCode: number | null = null;
  killed = false;

  constructor(stdin: LSPWritableLike) {
    super();
    this.stdin = stdin;
  }

  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.exitCode = 0;
    return true;
  }
}

/** Hijo LSP falso: sin proceso real, sin red y sin binarios en disco. */
export class FakeLSPServer {
  readonly requests: CapturedRequest[] = [];
  readonly notifications: CapturedNotification[] = [];
  readonly spawnCalls: CapturedSpawn[] = [];

  private readonly options: FakeLSPServerOptions;
  private child: FakeChild | null = null;
  private reader = new LSPFrameReader();

  constructor(options: FakeLSPServerOptions = {}) {
    this.options = options;
  }

  /** Spawn falso entregable como `spawnProcess` a `LSPClient`/`LSPService`. */
  readonly spawn: LSPSpawnProcess = (command, args, options) => {
    this.spawnCalls.push({ command, args: [...args], options });
    this.reader = new LSPFrameReader();
    const child = new FakeChild({
      write: (chunk, callback) => {
        this.onClientBytes(chunk);
        if (callback) callback();
        return true;
      },
    });
    this.child = child;
    if (this.options.emitSpawn !== false) {
      setTimeout(() => child.emit("spawn"), 0);
    }
    return child;
  };

  /** Respuesta exitosa JSON-RPC del "servidor" hacia el cliente. */
  respond(id: number, result: unknown): void {
    this.emitToClient({ jsonrpc: "2.0", id, result });
  }

  /** Respuesta con error JSON-RPC del "servidor" hacia el cliente. */
  respondError(id: number, code: number, message: string): void {
    this.emitToClient({ jsonrpc: "2.0", id, error: { code, message } });
  }

  /** Notificación `textDocument/publishDiagnostics` del "servidor". */
  publishDiagnostics(uri: string, diagnostics: readonly unknown[], version?: number): void {
    const params: Record<string, unknown> = { uri, diagnostics: [...diagnostics] };
    if (version !== undefined) params.version = version;
    this.emitToClient({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params });
  }

  /** Simula el EOF del stdout del servidor. */
  endStdout(): void {
    this.child?.stdout.emit("end");
  }

  private emitToClient(message: Record<string, unknown>): void {
    this.child?.stdout.emit("data", encodeMessage(message));
  }

  private onClientBytes(chunk: Buffer): void {
    for (const message of this.reader.push(chunk)) this.onClientMessage(message);
  }

  private onClientMessage(message: unknown): void {
    const { kind, key } = classifyMessage(message);
    if (kind === "notification" && typeof key === "string") {
      const notification = message as LSPMessage;
      this.notifications.push({ method: key, params: notification.params });
      return;
    }
    if (kind !== "request" || typeof key !== "number") return;
    const request = message as LSPMessage;
    const method = typeof request.method === "string" ? request.method : "";
    this.requests.push({ id: key, method, params: request.params });
    this.autoRespond(key, method);
  }

  private autoRespond(id: number, method: string): void {
    if (method === "initialize") {
      this.respond(id, { capabilities: this.options.capabilities ?? {} });
      return;
    }
    if (method === "shutdown") {
      this.respond(id, null);
      return;
    }
    if (method === "textDocument/diagnostic" && this.options.autoDiagnostics !== undefined) {
      this.respond(id, { items: [...this.options.autoDiagnostics] });
    }
  }
}
