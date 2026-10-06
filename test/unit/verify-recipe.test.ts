import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  MANIFEST_RELATIVE_PATH,
  SCHEMA,
  buildEnvironmentManifest,
  checkManifest,
  detectFramework,
  detectPackageManager,
  loadManifest,
  manifestPath,
  resolveScripts,
  serializeManifest,
} from "../../scripts/verify-recipe.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const committedManifest = readFileSync(manifestPath(root), "utf8");
const fixtureRoots: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "isabella-verify-recipe-"));
  fixtureRoots.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function packageJson(fields: Record<string, unknown>): string {
  return `${JSON.stringify(fields, null, 2)}\n`;
}

function runCheck() {
  return spawnSync("node", ["scripts/verify-recipe.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
}

afterEach(() => {
  writeFileSync(manifestPath(root), committedManifest);
});

afterAll(() => {
  for (const dir of fixtureRoots) rmSync(dir, { recursive: true, force: true });
});

describe("verify-recipe: detección estática", () => {
  it("identifica el gestor de paquetes por el lockfile versionado", () => {
    const detected = detectPackageManager(root);
    expect(detected.name).toBe("pnpm");
    expect(detected.lockfile).toBe("pnpm-lock.yaml");
    expect(detected.lockfiles).toEqual(["pnpm-lock.yaml"]);
    expect(detected.version).toBe("10.34.5");
  });

  it("respeta el orden de prioridad entre lockfiles y reporta ausencia", () => {
    const mixed = detectPackageManager(fixture({ "package-lock.json": "{}", "yarn.lock": "" }));
    expect(mixed.name).toBe("npm");
    expect(mixed.lockfile).toBe("package-lock.json");
    expect(mixed.lockfiles).toEqual(["package-lock.json", "yarn.lock"]);
    expect(mixed.version).toBeNull();

    expect(detectPackageManager(fixture({ "bun.lockb": "" })).name).toBe("bun");

    const bare = detectPackageManager(fixture({ "package.json": packageJson({ name: "bare" }) }));
    expect(bare.name).toBeNull();
    expect(bare.lockfile).toBeNull();
    expect(bare.lockfiles).toEqual([]);
  });

  it("declara el framework y el runtime del repositorio", () => {
    const manifest = buildEnvironmentManifest(root);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

    expect(manifest.framework.kind).toBe("tanstack-start");
    expect(manifest.framework.label).toBe("TanStack Start");
    expect(manifest.framework.markers).toEqual([
      "react",
      "react-dom",
      "tanstack-react-query",
      "tanstack-react-router",
      "tanstack-react-start",
      "vite",
    ]);
    expect(detectFramework({ dependencies: { next: "15.0.0" } }).kind).toBe("nextjs");
    expect(detectFramework({ dependencies: { vite: "8.0.0" } }).kind).toBe("vite");
    expect(detectFramework(null)).toEqual({ kind: "node", label: "Node.js", markers: [] });

    expect(manifest.runtime.node).toBe(pkg.engines.node);
    expect(manifest.runtime.nvmrc).toBe(readFileSync(join(root, ".nvmrc"), "utf8").trim());
    expect(manifest.project).toEqual({ name: pkg.name, version: pkg.version });
  });
});

describe("verify-recipe: run-recipe de scripts", () => {
  it("resuelve los scripts reales declarados en package.json", () => {
    const manifest = buildEnvironmentManifest(root);
    const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));

    expect(Object.keys(manifest.scripts)).toEqual([
      "install",
      "typecheck",
      "lint",
      "test",
      "build",
      "verify",
    ]);
    expect(manifest.scripts).toEqual({
      install: { script: null, command: vercel.installCommand },
      typecheck: { script: "typecheck", command: "pnpm typecheck" },
      lint: { script: "lint", command: "pnpm lint" },
      test: { script: "test", command: "pnpm test" },
      build: { script: "build", command: "pnpm build" },
      verify: { script: "verify:lock", command: "pnpm verify:lock" },
    });
  });

  it("no asume nombres de script inexistentes", () => {
    const dir = fixture({ "package.json": packageJson({ name: "fixture-app", version: "1.0.0" }) });
    const pkg = { scripts: { "test:unit": "vitest run --project unit" } };

    expect(resolveScripts(dir, pkg, "pnpm")).toEqual({
      install: { script: null, command: "pnpm install" },
      typecheck: { script: null, command: null },
      lint: { script: null, command: null },
      test: { script: null, command: null },
      build: { script: null, command: null },
      verify: { script: null, command: null },
    });
    expect(resolveScripts(dir, null, null).install).toEqual({
      script: null,
      command: "npm install",
    });
  });

  it("prefiere el primer script verify:* ordenado alfabéticamente", () => {
    const dir = fixture({ "package.json": packageJson({ name: "fixture-app" }) });
    const resolved = resolveScripts(
      dir,
      { scripts: { lint: "eslint .", "verify:all": "pnpm verify:lock", "verify:lock": "x" } },
      "pnpm",
    );
    expect(resolved.verify).toEqual({ script: "verify:all", command: "pnpm verify:all" });
    expect(resolved.lint).toEqual({ script: "lint", command: "pnpm lint" });
  });
});

describe("verify-recipe: manifiesto de entorno", () => {
  it("es determinista y solo contiene hechos no secretos", () => {
    const first = serializeManifest(buildEnvironmentManifest(root));
    const second = serializeManifest(buildEnvironmentManifest(root));

    expect(first).toBe(second);
    expect(Object.keys(JSON.parse(first))).toEqual([
      "schema",
      "schemaVersion",
      "project",
      "packageManager",
      "runtime",
      "framework",
      "scripts",
      "integrity",
    ]);
    expect(JSON.parse(first).schemaVersion).toBe(1);
    expect(first).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(first).not.toMatch(/\/Users\//);
    expect(first).not.toMatch(/\b(secret|password|token|credential|api[_-]?key)\b\s*[:=]/i);

    const source = readFileSync(join(root, "scripts", "verify-recipe.mjs"), "utf8");
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("homedir");
  });

  it("versiona el manifiesto en la ruta genesis y coincide con el repo", () => {
    expect(MANIFEST_RELATIVE_PATH).toBe("genesis/reports/environment-manifest-latest.json");
    expect(manifestPath(root)).toBe(join(root, MANIFEST_RELATIVE_PATH));
    expect(committedManifest).toBe(serializeManifest(buildEnvironmentManifest(root)));
    expect(loadManifest(root)?.schema).toBe(SCHEMA);
    expect(checkManifest(root)).toEqual({ ok: true, differences: [] });
  });

  it("detecta deriva cuando cambia package.json", () => {
    const dir = fixture({ "package.json": packageJson({ name: "fixture-app", version: "1.0.0" }) });
    mkdirSync(dirname(manifestPath(dir)), { recursive: true });
    writeFileSync(manifestPath(dir), serializeManifest(buildEnvironmentManifest(dir)));
    expect(checkManifest(dir).ok).toBe(true);

    writeFileSync(
      join(dir, "package.json"),
      packageJson({ name: "fixture-app", version: "2.0.0" }),
    );

    const drifted = checkManifest(dir);
    expect(drifted.ok).toBe(false);
    expect(drifted.differences.join("\n")).toContain("project");
    expect(drifted.differences.join("\n")).toContain("integrity");
  });

  it("degrada a informe de error con manifiesto ausente o corrupto", () => {
    const bare = fixture({ "package.json": packageJson({ name: "fixture-app" }) });
    expect(checkManifest(bare).differences[0]).toContain("manifiesto ausente");

    const corrupt = fixture({
      "package.json": packageJson({ name: "fixture-app" }),
      [MANIFEST_RELATIVE_PATH]: "{ no es json",
    });
    expect(loadManifest(corrupt)).toBeNull();
    expect(checkManifest(corrupt)).toEqual({
      ok: false,
      differences: ["el manifiesto versionado no es JSON válido"],
    });
  });
});

describe("verify-recipe: gate audit:recipes", () => {
  it("sale con 0 cuando el manifiesto versionado refleja el repositorio", () => {
    const result = runCheck();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RECIPE-MANIFEST: PASS");
  });

  it("sale con 1 cuando el manifiesto versionado ya no coincide", () => {
    const manifest = JSON.parse(committedManifest);
    manifest.integrity.contentHash = "0".repeat(64);
    writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = runCheck();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("RECIPE-MANIFEST: FAILED");
    expect(result.stderr).toContain("integrity");
  });
});
