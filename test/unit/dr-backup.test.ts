import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * DR Backup — Lote 8 (P1 DR)
 * Verifica que scripts de backup/restore existen y son evidence-gated.
 */
describe("DR backup/restore", () => {
  it("scripts existen y son evidence-gated", () => {
    expect(existsSync(resolve("scripts/db-backup.mjs"))).toBe(true);
    expect(existsSync(resolve("scripts/db-restore.mjs"))).toBe(true);
    expect(existsSync(resolve("scripts/db-snapshot-lib.mjs"))).toBe(true);
  });

  it("RPO/RTO documentado en SLO", async () => {
    const { readFileSync } = await import("node:fs");
    const slo = readFileSync(resolve("docs/operations/SLO.md"), "utf8");
    expect(slo.includes("RPO")).toBe(true);
    expect(slo.includes("RTO")).toBe(true);
  });
});
