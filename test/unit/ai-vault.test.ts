import { afterEach, describe, expect, it } from "vitest";
import {
  aiVault,
  clearAiVaultForTests,
  evaluateAi,
  registerAi,
  resolveAi,
} from "@/lib/governance/ai-vault";

describe("governed AI vault", () => {
  afterEach(() => clearAiVaultForTests());

  it("registers and resolves an open model with provenance", () => {
    registerAi({
      id: "isabella/native-risk",
      version: "1.0.0",
      provider: "isabella",
      license: "Apache-2.0",
      sourceUrl: "https://example.org/model",
      artifactHash: "sha256:test",
      capabilities: ["classification", "risk-scoring"],
      dataResidency: "local",
      trust: "verified",
      openSource: true,
      openScience: true,
    });

    expect(resolveAi("isabella/native-risk", "1.0.0").artifactHash).toBe("sha256:test");
    expect(aiVault.describeAiVault().count).toBe(1);
  });

  it("rejects revoked or incompatible entries", () => {
    const entry = {
      id: "vendor/closed-model",
      version: "1.0.0",
      provider: "vendor",
      license: "MIT" as const,
      sourceUrl: "https://example.org/model",
      artifactHash: "sha256:test",
      capabilities: ["chat"],
      dataResidency: "global",
      trust: "revoked" as const,
      openSource: true,
      openScience: false,
    };

    expect(evaluateAi(entry).allowed).toBe(false);
    registerAi(entry);
    expect(() => resolveAi(entry.id, entry.version)).toThrow("ai_not_authorized");
  });
});
