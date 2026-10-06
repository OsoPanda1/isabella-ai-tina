/**
 * Registro de servidores LSP (`src/lib/lsp/servers.ts`).
 *
 * Solo se prueba la tabla y la resolución con un resolutor de binarios
 * inyectado: aquí no se sondea PATH real ni se spawnea nada.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LANGUAGE_BY_EXT,
  SERVERS,
  domainForFile,
  fileExtOrBasename,
  findServerForFile,
  languageIdFor,
  serversInDomain,
  type ServerContext,
  type ServerDef,
} from "@/lib/lsp";

function serverOrThrow(filePath: string): ServerDef {
  const server = findServerForFile(filePath);
  if (server === null) throw new Error(`sin servidor para ${filePath}`);
  return server;
}

function context(overrides: Partial<ServerContext> = {}): ServerContext {
  return {
    workspaceRoot: path.sep,
    installStrategy: "manual",
    binaryOverrides: {},
    envOverrides: {},
    initOverrides: {},
    ...overrides,
  };
}

describe("servers — languageIdFor", () => {
  it("mapea extensiones conocidas al languageId de la spec LSP", () => {
    expect(languageIdFor("/repo/mod.py")).toBe("python");
    expect(languageIdFor("/repo/mod.pyi")).toBe("python");
    expect(languageIdFor("/repo/app.ts")).toBe("typescript");
    expect(languageIdFor("/repo/app.tsx")).toBe("typescriptreact");
    expect(languageIdFor("/repo/app.jsx")).toBe("javascriptreact");
    expect(languageIdFor("/repo/main.go")).toBe("go");
    expect(languageIdFor("/repo/lib.rs")).toBe("rust");
    expect(languageIdFor("/repo/conf.yaml")).toBe("yaml");
    expect(languageIdFor("/repo/deploy.tf")).toBe("terraform");
    expect(languageIdFor("/repo/build.sh")).toBe("shellscript");
    expect(languageIdFor("/repo/Server.java")).toBe("java");
  });

  it("usa plaintext para extensiones desconocidas", () => {
    expect(languageIdFor("/repo/notes.txt")).toBe("plaintext");
    expect(languageIdFor("/repo/sin-extension")).toBe("plaintext");
    expect(languageIdFor("/repo/README.md")).toBe("plaintext");
  });

  it("normaliza la extensión a minúsculas", () => {
    expect(languageIdFor("/repo/MOD.PY")).toBe("python");
    expect(fileExtOrBasename("/repo/MOD.PY")).toBe(".py");
    expect(fileExtOrBasename("/repo/Dockerfile")).toBe("Dockerfile");
  });
});

describe("servers — findServerForFile", () => {
  it("devuelve el servidor que maneja cada extensión", () => {
    expect(findServerForFile("/repo/mod.py")?.serverId).toBe("pyright");
    expect(findServerForFile("/repo/app.ts")?.serverId).toBe("typescript");
    expect(findServerForFile("/repo/App.vue")?.serverId).toBe("vue-language-server");
    expect(findServerForFile("/repo/main.rs")?.serverId).toBe("rust-analyzer");
    expect(findServerForFile("/repo/main.go")?.serverId).toBe("gopls");
    expect(findServerForFile("/repo/main.tf")?.serverId).toBe("terraform-ls");
    expect(findServerForFile("/repo/compose.yaml")?.serverId).toBe("yaml-language-server");
    expect(findServerForFile("/repo/Dockerfile")?.serverId).toBe("dockerfile-ls");
    expect(findServerForFile("/repo/.dockerfile")?.serverId).toBe("dockerfile-ls");
  });

  it("devuelve null cuando ningún servidor hace match", () => {
    expect(findServerForFile("/repo/notes.txt")).toBeNull();
    expect(findServerForFile("/repo/README.md")).toBeNull();
    expect(findServerForFile("/repo/Makefile")).toBeNull();
    expect(findServerForFile("/repo/data.json")).toBeNull();
    expect(findServerForFile("/repo/app.vuex")).toBeNull();
    expect(findServerForFile("/repo/sin-extension")).toBeNull();
  });

  it("dominios y agrupación por dominio", () => {
    expect(domainForFile("/repo/mod.py")).toBe("python");
    expect(domainForFile("/repo/app.ts")).toBe("web");
    expect(domainForFile("/repo/notes.txt")).toBeNull();
    expect(serversInDomain("python")).toEqual(["pyright"]);
    expect(serversInDomain("web")).toContain("typescript");
    expect(serversInDomain("jvm").sort()).toEqual(["jdtls", "kotlin-language-server"]);
  });

  it("el registro está congelado y cada entrada es coherente con sus extensiones", () => {
    expect(Object.isFrozen(SERVERS)).toBe(true);
    expect(SERVERS.length).toBeGreaterThan(10);
    for (const server of SERVERS) {
      expect(server.serverId.length).toBeGreaterThan(0);
      expect(server.extensions.length).toBeGreaterThan(0);
      for (const extension of server.extensions) {
        const probe = extension.startsWith(".") ? `probe${extension}` : extension;
        expect(server.matches(probe)).toBe(true);
      }
      expect(findServerForFile(`probe${server.extensions[0]}`)).not.toBeNull();
    }
    expect(Object.isFrozen(LANGUAGE_BY_EXT)).toBe(true);
  });
});

describe("servers — buildSpawn", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "isabella-lsp-servers-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("sin binario no hay spec (fail-closed)", () => {
    const server = serverOrThrow("/repo/app.ts");
    expect(server.buildSpawn(tmp, context({ findExecutable: () => null }))).toBeNull();
  });

  it("arma la spec con el binario del resolutor inyectado", () => {
    const server = serverOrThrow("/repo/app.ts");
    const spec = server.buildSpawn(tmp, context({ findExecutable: () => path.join(tmp, "tls") }));
    if (spec === null) throw new Error("spec esperada");
    expect(spec.command).toEqual([path.join(tmp, "tls"), "--stdio"]);
    expect(spec.cwd).toBe(tmp);
    expect(spec.workspaceRoot).toBe(tmp);
    expect(spec.env).toEqual({});
    expect(spec.seedDiagnosticsOnFirstPush).toBe(true);
    expect(spec.initializationOptions).toEqual({});
  });

  it("aplica envOverrides e initOverrides por clave de servidor", () => {
    const server = serverOrThrow("/repo/mod.py");
    const spec = server.buildSpawn(
      path.join(tmp, "raiz"),
      context({
        findExecutable: () => path.join(tmp, "pyright-langserver"),
        envOverrides: { pyright: { LANG: "C" } },
        initOverrides: { pyright: { verbosity: 3 } },
      }),
    );
    if (spec === null) throw new Error("spec esperada");
    expect(spec.env).toEqual({ LANG: "C" });
    expect(spec.initializationOptions).toEqual({ verbosity: 3 });
    expect(spec.seedDiagnosticsOnFirstPush).toBe(false);
  });

  it("binaryOverrides gana sobre el resolutor solo si el archivo existe", () => {
    const server = serverOrThrow("/repo/app.ts");
    const existing = path.join(tmp, "typescript-language-server.cmd");
    writeFileSync(existing, "@echo off\n");

    const overridden = server.buildSpawn(
      tmp,
      context({
        binaryOverrides: { typescript: [existing] },
        findExecutable: () => {
          throw new Error("el override debió ganar");
        },
      }),
    );
    if (overridden === null) throw new Error("spec esperada");
    expect(overridden.command[0]).toBe(existing);

    const fallback = server.buildSpawn(
      tmp,
      context({
        binaryOverrides: { typescript: [path.join(tmp, "no-existe.cmd")] },
        findExecutable: () => path.join(tmp, "del-resolutor"),
      }),
    );
    if (fallback === null) throw new Error("spec esperada");
    expect(fallback.command[0]).toBe(path.join(tmp, "del-resolutor"));
  });
});
