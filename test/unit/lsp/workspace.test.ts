/**
 * Resolución de workspace (`src/lib/lsp/workspace.ts`).
 *
 * Los tests crean worktrees temporales con un `.git` ficticio en el temp del
 * sistema: sin procesos reales, sin red y sin tocar el repo.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearCache,
  findGitWorktree,
  isInsideWorkspace,
  nearestRoot,
  normalizePath,
  resolveWorkspaceForFile,
} from "@/lib/lsp";

let tmp: string;
let project: string;
let file: string;

beforeEach(() => {
  clearCache();
  tmp = mkdtempSync(path.join(os.tmpdir(), "isabella-lsp-ws-"));
  project = path.join(tmp, "proyecto");
  mkdirSync(path.join(project, ".git"), { recursive: true });
  mkdirSync(path.join(project, "src"), { recursive: true });
  file = path.join(project, "src", "app.ts");
  writeFileSync(file, "export const a = 1;\n");
});

afterEach(() => {
  clearCache();
  rmSync(tmp, { recursive: true, force: true });
});

describe("workspace — resolveWorkspaceForFile", () => {
  it("resuelve la raíz del worktree y la cachea", () => {
    const first = resolveWorkspaceForFile(file, { cwd: project });
    expect(first).toEqual({ root: project, gated: true });

    rmSync(path.join(project, ".git"), { recursive: true, force: true });

    const cached = resolveWorkspaceForFile(file, { cwd: project });
    expect(cached).toEqual({ root: project, gated: true });

    clearCache();

    const fresh = resolveWorkspaceForFile(file, { cwd: project });
    expect(fresh.root).not.toBe(project);
    expect(fresh.gated).toBe(false);
  });

  it("marca gated=false para archivos fuera de todo worktree", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "isabella-lsp-outside-"));
    try {
      const outsideFile = path.join(outside, "suelto.ts");
      writeFileSync(outsideFile, "export const x = 1;\n");
      const resolution = resolveWorkspaceForFile(outsideFile, { cwd: project });
      expect(resolution.root).toBeNull();
      expect(resolution.gated).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("workspace — findGitWorktree y clearCache", () => {
  it("encuentra el worktree y clearCache obliga a recalcular", () => {
    expect(findGitWorktree(project)).toBe(project);
    expect(findGitWorktree(file)).toBe(project);

    rmSync(path.join(project, ".git"), { recursive: true, force: true });

    expect(findGitWorktree(project)).toBe(project);
    clearCache();
    expect(findGitWorktree(project)).toBeNull();
  });
});

describe("workspace — helpers", () => {
  it("isInsideWorkspace es conservador con rutas relativas", () => {
    expect(isInsideWorkspace(file, project)).toBe(true);
    expect(isInsideWorkspace(project, project)).toBe(true);
    expect(isInsideWorkspace(path.join(project, "src", "..", "..", "afuera.ts"), project)).toBe(
      false,
    );
    expect(isInsideWorkspace(path.join(tmp, "otro", "x.ts"), project)).toBe(false);
  });

  it("normalizePath resuelve rutas y colapsa . y ..", () => {
    expect(normalizePath(path.join(project, "src", "..", "mod.py"))).toBe(
      path.join(project, "mod.py"),
    );
    expect(normalizePath("~")).toBe(os.homedir());
    expect(path.isAbsolute(normalizePath("relativa"))).toBe(true);
  });

  it("nearestRoot sube hasta el marcador y respeta excludes y ceiling", () => {
    const pkg = path.join(project, "paquete");
    mkdirSync(path.join(pkg, "src"), { recursive: true });
    writeFileSync(path.join(pkg, "pyproject.toml"), "[project]\n");
    const nested = path.join(pkg, "src", "main.py");
    writeFileSync(nested, "print(1)\n");

    expect(nearestRoot(nested, ["pyproject.toml"])).toBe(pkg);
    expect(nearestRoot(nested, ["go.mod"])).toBeNull();

    writeFileSync(path.join(pkg, "deno.json"), "{}\n");
    writeFileSync(path.join(pkg, "package.json"), "{}\n");
    expect(nearestRoot(nested, ["package.json"], { excludes: ["deno.json"] })).toBeNull();
    expect(nearestRoot(nested, ["package.json"])).toBe(pkg);

    writeFileSync(path.join(project, "go.mod"), "module example\n");
    expect(nearestRoot(nested, ["go.mod"])).toBe(project);
    expect(nearestRoot(nested, ["go.mod"], { ceiling: pkg })).toBeNull();
  });
});
