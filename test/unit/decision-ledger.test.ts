import { describe, expect, it } from "vitest";
import { MemoryLedger, recordDecision, verifyChain } from "@/lib/governance/decision-ledger";

describe("Decision ledger", () => {
  it("creates and verifies a hash chain", async () => {
    const store = new MemoryLedger();
    await recordDecision(store, {
      id: "1",
      tenantId: "t",
      actorId: "a",
      authority: "user",
      capability: "inference",
      policy: "default",
      risk: "LOW",
      inputHash: "i",
      outputHash: "o",
      result: "ALLOW",
      timestamp: new Date().toISOString(),
      evidenceIds: [],
    });
    await recordDecision(store, {
      id: "2",
      tenantId: "t",
      actorId: "a",
      authority: "user",
      capability: "inference",
      policy: "default",
      risk: "LOW",
      inputHash: "i2",
      outputHash: "o2",
      result: "ALLOW",
      timestamp: new Date().toISOString(),
      evidenceIds: [],
    });
    expect(verifyChain(store.list())).toBe(true);
  });
});
