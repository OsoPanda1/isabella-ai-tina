import { describe, expect, it } from "vitest";
import {
  convergeKnowledge,
  type KnowledgeObservation,
} from "../../src/lib/native-ml/convergence-engine";

const observation = (teacherId: string, claim: string): KnowledgeObservation => ({
  teacherId,
  modelId: `model-${teacherId}`,
  domain: "technical",
  claim,
  evidenceLevel: "E3",
  confidence: 0.9,
  freshness: 0.95,
  provenanceHash: "a".repeat(64),
});

describe("convergence evidence integrity", () => {
  it("does not manufacture consensus from a single observation", () => {
    const result = convergeKnowledge([observation("teacher-a", "claim one")]);
    expect(result.state).toBe("UNKNOWN");
    expect(result.selectedClaim).toBeNull();
  });

  it("rejects validator identities as independent evidence", () => {
    const result = convergeKnowledge([
      observation("teacher-a", "claim one"),
      observation("teacher-a_validator", "claim one"),
    ]);
    expect(result.state).toBe("UNKNOWN");
    expect(result.selectedClaim).toBeNull();
    expect(result.rationale[0]).toBe("synthetic_validator_observation_rejected");
  });

  it("rejects duplicate teacher identities", () => {
    const result = convergeKnowledge([
      observation("teacher-a", "claim one"),
      observation("teacher-a", "claim one"),
    ]);
    expect(result.state).toBe("UNKNOWN");
    expect(result.selectedClaim).toBeNull();
    expect(result.rationale[0]).toBe("duplicate_teacher_identity_rejected");
  });
});
