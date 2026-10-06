import { describe, expect, it } from "vitest";
import { decisionDisclosure } from "@/lib/governance/ai-disclosure";

describe("decisionDisclosure", () => {
  it("never authorizes automatic execution", () => {
    for (const risk of ["L0", "L1", "L2", "L3", "L4"] as const) {
      expect(decisionDisclosure(risk).automaticExecutionAllowed).toBe(false);
    }
  });

  it("requires human review for material and high-impact levels", () => {
    expect(decisionDisclosure("L0").requiresHumanReview).toBe(false);
    expect(decisionDisclosure("L1").requiresHumanReview).toBe(true);
    expect(decisionDisclosure("L2").requiresHumanReview).toBe(true);
    expect(decisionDisclosure("L3").requiresHumanReview).toBe(true);
    expect(decisionDisclosure("L4").requiresHumanReview).toBe(true);
  });

  it("discloses user responsibility", () => {
    expect(decisionDisclosure("L2").message).toContain("debe revisar");
  });
});
