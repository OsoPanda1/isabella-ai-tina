import { describe, expect, it } from "vitest";
import { getAIGovernanceProfile } from "@/lib/ai-governance";

describe("AI governance profile", () => {
  it("publishes explicit human-oversight and fail-closed controls", () => {
    const profile = getAIGovernanceProfile();

    expect(profile.schema).toBe("isabella.ai.governance.v1");
    expect(profile.governance.humanOversight).toBe(true);
    expect(profile.governance.consequentialDecisionAuthority).toBe("human");
    expect(profile.governance.shutdownCapability).toBe(true);
    expect(profile.governance.auditability).toBe(true);
    expect(profile.safety.productionGuestChat).toBe(false);
    expect(profile.safety.failClosedOnCriticalConfiguration).toBe(true);
  });

  it("never exposes credentials or runtime secrets", () => {
    const serialized = JSON.stringify(getAIGovernanceProfile()).toLowerCase();
    expect(serialized).not.toMatch(/api[_-]?key|secret|password|token|private[_-]?key/);
  });

  it("declares engineering alignment without claiming legal certification", () => {
    const profile = getAIGovernanceProfile();

    expect(profile.standardsAlignment).toContain(
      "EU AI Act transparency and human-oversight principles",
    );
    expect(profile.standardsAlignment).toContain("NIST AI RMF Govern-Map-Measure-Manage");
    expect(profile.standardsAlignment).toContain("ISO/IEC 42001 AI management-system principles");
    expect(profile.standardsAlignment).toContain("OWASP Top 10 for LLM Applications 2025");
    expect(profile.legalNotice).toMatch(/not a legal certification/i);
  });

});
