import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * CROWN-SSR-01 regression — production SSR must not crash with
 * `(0, k.jsx) is not a function` / `S.jsxDEV is not a function`.
 *
 * Root cause (2026-09-24): a generateBundle hack blindly renamed
 * `.jsxDEV` → `.jsx` while the bound runtime namespace still exported
 * `jsx: void 0`, so RootShell threw during renderToReadableStream and
 * every GET / returned HTTP 500 (CROWN-SSR-01) while /api/health/live
 * stayed 200.
 *
 * Contract enforced here:
 *  1. vite.config must not reintroduce the blind rename.
 *  2. vite.config must pin production JSX (automatic runtime, no jsxDEV).
 *  3. production preflight must accept engines.node 24.x.
 *  4. if a server build exists, its SSR router must not contain the
 *     broken `jsx: void 0` binding or leftover `.jsxDEV` calls.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readViteConfig() {
  return readFileSync(resolve(root, "vite.config.ts"), "utf8");
}

describe("CROWN-SSR-01 — production JSX contract", () => {
  it("vite.config does not contain a blind jsxDEV→jsx generateBundle rename", () => {
    const config = readViteConfig();
    expect(config).not.toContain("fix-jsxDEV-production");
    expect(config).not.toContain('replace(/\\.jsxDEV/g');
    expect(config).not.toContain("generateBundle");
  });

  it("vite.config pins automatic JSX with development:false for builds", () => {
    const config = readViteConfig();
    expect(config).toContain('runtime: "automatic"');
    expect(config).toContain("development: false");
    expect(config).toContain("jsxDev: false");
    expect(config).toMatch(/oxc:\s*\{/);
  });

  it("production preflight accepts engines.node 24.x", () => {
    const result = spawnSync("node", ["scripts/production-preflight.mjs", "--json"], {
      cwd: root,
      encoding: "utf8",
    });
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(out).not.toContain("engines.node must be");
    if (result.status !== 0 && !out.includes('"status":"failed"')) {
      throw new Error(`preflight unexpected failure: ${out}`);
    }
    if (result.status === 0) {
      expect(out).toContain('"status":"static_ready"');
    } else {
      const parsed = JSON.parse(result.stdout);
      const engineErrors = (parsed.errors ?? []).filter((e: string) => e.includes("engines.node"));
      expect(engineErrors).toEqual([]);
    }
  });

});
