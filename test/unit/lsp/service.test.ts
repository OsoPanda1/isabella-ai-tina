/**
 * Orquestación del servicio LSP (`src/lib/lsp/service.ts`).
 *
 * Regla del repo: spawn falso inyectado (`LSPSpawnProcess`), nunca binarios
 * reales ni red. Lo que se verifica aquí es el contrato de apagado por
 * defecto y el broken-set fail-closed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_IDLE_TIMEOUT_MS,
  LSPService,
  createLSPService,
  shiftBaseline,
  shiftDiagnosticRange,
  type LSPDiagnostic,
  type LSPSpawnProcess,
} from "@/lib/lsp";
import { FakeLSPServer } from "./fake-lsp";

let tmp: string;
let gitRoot: string;
let pythonFile: string;
let tsFile: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "isabella-lsp-svc-"));
  gitRoot = path.join(tmp, "proyecto");
  mkdirSync(path.join(gitRoot, ".git"), { recursive: true });
  pythonFile = path.join(gitRoot, "mod.py");
  tsFile = path.join(gitRoot, "app.ts");
  writeFileSync(pythonFile, "print('x')\n");
  writeFileSync(tsFile, "export const a = 1;\n");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function failingSpawn(counter: { count: number }): LSPSpawnProcess {
  return () => {
    counter.count += 1;
    throw new Error("binario inexistente (doble falso)");
  };
}

describe("service — apagado por defecto", () => {
  it("sin enabled:true los getters reportan inactivo y no spawnea", async () => {
    const counter = { count: 0 };
    const service = new LSPService({
      spawnProcess: failingSpawn(counter),
      findExecutable: () => path.join(gitRoot, "fake-langserver"),
    });

    expect(service.isActive()).toBe(false);

    const status = service.getStatus();
    expect(status.enabled).toBe(false);
    expect(status.active).toBe(false);
    expect(status.clients).toEqual([]);
    expect(status.broken).toEqual([]);
    expect(status.disabledServers).toEqual([]);
    expect(status.reaperRunning).toBe(false);

    expect(service.enabledFor(tsFile)).toBe(false);
    expect(service.enabledFor(pythonFile)).toBe(false);
    expect(await service.getDiagnostics(tsFile)).toEqual([]);
    expect(await service.getDiagnostics(pythonFile, { delta: false })).toEqual([]);
    await service.snapshotBaseline(tsFile);

    expect(counter.count).toBe(0);

    await service.shutdown();
    const afterShutdown = service.getStatus();
    expect(afterShutdown.clients).toEqual([]);
    expect(afterShutdown.broken).toEqual([]);
    expect(afterShutdown.reaperRunning).toBe(false);
    expect(counter.count).toBe(0);
  });

  it("createLSPService solo se activa con enabled:true", () => {
    expect(createLSPService().isActive()).toBe(false);
    expect(createLSPService({}).isActive()).toBe(false);
    expect(new LSPService().isActive()).toBe(false);
    expect(createLSPService({ enabled: false }).isActive()).toBe(false);
    expect(createLSPService({ enabled: true }).isActive()).toBe(true);
    expect(createLSPService({ enabled: true }).getStatus()).toMatchObject({
      enabled: true,
      active: true,
    });
  });

  it("refleja waitMode, waitTimeoutMs, installStrategy y disabledServers", () => {
    const service = createLSPService({
      waitMode: "full",
      waitTimeoutMs: 1_234,
      installStrategy: "off",
      disabledServers: ["typescript"],
    });
    expect(service.getStatus()).toMatchObject({
      enabled: false,
      waitMode: "full",
      waitTimeoutMs: 1_234,
      installStrategy: "off",
      disabledServers: ["typescript"],
    });
  });
});

describe("service — broken-set con enabled:true", () => {
  it("un fallo de spawn va al broken-set y no se reintenta", async () => {
    const counter = { count: 0 };
    const service = new LSPService({
      enabled: true,
      spawnProcess: failingSpawn(counter),
      findExecutable: () => path.join(gitRoot, "fake-langserver"),
    });

    expect(service.enabledFor(pythonFile)).toBe(true);
    expect(await service.getDiagnostics(pythonFile)).toEqual([]);
    expect(counter.count).toBe(1);

    expect(service.enabledFor(pythonFile)).toBe(false);
    expect(await service.getDiagnostics(pythonFile)).toEqual([]);
    expect(await service.getDiagnostics(pythonFile)).toEqual([]);
    expect(counter.count).toBe(1);

    const status = service.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.broken).toEqual([`pyright::${gitRoot}`]);
    expect(status.clients).toEqual([]);
    expect(status.reaperRunning).toBe(false);

    await service.shutdown();
  });

  it("disabledServers apaga un servidor aunque el servicio esté habilitado", async () => {
    const fake = new FakeLSPServer({ autoDiagnostics: [] });
    const service = new LSPService({
      enabled: true,
      spawnProcess: fake.spawn,
      findExecutable: () => path.join(gitRoot, "fake-tsserver"),
      disabledServers: ["typescript"],
    });

    expect(service.enabledFor(tsFile)).toBe(false);
    expect(await service.getDiagnostics(tsFile)).toEqual([]);
    expect(fake.spawnCalls).toHaveLength(0);
    await service.shutdown();
  });
});

describe("service — con spawn falso", () => {
  it("handshake, cliente reutilizado, delta sobre baseline y reap idle", async () => {
    const first: LSPDiagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      severity: 1,
      message: "error esperado",
    };
    const second: LSPDiagnostic = {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
      severity: 2,
      message: "error nuevo",
    };
    const pending: LSPDiagnostic[] = [first];
    const fake = new FakeLSPServer({
      capabilities: { textDocumentSync: 1 },
      autoDiagnostics: pending,
    });
    const service = new LSPService({
      enabled: true,
      spawnProcess: fake.spawn,
      findExecutable: () => path.join(gitRoot, "fake-tsserver"),
    });

    expect(service.enabledFor(tsFile)).toBe(true);
    expect(await service.getDiagnostics(tsFile)).toEqual([first]);
    expect(fake.spawnCalls).toHaveLength(1);
    expect(fake.spawnCalls[0]?.command).toBe(path.join(gitRoot, "fake-tsserver"));
    expect(fake.spawnCalls[0]?.args).toEqual(["--stdio"]);

    const status = service.getStatus();
    expect(status.clients).toEqual([
      { serverId: "typescript", workspaceRoot: gitRoot, state: "running", running: true },
    ]);
    expect(status.broken).toEqual([]);

    pending.push(second);
    expect(await service.getDiagnostics(tsFile)).toEqual([second]);
    expect(fake.spawnCalls).toHaveLength(1);

    const reaped = await service.reapIdleOnce(Date.now() + DEFAULT_IDLE_TIMEOUT_MS + 1_000);
    expect(reaped).toEqual([`typescript\0${gitRoot}`]);
    expect(service.getStatus().clients).toEqual([]);

    await service.shutdown();
    expect(fake.requests.some((request) => request.method === "shutdown")).toBe(true);
  });
});

describe("service — remapeo de rangos", () => {
  const base: LSPDiagnostic = {
    range: { start: { line: 10, character: 2 }, end: { line: 12, character: 5 } },
    severity: 1,
    message: "x",
  };

  it("shiftDiagnosticRange remapea sin mutar el original", () => {
    const shifted = shiftDiagnosticRange(base, (line) => line - 5);
    expect(shifted?.range).toEqual({
      start: { line: 5, character: 2 },
      end: { line: 7, character: 5 },
    });
    expect(shifted?.message).toBe("x");
    expect(base.range?.start.line).toBe(10);
    expect(shiftDiagnosticRange(base, (line) => (line === 10 ? null : line))).toBeNull();
  });

  it("shiftDiagnosticRange tolera diagnósticos sin rango", () => {
    const bare: LSPDiagnostic = { message: "sin rango" };
    expect(shiftDiagnosticRange(bare, () => 3)).toEqual({
      message: "sin rango",
      range: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } },
    });
  });

  it("shiftBaseline descarta los diagnósticos caídos en zonas borradas", () => {
    const keep: LSPDiagnostic = {
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
      message: "queda",
    };
    const baseline = [base, keep];
    const shifted = shiftBaseline(baseline, (line) => (line === 10 ? null : line));
    expect(shifted).toHaveLength(1);
    expect(shifted[0]?.message).toBe("queda");
    expect(baseline).toHaveLength(2);
  });
});
