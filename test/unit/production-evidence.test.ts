import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("production evidence contract", () => {
  it("keeps the evidence generator and recovery procedures present", () => {
    expect(existsSync("scripts/production-evidence.mjs")).toBe(true);
    expect(existsSync("scripts/db-backup.mjs")).toBe(true);
    expect(existsSync("scripts/db-restore.mjs")).toBe(true);
  });

  it("does not certify external deployment evidence locally", () => {
    const source = readFileSync("scripts/production-evidence.mjs", "utf8");
    expect(source).toContain('"UNVERIFIED"');
    expect(source).not.toContain('deploymentId: "REAL_');
  });
});
