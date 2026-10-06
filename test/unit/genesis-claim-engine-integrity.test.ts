import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaimEngine } from "../../src/lib/genesis/engines/claim-engine";

describe("ClaimEngine dependency-lock integrity", () => {
  it("derives a SHA3-512 hash from the committed pnpm lockfile", () => {
    const lockfile = readFileSync(join(process.cwd(), "pnpm-lock.yaml"), "utf8");
    const expected = createHash("sha3-512").update(lockfile).digest("hex");
    const engine = createClaimEngine();

    const actual = (
      engine as unknown as { getDependencyLockHash(): string }
    ).getDependencyLockHash();

    expect(actual).toBe(expected);
    expect(actual).toHaveLength(128);
    expect(actual).not.toMatch(/^0{128}$/);
  });
});
