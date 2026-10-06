/**
 * Orquestación del servicio LSP (capa de emergencia / fallback).
 *
 * `LSPService` es el puente entre la capa síncrona de archivos y los
 * clientes `LSPClient`.
 *
 * Decisiones de diseño:
 *
 * - Un cliente por clave `(server_id, workspace_root)`, spawn perezoso: la
 *   primera petición de una clave spawnea, las siguientes reutilizan.
 *
 * - Un **broken-set** registra los pares que fallaron al spawnearear o al
 *   inicializar; no se reintentan mientras viva el servicio (espejo del
 *   diseño de OpenCode).
 *
 * - Un **delta baseline** guarda "diagnósticos del último snapshot" por
 *   archivo: `snapshotBaseline()` se llama ANTES de una escritura y el
 *   siguiente `getDiagnostics()` devuelve solo lo nuevo respecto a esa
 *   baseline, con roll-forward al terminar.
 *
 * - El reaper de clientes idle se crea **perezosamente** en el primer
 *   spawn, con `unref()` para no mantener vivo el proceso; importar este
 *   módulo no arranca temporizadores ni hilos.
 *
 * El servicio está **apagado por defecto**: `enabled` debe ser `=== true`
 * en las opciones. Sin eso, ningún código se ejecuta, ningún spawn ocurre
 * y todos los getters devuelven "inactivo".
 */
import path from "node:path";

import { createLogger } from "../logger";
import {
  LSPClient,
  createGatedSpawn,
  defaultSpawnProcess,
  diagnosticKey,
  DIAGNOSTICS_DOCUMENT_WAIT_MS,
  type LSPDiagnostic,
  type LSPSpawnProcess,
} from "./client";
import { LSPTimeoutError } from "./protocol";
import type { BinaryResolver, InstallStrategy } from "./install";
import {
  findServerForFile,
  languageIdFor,
  type ServerContext,
  type ServerDef,
  type SpawnSpec,
} from "./servers";
import { clearCache, resolveWorkspaceForFile } from "./workspace";

const log = createLogger("lsp.service");

export const DEFAULT_IDLE_TIMEOUT_MS = 600_000;
export const MIN_IDLE_TIMEOUT_MS = 30_000;
const REAPER_INTERVAL_CAP_MS = 60_000;
const SNAPSHOT_EXTRA_BUDGET_MS = 3_000;
const SNAPSHOT_MIN_BUDGET_MS = 8_000;
const ROLL_FORWARD_TIMEOUT_MS = 2_000;
const DIAGNOSTICS_EXTRA_BUDGET_MS = 2_000;

/** Remapea una línea pre-edición a post-edición; `null` si la línea se borró. */
export type LineShift = (line: number) => number | null;

/**
 * Devuelve una copia de `diagnostic` con su rango remapeado por `shift`.
 *
 * `null` si la línea inicial se borró (el diagnóstico ya no aplica). Si solo
 * el final se borró, el rango colapsa a una línea en el inicio corrido.
 * El original nunca se muta.
 */
export function shiftDiagnosticRange(
  diagnostic: LSPDiagnostic,
  shift: LineShift,
): LSPDiagnostic | null {
  const range = diagnostic.range ?? {};
  const start = range.start ?? {};
  const end = range.end ?? {};
  const preStartLine = start.line ?? 0;
  const preEndLine = end.line ?? preStartLine;

  const newStartLine = shift(preStartLine);
  if (newStartLine === null) return null;
  const newEndLine = shift(preEndLine) ?? newStartLine;

  return {
    ...diagnostic,
    range: {
      start: { line: newStartLine, character: start.character ?? 0 },
      end: { line: newEndLine, character: end.character ?? 0 },
    },
  };
}

/**
 * Aplica `shift` a toda la baseline y descarta los diagnosticos cuya línea
 * quedó en una región borrada por la edición.
 *
 * El mapa de shift se inyecta desde fuera (p. ej. un diff propio): este
 * módulo no calcula diffs.
 */
export function shiftBaseline(
  baseline: readonly LSPDiagnostic[],
  shift: LineShift,
): LSPDiagnostic[] {
  const out: LSPDiagnostic[] = [];
  for (const diagnostic of baseline) {
    if (typeof diagnostic !== "object" || diagnostic === null) continue;
    const shifted = shiftDiagnosticRange(diagnostic, shift);
    if (shifted !== null) out.push(shifted);
  }
  return out;
}

export interface LSPClientLike {
  readonly serverId: string;
  readonly workspaceRoot: string;
  readonly state: string;
  readonly isRunning: boolean;
  start(): Promise<void>;
  shutdown(): Promise<void>;
  openFile(filePath: string, options?: { languageId?: string }): Promise<number>;
  saveFile(filePath: string): Promise<void>;
  waitForDiagnostics(
    filePath: string,
    version: number,
    options?: { mode?: "document" | "full"; timeoutMs?: number },
  ): Promise<boolean>;
  diagnosticsFor(filePath: string, options?: { freshOnly?: boolean }): LSPDiagnostic[];
}

export interface LSPClientSpawnSpec extends SpawnSpec {
  serverId: string;
  spawnProcess: LSPSpawnProcess;
}

export type LSPClientFactory = (spec: LSPClientSpawnSpec) => LSPClientLike;

export interface LSPServiceOptions {
  /** Apagado por defecto; debe ser `=== true` para activar el servicio. */
  enabled?: boolean;
  waitMode?: "document" | "full";
  waitTimeoutMs?: number;
  installStrategy?: InstallStrategy;
  binaryOverrides?: Record<string, string[]>;
  envOverrides?: Record<string, Record<string, string>>;
  initOverrides?: Record<string, Record<string, unknown>>;
  disabledServers?: readonly string[];
  idleTimeoutMs?: number;
  findExecutable?: BinaryResolver;
  spawnProcess?: LSPSpawnProcess;
  clientFactory?: LSPClientFactory;
  now?: () => number;
}

export interface LSPServiceStatus {
  enabled: boolean;
  active: boolean;
  waitMode: "document" | "full";
  waitTimeoutMs: number;
  installStrategy: InstallStrategy;
  clients: Array<{ serverId: string; workspaceRoot: string; state: string; running: boolean }>;
  broken: string[];
  disabledServers: string[];
  reaperRunning: boolean;
}

export interface GetDiagnosticsOptions {
  delta?: boolean;
  timeoutMs?: number;
  lineShift?: LineShift;
}

function clientKey(serverId: string, root: string): string {
  return `${serverId}\0${root}`;
}

function displayKey(key: string): string {
  return key.replace("\0", "::");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LSPTimeoutError(operation, timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const defaultClientFactory: LSPClientFactory = (spec) =>
  new LSPClient({
    serverId: spec.serverId,
    workspaceRoot: spec.workspaceRoot,
    command: spec.command,
    env: spec.env,
    cwd: spec.cwd,
    initializationOptions: spec.initializationOptions,
    seedDiagnosticsOnFirstPush: spec.seedDiagnosticsOnFirstPush,
    spawnProcess: spec.spawnProcess,
  });

export class LSPService {
  private readonly enabled: boolean;
  private readonly waitMode: "document" | "full";
  private readonly waitTimeoutMs: number;
  private readonly installStrategy: InstallStrategy;
  private readonly binaryOverrides: Record<string, string[]>;
  private readonly envOverrides: Record<string, Record<string, string>>;
  private readonly initOverrides: Record<string, Record<string, unknown>>;
  private readonly disabledServers: Set<string>;
  private readonly idleTimeoutMs: number;
  private readonly findExecutableResolver: BinaryResolver | undefined;
  private readonly createClient: LSPClientFactory;
  private readonly now: () => number;
  private readonly gatedSpawn: LSPSpawnProcess;

  private readonly clients = new Map<string, LSPClientLike>();
  private readonly broken = new Set<string>();
  private readonly spawning = new Map<string, Promise<LSPClientLike | null>>();
  private readonly lastUsed = new Map<string, number>();
  private readonly deltaBaseline = new Map<string, LSPDiagnostic[]>();

  private reaperTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;

  constructor(options: LSPServiceOptions = {}) {
    this.enabled = options.enabled === true;
    this.waitMode = options.waitMode === "full" ? "full" : "document";
    this.waitTimeoutMs = options.waitTimeoutMs ?? DIAGNOSTICS_DOCUMENT_WAIT_MS;
    this.installStrategy = options.installStrategy ?? "manual";
    this.binaryOverrides = options.binaryOverrides ?? {};
    this.envOverrides = options.envOverrides ?? {};
    this.initOverrides = options.initOverrides ?? {};
    this.disabledServers = new Set(options.disabledServers ?? []);
    const requestedIdle = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.idleTimeoutMs =
      requestedIdle > 0 && requestedIdle < MIN_IDLE_TIMEOUT_MS
        ? MIN_IDLE_TIMEOUT_MS
        : requestedIdle;
    this.findExecutableResolver = options.findExecutable;
    this.createClient = options.clientFactory ?? defaultClientFactory;
    this.now = options.now ?? (() => Date.now());
    this.gatedSpawn = createGatedSpawn(
      () => this.enabled === true,
      options.spawnProcess ?? defaultSpawnProcess,
    );
  }

  /** `true` solo si el servicio está explícitamente habilitado. */
  isActive(): boolean {
    return this.enabled === true;
  }

  /** `true` si el LSP debe correr para este archivo (workspace + broken-set). */
  enabledFor(filePath: string): boolean {
    if (this.enabled !== true) return false;
    const server = findServerForFile(filePath);
    if (server === null || this.disabledServers.has(server.serverId)) return false;
    const workspace = resolveWorkspaceForFile(filePath);
    if (workspace.root === null || !workspace.gated) return false;
    const root = this.perServerRoot(server, filePath, workspace.root);
    return !this.broken.has(clientKey(server.serverId, root));
  }

  private perServerRoot(server: ServerDef, filePath: string, workspaceRoot: string): string {
    try {
      return server.resolveRoot(filePath, workspaceRoot) ?? workspaceRoot;
    } catch {
      return workspaceRoot;
    }
  }

  /**
   * Congela los diagnósticos actuales de `filePath` como baseline delta.
   * Se llama ANTES de una escritura; es best-effort y jamás rompe la write.
   */
  async snapshotBaseline(filePath: string): Promise<void> {
    if (!this.enabledFor(filePath)) return;
    const absolute = path.resolve(filePath);
    try {
      const budgetMs = Math.max(
        SNAPSHOT_MIN_BUDGET_MS,
        this.waitTimeoutMs + SNAPSHOT_EXTRA_BUDGET_MS,
      );
      const diagnostics = await withTimeout(
        this.snapshotAsync(filePath),
        budgetMs,
        "snapshotBaseline",
      );
      this.deltaBaseline.set(absolute, diagnostics);
    } catch (error) {
      log.debug("lsp_baseline_snapshot_failed", { path: filePath, detail: String(error) });
      this.markBrokenForFile(filePath, error);
      this.deltaBaseline.set(absolute, []);
    }
  }

  /**
   * Abre `filePath` en su servidor, espera diagnósticos frescos y devuelve.
   *
   * Con `delta` (por defecto) filtra lo que ya estaba en la baseline y
   * luego avanza la baseline al estado recién emitido. Devuelve `[]` cuando
   * el servicio está apagado, no hay workspace, no hay servidor o el
   * servidor no puede spawnearear. Nunca lanza.
   */
  async getDiagnostics(
    filePath: string,
    options: GetDiagnosticsOptions = {},
  ): Promise<LSPDiagnostic[]> {
    const delta = options.delta !== false;
    if (!this.enabledFor(filePath)) return [];
    const server = findServerForFile(filePath);
    const serverId = server ? server.serverId : "?";
    const absolute = path.resolve(filePath);
    const timeoutMs = options.timeoutMs ?? this.waitTimeoutMs + DIAGNOSTICS_EXTRA_BUDGET_MS;

    let diagnostics: LSPDiagnostic[] | null;
    try {
      diagnostics = await withTimeout(this.openAndWait(filePath), timeoutMs, "getDiagnostics");
    } catch (error) {
      log.debug("lsp_diagnostics_failed", {
        server_id: serverId,
        path: filePath,
        detail: String(error),
      });
      this.markBrokenForFile(filePath, error);
      return [];
    }

    if (diagnostics === null) {
      log.debug("lsp_diagnostics_no_verdict", { server_id: serverId, path: filePath });
      return [];
    }

    if (delta) {
      const baseline = this.deltaBaseline.get(absolute) ?? [];
      if (baseline.length > 0) {
        const comparable = options.lineShift
          ? shiftBaseline(baseline, options.lineShift)
          : baseline;
        const seen = new Set(comparable.map((entry) => diagnosticKey(entry)));
        diagnostics = diagnostics.filter((entry) => !seen.has(diagnosticKey(entry)));
      }
      try {
        const fresh = await withTimeout(
          this.currentDiagnostics(filePath),
          ROLL_FORWARD_TIMEOUT_MS,
          "rollBaseline",
        );
        if (fresh.length > 0) this.deltaBaseline.set(absolute, fresh);
      } catch {
        /* best-effort: si no se pudo releer, la baseline queda como estaba */
      }
    }

    if (diagnostics.length > 0) {
      log.debug("lsp_diagnostics", {
        server_id: serverId,
        path: filePath,
        count: diagnostics.length,
      });
    } else {
      log.debug("lsp_clean", { server_id: serverId, path: filePath });
    }
    return diagnostics;
  }

  /** Snapshot del servicio para reportes/CLI. */
  getStatus(): LSPServiceStatus {
    const clients = [...this.clients.entries()].map(([key, client]) => {
      const [serverId, workspaceRoot] = key.split("\0");
      return {
        serverId: serverId ?? "",
        workspaceRoot: workspaceRoot ?? "",
        state: client.state,
        running: client.isRunning,
      };
    });
    return {
      enabled: this.enabled,
      active: this.enabled === true,
      waitMode: this.waitMode,
      waitTimeoutMs: this.waitTimeoutMs,
      installStrategy: this.installStrategy,
      clients,
      broken: [...this.broken].map(displayKey).sort(),
      disabledServers: [...this.disabledServers].sort(),
      reaperRunning: this.reaperTimer !== null,
    };
  }

  /**
   * Cierra clientes cuyo último uso supera el presupuesto idle.
   * Devuelve las claves reapadas (útil para tests y reportes).
   */
  async reapIdleOnce(nowMs: number = this.now()): Promise<string[]> {
    const cutoff = nowMs - this.idleTimeoutMs;
    const reaped: string[] = [];
    for (const [key, last] of this.lastUsed) {
      if (last >= cutoff) continue;
      const client = this.clients.get(key);
      if (!client) continue;
      this.clients.delete(key);
      this.lastUsed.delete(key);
      reaped.push(key);
    }
    if (reaped.length > 0) {
      log.debug("lsp_idle_reaped", {
        clients: reaped.map(displayKey).join(","),
        idle_timeout_ms: this.idleTimeoutMs,
      });
    }
    await Promise.all(
      reaped.map(async (key) => {
        const client = this.shutdownTargets.get(key);
        if (!client) return;
        try {
          await client.shutdown();
        } catch {
          /* ya murió */
        }
      }),
    );
    return reaped;
  }

  /**
   * Apaga todo: temporizador del reaper, clientes y caché de workspace.
   * Idempotente y seguro con el servicio deshabilitado.
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.reaperTimer !== null) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
    const clients = [...this.clients.values()];
    this.clients.clear();
    this.broken.clear();
    this.lastUsed.clear();
    this.spawning.clear();
    this.shutdownTargets.clear();
    await Promise.all(
      clients.map(async (client) => {
        try {
          await client.shutdown();
        } catch {
          /* apagado best-effort */
        }
      }),
    );
    clearCache();
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------

  /** Clientes reapables (clave → cliente) mientras el reaper opera. */
  private readonly shutdownTargets = new Map<string, LSPClientLike>();

  private async snapshotAsync(filePath: string): Promise<LSPDiagnostic[]> {
    const client = await this.getOrSpawn(filePath);
    if (client === null) return [];
    try {
      const version = await client.openFile(filePath, { languageId: languageIdFor(filePath) });
      const fresh = await client.waitForDiagnostics(filePath, version, { mode: this.waitMode });
      this.touch(client);
      if (!fresh) return [];
      return client.diagnosticsFor(filePath, { freshOnly: true });
    } catch (error) {
      log.debug("lsp_snapshot_open_failed", { path: filePath, detail: String(error) });
      return [];
    }
  }

  private async openAndWait(filePath: string): Promise<LSPDiagnostic[] | null> {
    const client = await this.getOrSpawn(filePath);
    if (client === null) return null;
    try {
      const version = await client.openFile(filePath, { languageId: languageIdFor(filePath) });
      await client.saveFile(filePath);
      const fresh = await client.waitForDiagnostics(filePath, version, {
        mode: this.waitMode,
        timeoutMs: this.waitTimeoutMs,
      });
      this.touch(client);
      if (!fresh) return null;
      return client.diagnosticsFor(filePath, { freshOnly: true });
    } catch (error) {
      log.debug("lsp_open_wait_failed", { path: filePath, detail: String(error) });
      return null;
    }
  }

  private async currentDiagnostics(filePath: string): Promise<LSPDiagnostic[]> {
    const server = findServerForFile(filePath);
    if (server === null) return [];
    const workspace = resolveWorkspaceForFile(filePath);
    if (workspace.root === null || !workspace.gated) return [];
    const key = clientKey(server.serverId, this.perServerRoot(server, filePath, workspace.root));
    const client = this.clients.get(key);
    if (!client) return [];
    return client.diagnosticsFor(filePath, { freshOnly: true });
  }

  private async getOrSpawn(filePath: string): Promise<LSPClientLike | null> {
    const server = findServerForFile(filePath);
    if (server === null) return null;
    if (this.disabledServers.has(server.serverId)) {
      log.debug("lsp_server_disabled", { server_id: server.serverId, path: filePath });
      return null;
    }
    const workspace = resolveWorkspaceForFile(filePath);
    if (workspace.root === null || !workspace.gated) {
      log.debug("lsp_no_project_root", { server_id: server.serverId, path: filePath });
      return null;
    }
    const perServerRoot = server.resolveRoot(filePath, workspace.root);
    if (perServerRoot === null) {
      log.debug("lsp_server_gated_off", {
        server_id: server.serverId,
        path: filePath,
        reason: "exclude marker hit",
      });
      return null;
    }

    const key = clientKey(server.serverId, perServerRoot);
    if (this.broken.has(key)) return null;
    const existing = this.clients.get(key);
    if (existing && existing.isRunning) {
      this.lastUsed.set(key, this.now());
      return existing;
    }
    const inFlight = this.spawning.get(key);
    if (inFlight !== undefined) {
      try {
        return await inFlight;
      } catch {
        return null;
      }
    }

    const creation = this.spawnClient(server, perServerRoot, key);
    this.spawning.set(key, creation);
    try {
      return await creation;
    } finally {
      this.spawning.delete(key);
    }
  }

  private async spawnClient(
    server: ServerDef,
    perServerRoot: string,
    key: string,
  ): Promise<LSPClientLike | null> {
    const context: ServerContext = {
      workspaceRoot: perServerRoot,
      installStrategy: this.installStrategy,
      binaryOverrides: this.binaryOverrides,
      envOverrides: this.envOverrides,
      initOverrides: this.initOverrides,
      findExecutable: this.findExecutableResolver,
    };
    const spec = server.buildSpawn(perServerRoot, context);
    if (spec === null) {
      log.warn("lsp_server_unavailable", { server_id: server.serverId, root: perServerRoot });
      this.broken.add(key);
      return null;
    }
    const client = this.createClient({
      ...spec,
      serverId: server.serverId,
      spawnProcess: this.gatedSpawn,
    });
    try {
      await client.start();
    } catch (error) {
      log.warn("lsp_spawn_failed", {
        server_id: server.serverId,
        root: perServerRoot,
        detail: String(error),
      });
      this.broken.add(key);
      try {
        await client.shutdown();
      } catch {
        /* apagado best-effort */
      }
      return null;
    }
    this.clients.set(key, client);
    this.shutdownTargets.set(key, client);
    this.lastUsed.set(key, this.now());
    this.ensureReaper();
    log.debug("lsp_client_active", { server_id: server.serverId, root: perServerRoot });
    return client;
  }

  private markBrokenForFile(filePath: string, error: unknown): void {
    const server = findServerForFile(filePath);
    if (server === null) return;
    const workspace = resolveWorkspaceForFile(filePath);
    if (workspace.root === null || !workspace.gated) return;
    const root = this.perServerRoot(server, filePath, workspace.root);
    const key = clientKey(server.serverId, root);
    const alreadyBroken = this.broken.has(key);
    this.broken.add(key);

    const client = this.clients.get(key);
    if (client) {
      this.clients.delete(key);
      this.lastUsed.delete(key);
      this.shutdownTargets.delete(key);
      void client.shutdown().catch(() => undefined);
    }
    if (!alreadyBroken) {
      log.warn("lsp_spawn_failed", {
        server_id: server.serverId,
        root,
        detail: String(error),
      });
    }
  }

  private touch(client: LSPClientLike): void {
    const key = clientKey(client.serverId, client.workspaceRoot);
    if (this.clients.has(key)) this.lastUsed.set(key, this.now());
  }

  private ensureReaper(): void {
    if (this.shuttingDown) return;
    if (this.idleTimeoutMs <= 0 || this.reaperTimer !== null) return;
    const interval = Math.min(REAPER_INTERVAL_CAP_MS, this.idleTimeoutMs);
    const timer = setInterval(() => {
      void this.reapIdleOnce().catch((error: unknown) => {
        log.debug("lsp_reaper_sweep_failed", { detail: String(error) });
      });
    }, interval);
    if (typeof timer.unref === "function") timer.unref();
    this.reaperTimer = timer;
  }
}

/** Crea el servicio LSP. Sin opciones: **apagado** (`enabled` no es `true`). */
export function createLSPService(options: LSPServiceOptions = {}): LSPService {
  return new LSPService(options);
}
