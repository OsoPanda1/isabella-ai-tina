import { describe, expect, it } from "vitest";
import { ArgusAionBehavioralSentinel } from "../../src/lib/argus-aion-behavior";
import {
  ArgusRecoveryMesh,
  createNodeAttestation,
  deriveRecoveryEpoch,
} from "../../src/lib/argus-recovery-mesh";

const digest = "a".repeat(64);
const observation = (sequence: number, latencyMs = 10) => ({
  latencyMs,
  riskScore: 0.1,
  vetoed: false,
  policyVersion: "v1",
  sequence,
  decisionDigest: digest,
  timestamp: sequence,
});

describe("ARGUS AION behavioral sentinel", () => {
  it("learns a bounded baseline and detects a severe deviation", () => {
    const sentinel = new ArgusAionBehavioralSentinel();
    expect(sentinel.observe(observation(0)).state).toBe("LEARNING");
    sentinel.observe(observation(1));
    sentinel.observe(observation(2));
    sentinel.observe(observation(3));
    const result = sentinel.observe({
      ...observation(4, 1000),
      riskScore: 1,
      vetoed: true,
      policyVersion: "v2",
    });
    expect(["SUSPICIOUS", "CRITICAL"]).toContain(result.state);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("rejects sequence regression as critical", () => {
    const sentinel = new ArgusAionBehavioralSentinel();
    sentinel.observe(observation(2));
    expect(sentinel.observe(observation(1)).reasons).toContain("sequence_or_time_regression");
  });
});

describe("ARGUS recovery mesh", () => {
  const plan = {
    planId: "plan-1",
    planDigest: digest,
    targetCheckpoint: { sequence: 4, digest },
    expiresAt: 100,
    quorum: 2,
    authorizedNodes: ["a", "b", "c"],
  };
  const secrets = new Map([
    ["a", "b".repeat(32)],
    ["b", "c".repeat(32)],
    ["c", "d".repeat(32)],
  ]);

  it("requires quorum and consumes approved plans", () => {
    const mesh = new ArgusRecoveryMesh(secrets);
    const attestations = [
      createNodeAttestation(plan, "a", secrets.get("a")!, 1),
      createNodeAttestation(plan, "b", secrets.get("b")!, 1),
    ];
    expect(mesh.verify(plan, attestations, 2).approved).toBe(true);
    expect(mesh.verify(plan, attestations, 2).reason).toBe("REPLAY");
  });

  it("binds attestations to the exact recovery epoch", () => {
    expect(deriveRecoveryEpoch(plan)).not.toBe(
      deriveRecoveryEpoch({ ...plan, targetCheckpoint: { sequence: 5, digest } }),
    );
  });
});
