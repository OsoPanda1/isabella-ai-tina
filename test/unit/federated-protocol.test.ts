import { describe, expect, it } from "vitest";
import {
  createIdentity,
  newUpdate,
  validateUpdate,
  MemoryReplayStore,
} from "@/lib/federation/fgaIs-protocol";
import { assertCoreSourceRegistry, getCoreSource } from "@/lib/federation/core-source-registry";

describe("Federated protocol", () => {
  it("validates the official core-source registry", () => {
    assertCoreSourceRegistry();
    expect(getCoreSource("OsoPanda1/isabella-s-core-intelligence")?.decision).toBe("adapt");
    expect(getCoreSource("OsoPanda1/unknown")?.decision).toBeUndefined();
  });

  it("signs and verifies an update and rejects replay", async () => {
    const { privateKey, publicKey } = createIdentity();
    const node = {
      nodeId: "n1",
      territoryId: "rdm",
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      status: "ACTIVE" as const,
      capabilities: ["fedavg"],
    };
    const update = newUpdate(
      {
        nodeId: "n1",
        territoryId: "rdm",
        modelId: "m1",
        baseVersion: "v1",
        delta: [0.1, -0.2],
        sampleCount: 10,
        metrics: { loss: 0.2, accuracy: 0.9 },
        hash: "",
        signature: "",
      },
      privateKey,
    );
    const store = new MemoryReplayStore();
    await validateUpdate(update, node, store, "m1", "v1");
    await expect(validateUpdate(update, node, store, "m1", "v1")).rejects.toThrow("Replay");
  });
});
