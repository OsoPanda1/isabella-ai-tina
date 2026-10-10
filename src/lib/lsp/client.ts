/**
 * Cliente LSP asíncrono sobre stdin/stdout.
 *
 * Un `LSPClient` corresponde a un par `(language_server, workspace_root)`:
 * la misma clave que usa OpenCode y el mismo formato que Claude Code. El
 * cliente es dueño de un proceso hijo, conduce el intercambio JSON-RPC y
 * expone `openFile` / `saveFile` / `waitForDiagnostics` / `diagnosticsFor`
 * / `shutdown`.
 *
 * Notas de implementación:
 *
 * - El estado por documento vive en un `DocState` por ruta absoluta. La
 *   frescura se rastrea con **versiones de documento**, no con relojes:
 *   cada didChange incrementa `version` y cada resultado almacenado queda
 *   etiquetado con la versión que describe. Un resultado es fresco si su
 *   etiqueta alcanzó a la versión esperada, de modo que un didChange
 *   invalida todo lo anterior sin carreras de reloj (anti "ghost
 *   diagnostics").
 *
 * - Sync de documento completo: aunque el servidor anuncie sync
 *   incremental, se envía un único `contentChanges` que reemplaza el
 *   documento entero.
 *
 * - "Danza del archivo": cada `openFile` también dispara
 *   `workspace/didChangeWatchedFiles` (CREATED en la primera apertura,
 *   CHANGED después). Servidores como clangd/eslint solo re-escanean con
 *   esa notificación.
 *
 * - Errores `ContentModified` (-32801) se reintenta con backoff
 *   exponencial hasta 3 veces.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createLogger } from "../logger";
import {
  ERROR_CONTENT_MODIFIED,
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
  type LSPMessage,
} from "./protocol";

const log = createLogger("lsp.client");

export const INITIALIZE_TIMEOUT_MS = 45_000;
export const DIAGNOSTICS_DOCUMENT_WAIT_MS = 5_000;
export const DIAGNOSTICS_FULL_WAIT_MS = 10_000;
export const DIAGNOSTICS_REQUEST_TIMEOUT_MS = 3_000;
export const PUSH_DEBOUNCE_MS = 150;
export const SHUTDOWN_GRACE_MS = 1_000;
export const SHUTDOWN_REQUEST_TIMEOUT_MS = 2_000;

const MAX_CONTENT_MODIFIED_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

/** Variables de SO que el hijo necesita para arrancar (nunca credenciales). */
const OS_ENV_KEYS = ["PATH", "HOME", "SHELL", "TERM", "TZ", "LANG", "LC_ALL"] as const;
/** Esenciales de Windows: sin ellos `cmd.exe` y el temporizador del SO fallan. */
const WINDOWS_OS_ENV_KEYS = [
  "SystemRoot",
  "ComSpec",
  "WINDIR",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "PATHEXT",
] as const;

export interface LSPDiagnostic {
  range?: {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
  severity?: number;
  code?: string | number;
  source?: string;
  message?: string;
  [key: string]: unknown;
}

export interface LSPReadableLike {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface LSPWritableLike {
  write(chunk: Buffer, cb?: (error?: Error | null) => void): boolean;
}

/** Superficie mínima de un proceso hijo LSP (compatible con `ChildProcess`). */
export interface LSPChildProcess {
  readonly stdin: LSPWritableLike | null;
  readonly stdout: LSPReadableLike | null;
  readonly stderr: LSPReadableLike | null;
  readonly exitCode: number | null;
  readonly killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "spawn", listener: () => void): unknown;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface LSPSpawnOptions {
  cwd: string;
  env: Record<string, string>;
  stdio: "pipe";
  windowsHide: boolean;
}

export type LSPSpawnProcess = (
  command: string,
  args: readonly string[],
  options: LSPSpawnOptions,
) => LSPChildProcess;

/** Error tipado del gate fail-closed: spawnear con LSP deshabilitado. */
export class LSPDisabledError extends Error {
  constructor(operation: string) {
    super(`LSP disabled: spawn blocked during ${operation}`);
    this.name = "LSPDisabledError";
  }
}

/** Spawn real del proceso. No se ejecuta hasta que alguien lo llama. */
export const defaultSpawnProcess: LSPSpawnProcess = (command, args, options) =>
  nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio,
    windowsHide: options.windowsHide,
  });

/**
 * Envuelve el spawn real en un gate fail-closed: si `isEnabled()` no dice
 * `true`, no se invoca el spawn y se lanza `LSPDisabledError`.
 */
export function createGatedSpawn(
  isEnabled: () => boolean,
  spawnImpl: LSPSpawnProcess = defaultSpawnProcess,
): LSPSpawnProcess {
  return (command, args, options) => {
    if (isEnabled() !== true) throw new LSPDisabledError(`spawn ${command}`);
    return spawnImpl(command, args, options);
  };
}

/**
 * Entorno mínimo del hijo: claves de SO permitidas + overrides explícitos.
 * Nunca hereda el entorno completo del proceso (evita filtrar credenciales
 * a un servidor de terceros).
 */
export function buildChildEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const source = process.env;
  const keys: readonly string[] =
    process.platform === "win32" ? [...OS_ENV_KEYS, ...WINDOWS_OS_ENV_KEYS] : OS_ENV_KEYS;
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) env[key] = String(value);
  return env;
}

const UTF8_UNRESERVED = /^[A-Za-z0-9\-_.~/:]$/;

function percentEncodeUtf8(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  let out = "";
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    if (UTF8_UNRESERVED.test(char)) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** Devuelve el URI `file://` de una ruta absoluta (Windows incluido). */
export function fileUri(filePath: string): string {
  let absolute = path.resolve(filePath).replace(/\\/g, "/");
  if (process.platform === "win32" && !absolute.startsWith("/")) absolute = `/${absolute}`;
  return `file://${percentEncodeUtf8(absolute)}`;
}

/** Inverso de `fileUri`. */
export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  let raw = uri.slice("file://".length);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return uri;
  }
  if (process.platform === "win32" && raw.length > 2 && raw[0] === "/" && raw[2] === ":") {
    raw = raw.slice(1);
  }
  return path.normalize(raw);
}

/** Posición LSP final de `text` (para reemplazar el documento completo). */
export function endPosition(text: string): { line: number; character: number } {
  if (!text) return { line: 0, character: 0 };
  const lines = text.split(/\r\n|\r|\n/);
  const lastLine = lines.length - 1;
  const lastColumn = lines[lines.length - 1]?.length ?? 0;
  if (text.endsWith("\n") || text.endsWith("\r")) return { line: lastLine + 1, character: 0 };
  return { line: lastLine, character: lastColumn };
}

/**
 * Clave de identidad de un diagnóstico para el filtrado delta.
 *
 * Incluye el rango: cuando se usa junto con un shift de líneas, la baseline
 * se remapea a coordenadas post-edición ANTES de calcular esta clave, así
 * los diagnósticos idénticos pero corridos empatan. Dos diagnósticos
 * distintos en líneas distintas quedan en claves distintas.
 */
export function diagnosticKey(diagnostic: LSPDiagnostic): string {
  const range = diagnostic.range ?? {};
  const start = range.start ?? {};
  const end = range.end ?? {};
  const code = diagnostic.code;
  return [
    String(diagnostic.severity ?? 1),
    code === undefined || code === null ? "" : String(code),
    String(diagnostic.source ?? ""),
    String(diagnostic.message ?? "").trim(),
    `${start.line ?? 0}:${start.character ?? 0}-${end.line ?? 0}:${end.character ?? 0}`,
  ].join("\0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface DocState {
  version: number;
  text: string;
  push: LSPDiagnostic[];
  pull: LSPDiagnostic[];
  pushVersion: number;
  pullVersion: number;
  seedSeen: boolean;
}

function newDocState(version: number, text = ""): DocState {
  return {
    version,
    text,
    push: [],
    pull: [],
    pushVersion: -1,
    pullVersion: -1,
    seedSeen: false,
  };
}

function freshPush(doc: DocState, version?: number): boolean {
  return doc.pushVersion >= (version === undefined ? doc.version : version);
}

function freshPull(doc: DocState, version?: number): boolean {
  return doc.pullVersion >= (version === undefined ? doc.version : version);
}

function dedupeDiagnostics(...lists: LSPDiagnostic[][]): LSPDiagnostic[] {
  const seen = new Set<string>();
  const out: LSPDiagnostic[] = [];
  for (const list of lists) {
    for (const diagnostic of list) {
      if (typeof diagnostic !== "object" || diagnostic === null) continue;
      const key = diagnosticKey(diagnostic);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(diagnostic);
    }
  }
  return out;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface CancellableWait {
  promise: Promise<boolean>;
  cancel(): void;
}

export interface LSPClientOptions {
  serverId: string;
  workspaceRoot: string;
  command: readonly string[];
  env?: Record<string, string>;
  cwd?: string;
  initializationOptions?: Record<string, unknown>;
  seedDiagnosticsOnFirstPush?: boolean;
  spawnProcess?: LSPSpawnProcess;
}

export type LSPClientState = "stopped" | "starting" | "running" | "error";

export class LSPClient {
  readonly serverId: string;
  readonly workspaceRoot: string;

  private readonly command: readonly string[];
  private readonly envOverrides: Record<string, string>;
  private readonly cwdPath: string;
  private readonly initOptions: Record<string, unknown>;
  private readonly seedFirstPush: boolean;
  private readonly spawnImpl: LSPSpawnProcess;

  private child: LSPChildProcess | null = null;
  private readonly reader = new LSPFrameReader();
  private currentState: LSPClientState = "stopped";
  private initializeResult: unknown = null;
  private stopping = false;
  private stdoutEnded = false;
  private spawnError: Error | null = null;
  private spawnSettled = false;
  private spawnResolve: (() => void) | null = null;
  private spawnReject: ((error: unknown) => void) | null = null;
  private cleanupInFlight: Promise<void> | null = null;

  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly docs = new Map<string, DocState>();
  private readonly diagnosticRegistrations = new Set<string>();

  private pushCounter = 0;
  private readonly pushWaiters = new Set<() => void>();

  constructor(options: LSPClientOptions) {
    this.serverId = options.serverId;
    this.workspaceRoot = options.workspaceRoot;
    this.command = [...options.command];
    this.envOverrides = options.env ?? {};
    this.cwdPath = options.cwd ?? options.workspaceRoot;
    this.initOptions = options.initializationOptions ?? {};
    this.seedFirstPush = options.seedDiagnosticsOnFirstPush ?? false;
    this.spawnImpl = options.spawnProcess ?? defaultSpawnProcess;
  }

  get state(): LSPClientState {
    return this.currentState;
  }

  get isRunning(): boolean {
    return this.currentState === "running" && this.isConnectionOpen();
  }

  private isConnectionOpen(): boolean {
    const child = this.child;
    return (
      (this.currentState === "starting" || this.currentState === "running") &&
      child !== null &&
      child.exitCode === null &&
      !this.stdoutEnded
    );
  }

  /** Arranca el servidor y completa el handshake initialize. */
  async start(): Promise<void> {
    if (this.currentState === "running" || this.currentState === "starting") return;
    this.currentState = "starting";
    try {
      this.spawnProcess();
      await this.awaitSpawn(INITIALIZE_TIMEOUT_MS);
      await this.initialize();
      if (!this.isConnectionOpen()) {
        throw new LSPProtocolError("server connection closed during initialization");
      }
      this.currentState = "running";
    } catch (error) {
      this.currentState = "error";
      await this.cleanupProcess();
      throw error;
    }
  }

  private static wrapWindowsCommand(command: readonly string[]): string[] {
    const binary = command[0] ?? "";
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
      return ["cmd.exe", "/c", ...command];
    }
    return [...command];
  }

  private spawnProcess(): void {
    const [binary, ...args] = LSPClient.wrapWindowsCommand(this.command);
    if (!binary) throw new LSPProtocolError("empty LSP command");
    this.stdoutEnded = false;
    this.spawnError = null;
    this.spawnSettled = false;
    let child: LSPChildProcess;
    try {
      child = this.spawnImpl(binary, args, {
        cwd: this.cwdPath,
        env: buildChildEnv(this.envOverrides),
        stdio: "pipe",
        windowsHide: true,
      });
    } catch (error) {
      throw new LSPProtocolError(`LSP server binary not found: ${binary}`, { cause: error });
    }
    this.child = child;

    child.stdout?.on("data", (chunk) => this.onStdout(chunk));
    child.stdout?.on("end", () => this.onStreamEnd());
    child.stdout?.on("error", () => this.onStreamEnd());
    child.stderr?.on("data", (chunk) => {
      const line = chunk.toString("utf8").trim();
      if (line) log.debug("lsp_stderr", { server_id: this.serverId, line: line.slice(0, 1000) });
    });
    child.on("spawn", () => {
      if (!this.spawnSettled) {
        this.spawnSettled = true;
        this.spawnResolve?.();
      }
    });
    child.on("error", (error) => {
      const wrapped = new LSPProtocolError(`LSP server binary not found: ${binary}`, {
        cause: error,
      });
      this.spawnError = wrapped;
      if (!this.spawnSettled) {
        this.spawnSettled = true;
        this.spawnReject?.(wrapped);
      }
      this.failConnection(error);
    });
    child.on("exit", (code, signal) => {
      log.debug("lsp_process_exit", {
        server_id: this.serverId,
        code,
        signal,
        stopping: this.stopping,
      });
      this.onStreamEnd();
    });
  }

  private awaitSpawn(timeoutMs: number): Promise<void> {
    if (this.spawnSettled) {
      return this.spawnError ? Promise.reject(this.spawnError) : Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new LSPTimeoutError(`spawn ${this.serverId}`, timeoutMs));
      }, timeoutMs);
      this.spawnResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.spawnReject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }

  private onStdout(chunk: Buffer): void {
    let messages: unknown[];
    try {
      messages = this.reader.push(chunk);
    } catch (error) {
      log.warn("lsp_protocol_error", { server_id: this.serverId, detail: String(error) });
      this.failConnection(error);
      return;
    }
    for (const message of messages) this.dispatch(message);
  }

  private onStreamEnd(): void {
    if (this.stdoutEnded) return;
    this.stdoutEnded = true;
    const unexpectedClose = !this.stopping && this.currentState !== "stopped";
    if (unexpectedClose) this.currentState = "error";
    this.failConnection(new LSPProtocolError("server connection closed"));
    if (unexpectedClose) void this.cleanupProcess();
  }

  private failConnection(error: unknown): void {
    for (const [, entry] of [...this.pending]) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.wakePushWaiters();
  }

  private dispatch(rawMessage: unknown): void {
    const { kind, key } = classifyMessage(rawMessage);
    const message = rawMessage as LSPMessage;
    if (kind === "response" && typeof key === "number") {
      this.settleResponse(key, message);
      return;
    }
    if (kind === "request" && (typeof key === "number" || typeof key === "string")) {
      void this.handleServerRequest(key, message);
      return;
    }
    if (kind === "notification" && typeof key === "string") {
      this.handleNotification(key, message);
      return;
    }
    log.warn("lsp_invalid_message", { server_id: this.serverId });
  }

  private settleResponse(id: number, message: LSPMessage): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(id);
    if (message.error) {
      entry.reject(
        new LSPRequestError(
          message.error.code ?? -32000,
          message.error.message ?? "unknown",
          message.error.data,
        ),
      );
      return;
    }
    entry.resolve(message.result);
  }

  private async handleServerRequest(id: number | string, message: LSPMessage): Promise<void> {
    const method = message.method ?? "";
    let result: unknown;
    const handler = this.serverRequestHandler(method);
    if (handler === null) {
      await this.writeResponse(
        makeErrorResponse(id, ERROR_METHOD_NOT_FOUND, `method not found: ${method}`),
      );
      return;
    }
    try {
      result = await handler(message.params);
    } catch (error) {
      log.warn("lsp_request_handler_failed", {
        server_id: this.serverId,
        method,
        detail: String(error),
      });
      await this.writeResponse(makeErrorResponse(id, -32000, `handler failed: ${String(error)}`));
      return;
    }
    await this.writeResponse(makeResponse(id, result));
  }

  private serverRequestHandler(method: string): ((params: unknown) => Promise<unknown>) | null {
    switch (method) {
      case "window/workDoneProgress/create":
        return async () => null;
      case "workspace/configuration":
        return async (params) => this.handleWorkspaceConfiguration(params);
      case "client/registerCapability":
        return async (params) => this.handleRegisterCapability(params);
      case "client/unregisterCapability":
        return async (params) => this.handleUnregisterCapability(params);
      case "workspace/workspaceFolders":
        return async () => [{ name: "workspace", uri: fileUri(this.workspaceRoot) }];
      case "workspace/diagnostic/refresh":
        return async () => null;
      default:
        return null;
    }
  }

  private handleWorkspaceConfiguration(params: unknown): unknown {
    if (!isRecord(params)) return [null];
    const items = Array.isArray(params.items) ? params.items : [];
    const out: unknown[] = [];
    for (const item of items) {
      if (!isRecord(item)) {
        out.push(null);
        continue;
      }
      const section = item.section;
      if (!section || Object.keys(this.initOptions).length === 0) {
        out.push(Object.keys(this.initOptions).length > 0 ? this.initOptions : null);
        continue;
      }
      let cursor: unknown = this.initOptions;
      for (const part of String(section).split(".")) {
        if (isRecord(cursor) && part in cursor) cursor = cursor[part];
        else {
          cursor = null;
          break;
        }
      }
      out.push(cursor ?? null);
    }
    return out;
  }

  private handleRegisterCapability(params: unknown): null {
    if (!isRecord(params)) return null;
    const registrations = Array.isArray(params.registrations) ? params.registrations : [];
    for (const registration of registrations) {
      if (!isRecord(registration)) continue;
      if (registration.method === "textDocument/diagnostic" && registration.id) {
        this.diagnosticRegistrations.add(String(registration.id));
      }
    }
    return null;
  }

  private handleUnregisterCapability(params: unknown): null {
    if (!isRecord(params)) return null;
    const unregistrations = Array.isArray(params.unregisterations)
      ? params.unregisterations
      : Array.isArray(params.registrations)
        ? params.registrations
        : [];
    for (const unregistration of unregistrations) {
      if (!isRecord(unregistration)) continue;
      if (unregistration.id) this.diagnosticRegistrations.delete(String(unregistration.id));
    }
    return null;
  }

  private handleNotification(method: string, message: LSPMessage): void {
    if (method !== "textDocument/publishDiagnostics") return;
    this.handlePublishDiagnostics(message.params);
  }

  private handlePublishDiagnostics(params: unknown): void {
    if (!isRecord(params)) return;
    const uri = params.uri;
    if (typeof uri !== "string") return;
    const target = uriToPath(uri);
    const rawDiagnostics = Array.isArray(params.diagnostics) ? params.diagnostics : [];
    const diagnostics = rawDiagnostics.filter((entry): entry is LSPDiagnostic => isRecord(entry));
    const version = typeof params.version === "number" ? params.version : null;

    const doc = this.docs.get(target) ?? newDocState(-1);
    this.docs.set(target, doc);
    if (this.seedFirstPush && !doc.seedSeen) {
      doc.seedSeen = true;
      doc.push = diagnostics;
      return;
    }
    doc.seedSeen = true;
    doc.push = diagnostics;
    doc.pushVersion = version !== null ? version : doc.version;
    this.pushCounter += 1;
    this.wakePushWaiters();
  }

  private wakePushWaiters(): void {
    for (const waiter of [...this.pushWaiters]) waiter();
  }

  // ------------------------------------------------------------------
  // plumbing de requests/notificaciones
  // ------------------------------------------------------------------

  private writeFrame(message: LSPMessage, context: string): void {
    const stdin = this.child?.stdin;
    if (!stdin || !this.isConnectionOpen()) {
      throw new LSPProtocolError(`cannot send ${context}: server connection closed`);
    }
    try {
      stdin.write(encodeMessage(message));
    } catch (error) {
      throw new LSPProtocolError(`send failed for ${context}`, { cause: error });
    }
  }

  private async sendRequest(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<unknown> {
    if (!this.isConnectionOpen()) {
      throw new LSPProtocolError(`cannot send ${method}: server connection closed`);
    }
    const id = this.nextId;
    this.nextId += 1;
    let resolveFn: (value: unknown) => void = () => undefined;
    let rejectFn: (error: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    const entry: PendingRequest = { resolve: resolveFn, reject: rejectFn, timer: null };
    this.pending.set(id, entry);
    if (timeoutMs !== undefined && timeoutMs > 0) {
      entry.timer = setTimeout(() => {
        if (this.pending.delete(id)) rejectFn(new LSPTimeoutError(method, timeoutMs));
      }, timeoutMs);
    }
    try {
      this.writeFrame(makeRequest(id, method, params), method);
      return await promise;
    } finally {
      const current = this.pending.get(id);
      if (current) {
        if (current.timer) clearTimeout(current.timer);
        this.pending.delete(id);
      }
    }
  }

  private async sendRequestWithRetry(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    for (let attempt = 0; attempt <= MAX_CONTENT_MODIFIED_RETRIES; attempt += 1) {
      try {
        return await this.sendRequest(method, params, timeoutMs);
      } catch (error) {
        const isContentModified =
          error instanceof LSPRequestError && error.code === ERROR_CONTENT_MODIFIED;
        if (isContentModified && attempt < MAX_CONTENT_MODIFIED_RETRIES) {
          await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
    throw new LSPProtocolError(`request ${method} exhausted retries`);
  }

  private notify(method: string, params?: unknown): void {
    try {
      this.writeFrame(makeNotification(method, params), method);
    } catch (error) {
      log.debug("lsp_notification_failed", {
        server_id: this.serverId,
        method,
        detail: String(error),
      });
    }
  }

  private async writeResponse(message: LSPMessage): Promise<void> {
    try {
      this.writeFrame(message, "server response");
    } catch {
      /* la conexión ya se cerró; no hay a quién responder */
    }
  }

  // ------------------------------------------------------------------
  // initialize / shutdown
  // ------------------------------------------------------------------

  private buildInitializeParams(): Record<string, unknown> {
    return {
      rootUri: fileUri(this.workspaceRoot),
      rootPath: this.workspaceRoot,
      processId: process.pid,
      workspaceFolders: [{ name: "workspace", uri: fileUri(this.workspaceRoot) }],
      initializationOptions: this.initOptions,
      capabilities: {
        window: { workDoneProgress: true },
        workspace: {
          configuration: true,
          workspaceFolders: true,
          didChangeWatchedFiles: { dynamicRegistration: true },
          diagnostics: { refreshSupport: false },
        },
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            didOpen: true,
            didChange: true,
            didSave: true,
            willSave: false,
            willSaveWaitUntil: false,
          },
          diagnostic: { dynamicRegistration: true, relatedDocumentSupport: true },
          publishDiagnostics: {
            relatedInformation: true,
            tagSupport: { valueSet: [1, 2] },
            versionSupport: true,
            codeDescriptionSupport: true,
            dataSupport: false,
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        },
        general: { positionEncodings: ["utf-16"] },
      },
    };
  }

  private async initialize(): Promise<void> {
    const result = await this.sendRequest(
      "initialize",
      this.buildInitializeParams(),
      INITIALIZE_TIMEOUT_MS,
    );
    this.initializeResult = result;
    this.notify("initialized", {});
    if (Object.keys(this.initOptions).length > 0) {
      this.notify("workspace/didChangeConfiguration", { settings: this.initOptions });
    }
  }

  /** Best-effort graceful shutdown: shutdown + exit + SIGTERM/SIGKILL. */
  async shutdown(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    try {
      if (this.isRunning) {
        try {
          await this.sendRequest("shutdown", undefined, SHUTDOWN_REQUEST_TIMEOUT_MS);
        } catch {
          /* ya en camino de apagado */
        }
        this.notify("exit");
      }
    } finally {
      this.currentState = "stopped";
      await this.cleanupProcess();
    }
  }

  private cleanupProcess(): Promise<void> {
    if (this.cleanupInFlight) return this.cleanupInFlight;
    const child = this.child;
    this.child = null;
    this.failConnection(new LSPProtocolError("client shutdown"));
    if (!child) {
      this.cleanupInFlight = Promise.resolve();
      return this.cleanupInFlight;
    }
    this.cleanupInFlight = (async () => {
      if (child.exitCode !== null) return;
      try {
        child.kill("SIGTERM");
      } catch {
        /* el proceso ya no existe */
      }
      const exited = await this.awaitExit(child, SHUTDOWN_GRACE_MS);
      if (exited) return;
      try {
        child.kill("SIGKILL");
      } catch {
        /* el proceso ya no existe */
      }
      await this.awaitExit(child, SHUTDOWN_GRACE_MS);
    })();
    return this.cleanupInFlight;
  }

  private awaitExit(child: LSPChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(exited);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      child.on("exit", () => finish(true));
    });
  }

  // ------------------------------------------------------------------
  // sync de documentos
  // ------------------------------------------------------------------

  async openFile(filePath: string, options: { languageId?: string } = {}): Promise<number> {
    if (!this.isRunning) throw new LSPProtocolError("client not running");
    const absolute = path.resolve(filePath);
    let text: string;
    try {
      text = readFileSync(absolute, "utf8");
    } catch (error) {
      throw new LSPProtocolError(`cannot read ${absolute}`, { cause: error });
    }
    const uri = fileUri(absolute);
    const existing = this.docs.get(absolute);

    if (existing && existing.version >= 0) {
      this.notify("workspace/didChangeWatchedFiles", { changes: [{ uri, type: 2 }] });
      const newVersion = existing.version + 1;
      const contentChanges =
        this.syncKind() === 2
          ? [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: endPosition(existing.text),
                },
                text,
              },
            ]
          : [{ text }];
      this.notify("textDocument/didChange", {
        textDocument: { uri, version: newVersion },
        contentChanges,
      });
      existing.version = newVersion;
      existing.text = text;
      return newVersion;
    }

    this.notify("workspace/didChangeWatchedFiles", { changes: [{ uri, type: 1 }] });
    this.docs.set(absolute, newDocState(0, text));
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: options.languageId ?? "plaintext", version: 0, text },
    });
    return 0;
  }

  async saveFile(filePath: string): Promise<void> {
    if (!this.isRunning) return;
    const absolute = path.resolve(filePath);
    this.notify("textDocument/didSave", { textDocument: { uri: fileUri(absolute) } });
  }

  private syncKind(): number {
    const capabilities = isRecord(this.initializeResult)
      ? this.initializeResult.capabilities
      : undefined;
    if (!isRecord(capabilities)) return 1;
    const sync = capabilities.textDocumentSync;
    if (typeof sync === "number") return sync;
    if (isRecord(sync) && typeof sync.change === "number") return sync.change;
    return 1;
  }

  // ------------------------------------------------------------------
  // diagnósticos: pull + wait
  // ------------------------------------------------------------------

  private async pullDocumentDiagnostics(absolute: string): Promise<void> {
    const doc = this.docs.get(absolute);
    const sentVersion = doc ? doc.version : -1;
    try {
      const result = await this.sendRequestWithRetry(
        "textDocument/diagnostic",
        { textDocument: { uri: fileUri(absolute) } },
        DIAGNOSTICS_REQUEST_TIMEOUT_MS,
      );
      if (!isRecord(result)) return;
      if (Array.isArray(result.items)) {
        const target = this.docs.get(absolute) ?? this.ensureDoc(absolute, -1);
        target.pull = result.items.filter((entry): entry is LSPDiagnostic => isRecord(entry));
        target.pullVersion = sentVersion;
      }
      if (isRecord(result.relatedDocuments)) {
        for (const [uri, sub] of Object.entries(result.relatedDocuments)) {
          if (!isRecord(sub) || !Array.isArray(sub.items)) continue;
          const related = this.ensureDoc(uriToPath(uri), -1);
          related.pull = sub.items.filter((entry): entry is LSPDiagnostic => isRecord(entry));
          related.pullVersion = related.version;
        }
      }
    } catch (error) {
      log.debug("lsp_pull_failed", { server_id: this.serverId, detail: String(error) });
    }
  }

  private ensureDoc(absolute: string, version: number): DocState {
    const existing = this.docs.get(absolute);
    if (existing) return existing;
    const created = newDocState(version);
    this.docs.set(absolute, created);
    return created;
  }

  /**
   * Espera diagnósticos frescos para `filePath` en `version`.
   *
   * Corre en paralelo el pull de documento y la espera del push, con
   * debounce. Devuelve `false` cuando se agota el presupuesto: eso significa
   * "sin datos", nunca "sin errores".
   */
  async waitForDiagnostics(
    filePath: string,
    version: number,
    options: { mode?: "document" | "full"; timeoutMs?: number } = {},
  ): Promise<boolean> {
    const budget =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? options.timeoutMs
        : options.mode === "full"
          ? DIAGNOSTICS_FULL_WAIT_MS
          : DIAGNOSTICS_DOCUMENT_WAIT_MS;
    const deadline = Date.now() + budget;
    const absolute = path.resolve(filePath);

    for (;;) {
      if (!this.isConnectionOpen()) {
        throw new LSPProtocolError("server connection closed while waiting for diagnostics");
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;

      const pushWait = this.waitForFreshPush(absolute, version, remaining);
      const pullTask = this.pullDocumentDiagnostics(absolute);
      let pushWon: boolean;
      try {
        pushWon = await this.racePushAgainstPull(pushWait.promise, pullTask, remaining);
      } finally {
        pushWait.cancel();
      }

      const doc = this.docs.get(absolute);
      if (pushWon && doc && freshPush(doc, version)) {
        await this.debouncePushes();
        return true;
      }
      if (doc && freshPull(doc, version)) return true;
    }
  }

  private async racePushAgainstPull(
    pushPromise: Promise<boolean>,
    pullPromise: Promise<void>,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      timer = setTimeout(() => finish(false), timeoutMs);
      pushPromise.then(
        (value) => finish(value),
        () => finish(false),
      );
      pullPromise.then(
        () => finish(false),
        () => finish(false),
      );
    });
  }

  private waitForFreshPush(absolute: string, version: number, timeoutMs: number): CancellableWait {
    let settled = false;
    let resolveFn: (value: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((resolve) => {
      resolveFn = resolve;
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      this.pushWaiters.delete(check);
      resolveFn(value);
    };
    const check = () => {
      const doc = this.docs.get(absolute);
      if (doc && freshPush(doc, version)) finish(true);
    };
    this.pushWaiters.add(check);
    timer = setTimeout(() => finish(false), timeoutMs);
    check();
    return { promise, cancel: () => finish(false) };
  }

  private wakePushSignal(timeoutMs: number): Promise<void> {
    let settled = false;
    let resolveFn: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      this.pushWaiters.delete(check);
      resolveFn();
    };
    const check = () => finish();
    this.pushWaiters.add(check);
    timer = setTimeout(finish, timeoutMs);
    return promise;
  }

  /** Espera corta por si el servidor manda los diagnósticos en ráfaga. */
  private async debouncePushes(): Promise<void> {
    const baseline = this.pushCounter;
    const deadline = Date.now() + PUSH_DEBOUNCE_MS;
    while (this.pushCounter === baseline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      await this.wakePushSignal(remaining);
    }
  }

  /** Diagnósticos actuales de un archivo, fusionados y deduplicados. */
  diagnosticsFor(filePath: string, options: { freshOnly?: boolean } = {}): LSPDiagnostic[] {
    const doc = this.docs.get(path.resolve(filePath));
    if (!doc) return [];
    if (options.freshOnly) {
      return dedupeDiagnostics(freshPush(doc) ? doc.push : [], freshPull(doc) ? doc.pull : []);
    }
    return dedupeDiagnostics(doc.push, doc.pull);
  }
}
