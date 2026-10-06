/**
 * Localización de binarios LSP (`src/lib/lsp/install.ts`).
 *
 * Política del repositorio: probe-only y fail-closed. Ningún test descarga,
 * instala ni spawnea nada: el PATH se inyecta vacío o con binarios falsos
 * creados en el temp del sistema.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as installApi from "@/lib/lsp/install";
import { INSTALL_RECIPES, detectStatus, findExecutable, lspStagingDir } from "@/lib/lsp";

let tmp: string;
let emptyStaging: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "isabella-lsp-install-"));
  emptyStaging = path.join(tmp, "staging-vacio");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const closedOptions = (): { pathEntries: string[]; stagingDir: string } => ({
  pathEntries: [],
  stagingDir: emptyStaging,
});

describe("install — fail-closed", () => {
  it("el módulo no exporta ninguna vía de instalación o descarga", () => {
    const runtimeExports = Object.keys(installApi).sort();
    expect(runtimeExports).toEqual([
      "INSTALL_RECIPES",
      "detectStatus",
      "findExecutable",
      "lspStagingDir",
    ]);
    for (const forbidden of [
      "tryInstall",
      "install",
      "installServer",
      "autoInstall",
      "download",
      "fetch",
      "spawn",
      "exec",
    ]) {
      expect(runtimeExports).not.toContain(forbidden);
    }
  });

  it("detectStatus devuelve 'missing' sin binario y sin intentar descargar", () => {
    const options = closedOptions();
    expect(detectStatus("paquete-que-no-existe", options)).toBe("missing");
    expect(detectStatus("pyright", options)).toBe("missing");
    expect(detectStatus("typescript-language-server", options)).toBe("missing");
    expect(detectStatus("gopls", options)).toBe("missing");
    expect(existsSync(emptyStaging)).toBe(false);
  });

  it("las recetas 'manual' reportan 'manual-only' y nunca auto-instalan", () => {
    const options = closedOptions();
    expect(detectStatus("rust-analyzer", options)).toBe("manual-only");
    expect(detectStatus("clangd", options)).toBe("manual-only");
    expect(detectStatus("lua-language-server", options)).toBe("manual-only");
  });

  it("ninguna receta produce 'installed' con PATH y staging vacíos", () => {
    const options = closedOptions();
    expect(Object.isFrozen(INSTALL_RECIPES)).toBe(true);
    for (const [pkg, recipe] of Object.entries(INSTALL_RECIPES)) {
      expect(["npm", "go", "pip", "manual"]).toContain(recipe.strategy);
      const status = detectStatus(pkg, options);
      expect(["missing", "manual-only"]).toContain(status);
      if (recipe.strategy === "manual") expect(status).toBe("manual-only");
    }
    expect(existsSync(emptyStaging)).toBe(false);
  });

  it("findExecutable no spawnea ni escala privilegios: solo sondea rutas", () => {
    expect(findExecutable(["isabella-lsp-servidor-inexistente"], closedOptions())).toBeNull();
    expect(findExecutable(["otro-inexistente"], closedOptions())).toBeNull();
  });
});

describe("install — sondeo de binarios", () => {
  it("encuentra un binario presente en PATH inyectado", () => {
    const binDir = path.join(tmp, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, "lsp-falso"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(path.join(binDir, "lsp-falso.cmd"), "@echo off\r\n");

    const found = findExecutable(["lsp-falso"], {
      pathEntries: [binDir],
      stagingDir: emptyStaging,
    });
    expect(found).not.toBeNull();
    if (found !== null) {
      expect(path.dirname(found)).toBe(binDir);
      expect(path.basename(found).startsWith("lsp-falso")).toBe(true);
    }
    expect(detectStatus("lsp-falso", { pathEntries: [binDir], stagingDir: emptyStaging })).toBe(
      "installed",
    );
  });

  it("el staging propio se sondea pero nunca se crea", () => {
    const staging = lspStagingDir(tmp);
    expect(staging).toBe(path.join(tmp, "node_modules", ".cache", "isabella-lsp"));
    expect(existsSync(staging)).toBe(false);
    expect(existsSync(path.join(tmp, "node_modules"))).toBe(false);

    const binDir = path.join(tmp, "staging");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, "staged-ls"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(path.join(binDir, "staged-ls.cmd"), "@echo off\r\n");
    const found = findExecutable(["staged-ls"], { stagingDir: binDir, pathEntries: [] });
    expect(found).not.toBeNull();
    if (found !== null) expect(path.dirname(found)).toBe(binDir);
  });
});
