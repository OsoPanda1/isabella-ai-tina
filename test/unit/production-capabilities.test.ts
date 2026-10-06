import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = resolve(root, "production-capabilities.json");
const originalManifest = readFileSync(manifestPath, "utf8");

afterEach(() => {
  writeFileSync(manifestPath, originalManifest);
});

function checkManifest() {
  return execFileSync("node", ["scripts/capability-matrix.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
}

describe("production capability manifest", () => {
  it("accepts the checked-in capability classifications", () => {
    expect(checkManifest()).toContain("manifiesto de producción válidos");
  });

  it("rejects a non-authoritative capability labelled verified", () => {
    const manifest = JSON.parse(originalManifest);
    manifest.capabilities[1].status = "verified";
    manifest.capabilities[1].last_verified = null;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = spawnSync("node", ["scripts/capability-matrix.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("last_verified debe ser una fecha ISO válida");
  });
});
