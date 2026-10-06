import { describe, expect, it } from "vitest";
import { ArgusRecoveryMesh, deriveRecoveryEpoch } from "@/lib/argus-recovery-mesh";
import type { AionRecoveryPlan } from "@/lib/argus-aion";

const plan: AionRecoveryPlan = {
  planId: "plan-1",
  activatedAt: "2026-09-13T00:00:00.000Z",
  mode: "RECOVERY",
  targetCheckpoint: {
    sequence: 10,
    capturedAt: "2026-09-13T00:00:00.000Z",
    stateDigest: "a".repeat(64),
    policyVersion: "v1",
    nodeIds: ["node-a", "node-b", "node-c"],
    healthScore: 0.9,
  },
  requiredNodeIds: ["node-a", "node-b", "node-c"],
  reason: "ARGUS_LOSS",
  planDigest: "b".repeat(64),
};

const epoch = deriveRecoveryEpoch(plan);
const secrets = new Map([
  ["node-a", "a".repeat(32)],
  ["node-b", "b".repeat(32)],
  ["node-c", "c".repeat(32)],
]);

function attest(nodeId: string, now: number) {
  return ArgusRecoveryMesh.signAttestation(secrets.get(nodeId)!, {
    nodeId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    epoch,
    attestedAt: new Date(now).toISOString(),
  });
}

describe("ARGUS recovery mesh", () => {
  it("requires a quorum and consumes the accepted plan", () => {
    const mesh = new ArgusRecoveryMesh({ quorum: 2 });
    const now = Date.now();
    const first = mesh.verifyAndAuthorize(
      plan,
      [attest("node-a", now), attest("node-b", now)],
      secrets,
      epoch,
      now,
    );
    expect(first).toMatchObject({ accepted: true, reason: "QUORUM_REACHED" });
    const replay = mesh.verifyAndAuthorize(
      plan,
      [attest("node-a", now), attest("node-b", now)],
      secrets,
      epoch,
      now,
    );
    expect(replay).toMatchObject({ accepted: false, reason: "REPLAYED_PLAN" });
  });

  it("rejects tampered attestations", () => {
    const mesh = new ArgusRecoveryMesh({ quorum: 2 });
    const now = Date.now();
    const bad = { ...attest("node-a", now), signature: "0".repeat(64) };
    const result = mesh.verifyAndAuthorize(plan, [bad, attest("node-b", now)], secrets, epoch, now);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("INVALID_ATTESTATION");
  });

  it("rejects the wrong epoch", () => {
    const mesh = new ArgusRecoveryMesh({ quorum: 2 });
    const now = Date.now();
    const result = mesh.verifyAndAuthorize(
      plan,
      [attest("node-a", now), attest("node-b", now)],
      secrets,
      "wrong",
      now,
    );
    expect(result).toMatchObject({ accepted: false, reason: "EPOCH_MISMATCH" });
  });
});
