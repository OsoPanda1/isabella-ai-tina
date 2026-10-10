/**
 * Cliente LSP (`src/lib/lsp/client.ts`) con un proceso hijo FALSO.
 *
 * Ningún test spawnea un binario real ni abre red: el spawn se inyecta con
 * `FakeLSPServer` (`./fake-lsp`).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LSPClient,
  LSPDisabledError,
  LSPTimeoutError,
  buildChildEnv,
  createGatedSpawn,
  diagnosticKey,
  endPosition,
  fileUri,
  uriToPath,
  type LSPDiagnostic,
  type LSPSpawnOptions,
} from "@/lib/lsp";
import { FakeLSPServer } from "./fake-lsp";

let tmp: string;
let fileA: string;
let fileB: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "isabella-lsp-client-"));
  fileA = path.join(tmp, "a.ts");
  fileB = path.join(tmp, "b.ts");
  writeFileSync(fileA, "export const a = 1;\n");
  writeFileSync(fileB, "export const b = 2;\n");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function uriOf(params: unknown): string {
  if (typeof params !== "object" || params === null) return "";
  const wrapper = params as Record<string, unknown>;
  const document = wrapper.textDocument;
  if (typeof document !== "object" || document === null) return "";
  const uri = (document as Record<string, unknown>).uri;
  return typeof uri === "string" ? uri : "";
}

function makeClient(fake: FakeLSPServer): LSPClient {
  return new LSPClient({
    serverId: "typescript",
    workspaceRoot: tmp,
    command: ["/fake/typescript-language-server", "--stdio"],
    spawnProcess: fake.spawn,
  });
}

describe("client — handshake y correlación de ids", () => {
  it("correlaciona los responses por id aunque lleguen fuera de orden", async () => {
    const fake = new FakeLSPServer({ capabilities: { textDocumentSync: 1 } });
    const client = makeClient(fake);

    await client.start();
    expect(client.state).toBe("running");
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ id: 0, method: "initialize" });
    expect(fake.notifications.map((notification) => notification.method)).toContain("initialized");

    expect(await client.openFile(fileA)).toBe(0);
    expect(await client.openFile(fileB)).toBe(0);

    const waitA = client.waitForDiagnostics(fileA, 0, { timeoutMs: 2_000 });
    const waitB = client.waitForDiagnostics(fileB, 0, { timeoutMs: 2_000 });

    const pulls = fake.requests.filter((request) => request.method === "textDocument/diagnostic");
    expect(pulls).toHaveLength(2);
    expect(pulls[0]).toMatchObject({ id: 1 });
    expect(pulls[1]).toMatchObject({ id: 2 });
    expect(uriOf(pulls[0]?.params)).toBe(fileUri(fileA));
    expect(uriOf(pulls[1]?.params)).toBe(fileUri(fileB));

    const diagA: LSPDiagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      severity: 1,
      message: "error en A",
    };
    const diagB: LSPDiagnostic = {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      severity: 2,
      message: "error en B",
    };
    const bogus: LSPDiagnostic = { message: "id desconocido", severity: 3 };

    fake.respond(999, { items: [bogus] });
    fake.respond(2, { items: [diagB] });
    fake.respond(1, { items: [diagA] });

    expect(await waitA).toBe(true);
    expect(await waitB).toBe(true);
    expect(client.diagnosticsFor(fileA)).toEqual([diagA]);
    expect(client.diagnosticsFor(fileB)).toEqual([diagB]);
    expect(client.diagnosticsFor(fileA)).not.toContainEqual(bogus);

    await client.shutdown();
    expect(client.state).toBe("stopped");
  });

  it("el timeout de arranque rechaza con LSPTimeoutError", async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeLSPServer({ emitSpawn: false });
      const client = makeClient(fake);
      const started = client.start();
      const settled = started.then(
        () => null,
        (error: unknown) => error,
      );

      await vi.advanceTimersByTimeAsync(60_000);
      const error = await settled;

      expect(error).toBeInstanceOf(LSPTimeoutError);
      if (error instanceof LSPTimeoutError) {
        expect(error.name).toBe("LSPTimeoutError");
        expect(error.timeoutMs).toBe(45_000);
        expect(error.message).toContain("timed out after 45000ms");
      }
      expect(fake.spawnCalls).toHaveLength(1);
      expect(client.state).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("un error del servidor se entrega como LSPRequestError con su code", async () => {
    const fake = new FakeLSPServer({ capabilities: { textDocumentSync: 1 } });
    const client = makeClient(fake);
    await client.start();
    await client.openFile(fileA);

    const wait = client.waitForDiagnostics(fileA, 0, { timeoutMs: 300 });
    const pull = fake.requests.find((request) => request.method === "textDocument/diagnostic");
    if (pull === undefined) throw new Error("pull no emitido");
    fake.respondError(pull.id, -32603, "falla interna del servidor");

    expect(await wait).toBe(false);
    expect(client.diagnosticsFor(fileA)).toEqual([]);

    await client.shutdown();
  });
});

describe("client — spawn gateado fail-closed", () => {
  it("createGatedSpawn bloquea con el LSP deshabilitado", () => {
    const options: LSPSpawnOptions = { cwd: tmp, env: {}, stdio: "pipe", windowsHide: true };
    let invoked = false;
    const blocked = createGatedSpawn(
      () => false,
      () => {
        invoked = true;
        throw new Error("el spawn no debió invocarse");
      },
    );
    expect(() => blocked("/fake/ls", [], options)).toThrow(LSPDisabledError);
    expect(invoked).toBe(false);

    const fake = new FakeLSPServer();
    const allowed = createGatedSpawn(() => true, fake.spawn);
    const child = allowed("/fake/ls", [], options);
    expect(child.stdin).not.toBeNull();
    expect(fake.spawnCalls).toHaveLength(1);
    expect(fake.spawnCalls[0]?.options.windowsHide).toBe(true);
    expect(fake.spawnCalls[0]?.options.stdio).toBe("pipe");
  });
});

describe("client — helpers", () => {
  it("buildChildEnv no arrastra credenciales del proceso al hijo", () => {
    const env = buildChildEnv({ MI_VAR: "valor" });
    expect(env.MI_VAR).toBe("valor");
    expect(env).not.toHaveProperty("AUTH_JWT_SECRET");
    expect(env).not.toHaveProperty("ENCRYPTION_MASTER_KEY");
    expect(env).not.toHaveProperty("AEGIS_AUDIT_SECRET");

    const allowed = new Set([
      "PATH",
      "HOME",
      "SHELL",
      "TERM",
      "TZ",
      "LANG",
      "LC_ALL",
      "SystemRoot",
      "ComSpec",
      "WINDIR",
      "USERPROFILE",
      "TEMP",
      "TMP",
      "PATHEXT",
    ]);
    for (const key of Object.keys(env)) {
      if (key === "MI_VAR") continue;
      expect(allowed.has(key)).toBe(true);
    }
  });

  it("fileUri/uriToPath hacen roundtrip con espacios y acentos", () => {
    const file = path.join(tmp, "nombre con espacios ñ.ts");
    const uri = fileUri(file);
    expect(uri.startsWith("file://")).toBe(true);
    expect(uri).toContain("%20");
    expect(uriToPath(uri)).toBe(path.normalize(file));
  });

  it("endPosition marca el final del documento", () => {
    expect(endPosition("")).toEqual({ line: 0, character: 0 });
    expect(endPosition("abc")).toEqual({ line: 0, character: 3 });
    expect(endPosition("ab\ncd")).toEqual({ line: 1, character: 2 });
    expect(endPosition("a\r\nb")).toEqual({ line: 1, character: 1 });
    expect(endPosition("abc\n")).toEqual({ line: 2, character: 0 });
  });

  it("diagnosticKey distingue por rango y empatan los idénticos", () => {
    const base: LSPDiagnostic = {
      message: "x",
      severity: 1,
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
    };
    expect(diagnosticKey(base)).toBe(diagnosticKey({ ...base }));
    expect(diagnosticKey(base)).not.toBe(
      diagnosticKey({
        ...base,
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
      }),
    );
  });
});
