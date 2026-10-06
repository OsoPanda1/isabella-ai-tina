import { describe, expect, it } from "vitest";
import { ArgusAion } from "@/lib/argus-aion";

const digest = "a".repeat(64);

describe("ARGUS AION", () => {
  it("remains dormant until ARGUS signals are observed", () => {
    const aion = new ArgusAion();
    expect(aion.getMode()).toBe("DORMANT");
    aion.observeHeartbeat({
      argusEpoch: "epoch-1",
      sequence: 1,
      stateDigest: digest,
      policyVersion: "p1",
      nodeIds: ["n1", "n2", "n3"],
      healthScore: 1,
    });
    expect(aion.getMode()).toBe("SHADOW");
  });

  it("activates when ARGUS is lost", () => {
    const aion = new ArgusAion({ lossThresholdMs: 100 });
    aion.observeHeartbeat({
      argusEpoch: "epoch-1",
      sequence: 1,
      stateDigest: digest,
      policyVersion: "p1",
      nodeIds: ["n1", "n2", "n3"],
      healthScore: 1,
    });
    const signal = aion.inspect("ARGUS_LOST", 10_000);
    expect(signal?.event).toBe("ARGUS_LOST");
    expect(aion.getMode()).toBe("AION_ACTIVE");
  });

  it("selects the checkpoint two positions behind the newest state", () => {
    const aion = new ArgusAion({ minimumRecoveryNodes: 3 });
    for (let sequence = 1; sequence <= 4; sequence++) {
      aion.observeHeartbeat({
        argusEpoch: "epoch-1",
        sequence,
        stateDigest: `${sequence}`.padStart(64, "0"),
        policyVersion: `p${sequence}`,
        nodeIds: ["n1", "n2", "n3"],
        healthScore: 1,
      });
    }
    aion.inspect("ARGUS_LOST", Date.now() + 10_000);
    const plan = aion.activateRecovery();
    expect(plan.targetCheckpoint.sequence).toBe(2);
    expect(plan.requiredNodeIds).toHaveLength(3);
    expect(plan.planDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("refuses recovery without enough history", () => {
    const aion = new ArgusAion();
    aion.observeHeartbeat({
      argusEpoch: "epoch-1",
      sequence: 1,
      stateDigest: digest,
      policyVersion: "p1",
      nodeIds: ["n1", "n2", "n3"],
      healthScore: 1,
    });
    aion.inspect("ARGUS_LOST", Date.now() + 10_000);
    expect(() => aion.activateRecovery()).toThrow("aion_insufficient_recovery_history");
  });
});
