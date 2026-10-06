/**
 * Barrel público del subsistema LSP (`src/lib/lsp/index.ts`).
 *
 * Verifica que la superficie exportada existe en runtime y que el servicio
 * nace apagado, tal como documenta el barrel.
 */
import { describe, expect, it } from "vitest";

import * as lsp from "@/lib/lsp";

describe("lsp — barrel", () => {
  it("expone la API pública declarada", () => {
    expect(typeof lsp.LSPService).toBe("function");
    expect(typeof lsp.createLSPService).toBe("function");
    expect(typeof lsp.LSPClient).toBe("function");
    expect(typeof lsp.LSPFrameReader).toBe("function");
    expect(typeof lsp.createGatedSpawn).toBe("function");
    expect(typeof lsp.defaultSpawnProcess).toBe("function");
    expect(typeof lsp.encodeMessage).toBe("function");
    expect(typeof lsp.classifyMessage).toBe("function");
    expect(typeof lsp.findServerForFile).toBe("function");
    expect(typeof lsp.languageIdFor).toBe("function");
    expect(typeof lsp.domainForFile).toBe("function");
    expect(typeof lsp.serversInDomain).toBe("function");
    expect(typeof lsp.fileExtOrBasename).toBe("function");
    expect(typeof lsp.resolveWorkspaceForFile).toBe("function");
    expect(typeof lsp.findGitWorktree).toBe("function");
    expect(typeof lsp.isInsideWorkspace).toBe("function");
    expect(typeof lsp.nearestRoot).toBe("function");
    expect(typeof lsp.normalizePath).toBe("function");
    expect(typeof lsp.clearCache).toBe("function");
    expect(typeof lsp.findExecutable).toBe("function");
    expect(typeof lsp.detectStatus).toBe("function");
    expect(typeof lsp.lspStagingDir).toBe("function");
    expect(typeof lsp.shiftDiagnosticRange).toBe("function");
    expect(typeof lsp.shiftBaseline).toBe("function");
    expect(typeof lsp.fileUri).toBe("function");
    expect(typeof lsp.uriToPath).toBe("function");
    expect(typeof lsp.endPosition).toBe("function");
    expect(typeof lsp.diagnosticKey).toBe("function");
    expect(typeof lsp.buildChildEnv).toBe("function");

    expect(lsp.SERVERS.length).toBeGreaterThan(10);
    expect(Object.keys(lsp.LANGUAGE_BY_EXT).length).toBeGreaterThan(20);
    expect(Object.keys(lsp.INSTALL_RECIPES).length).toBeGreaterThan(5);
    expect(lsp.DEFAULT_IDLE_TIMEOUT_MS).toBeGreaterThan(lsp.MIN_IDLE_TIMEOUT_MS);
    expect(lsp.DIAGNOSTICS_DOCUMENT_WAIT_MS).toBeGreaterThan(0);
    expect(lsp.ERROR_METHOD_NOT_FOUND).toBe(-32601);
    expect(lsp.findServerForFile("/repo/app.ts")?.serverId).toBe("typescript");
    expect(lsp.findServerForFile("/repo/notes.txt")).toBeNull();
    expect(lsp.languageIdFor("/repo/app.ts")).toBe("typescript");
  });

  it("los tipos de error conservan su nombre en runtime", () => {
    expect(new lsp.LSPTimeoutError("initialize", 45_000).name).toBe("LSPTimeoutError");
    expect(new lsp.LSPProtocolError("framing").name).toBe("LSPProtocolError");
    expect(new lsp.LSPRequestError(-1, "x").name).toBe("LSPRequestError");
    expect(new lsp.LSPDisabledError("spawn").name).toBe("LSPDisabledError");
  });

  it("el subsistema está apagado por defecto", () => {
    expect(lsp.createLSPService().isActive()).toBe(false);
    expect(lsp.createLSPService().getStatus()).toMatchObject({
      enabled: false,
      active: false,
      clients: [],
      broken: [],
      reaperRunning: false,
    });
    expect(new lsp.LSPService().isActive()).toBe(false);
    expect(lsp.createLSPService({ enabled: true }).isActive()).toBe(true);
  });
});
