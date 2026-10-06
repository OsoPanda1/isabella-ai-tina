import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aggregateFederatedUpdates } from "@/lib/native-ml";
import type { FederatedUpdate, ModelArtifact, ModelIdentity } from "@/lib/native-ml";

const model: ModelIdentity = {
  modelId: "isabella-core",
  version: "1.0.0",
  territoryId: "latam",
  ownerId: "isabella",
  task: "classification",
  algorithm: "deterministic-logreg",
  datasetIds: ["dataset-1"],
  modelHash: "base-model",
  createdAt: "2026-09-14T00:00:00.000Z",
  approvalStatus: "APPROVED",
};

const base: ModelArtifact = { weights: [1, 2], bias: 0, artifactHash: "base-artifact" };

function update(nodeId: string, sampleCount: number, deltaWeights: number[]): FederatedUpdate {
  const payload = { nodeId, sampleCount, deltaWeights };
  return {
    updateId: nodeId,
    nodeId,
    territoryId: "latam",
    modelId: model.modelId,
    baseModelVersion: model.version,
    deltaWeights,
    deltaBias: 0.1,
    sampleCount,
    metrics: { loss: 0.2, accuracy: 0.9 },
    updateHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    signature: "verified-by-caller",
    createdAt: "2026-09-14T00:00:00.000Z",
  };
}

const verifySignature = (update: FederatedUpdate) => update.signature === "verified-by-caller";

describe("federated ML aggregation", () => {
  it("weights verified updates by sample count and commits a deterministic round", () => {
    const result = aggregateFederatedUpdates(
      model,
      base,
      [update("node-a", 1, [1, 0]), update("node-b", 3, [0, 1])],
      verifySignature,
    );
    expect(result.round.aggregation).toBe("FEDAVG");
    expect(result.round.status).toBe("COMMITTED");
    expect(result.artifact.weights[0]).toBeCloseTo(1.25);
    expect(result.artifact.weights[1]).toBeCloseTo(2.75);
    expect(result.artifact.artifactHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects updates that do not belong to the same approved model", () => {
    expect(() =>
      aggregateFederatedUpdates(
        model,
        base,
        [update("node-a", 1, [1, 0]), { ...update("node-b", 1, [0, 1]), modelId: "other-model" }],
        verifySignature,
      ),
    ).toThrow("insufficient_valid_federated_updates");
  });

  it("never aggregates an update whose signature verifier rejects it", () => {
    expect(() =>
      aggregateFederatedUpdates(
        model,
        base,
        [update("node-a", 1, [1, 0]), { ...update("node-b", 1, [0, 1]), signature: "forged" }],
        verifySignature,
      ),
    ).toThrow("insufficient_valid_federated_updates");
  });
});
