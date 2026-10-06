import { describe, expect, it } from "vitest";
import { AI_GOVERNANCE_PROFILE, getAIGovernanceProfile } from "@/lib/ai-governance";

describe("AI governance contract", () => {
  it("exposes a stable machine-readable governance profile", () => {
    const profile = getAIGovernanceProfile();

    expect(profile.schema).toBe("isabella.ai.governance.v1");
    expect(profile.system.name).toBe("Isabella AI Genesis");
    expect(profile.governance.humanOversight).toBe(true);
    expect(profile.governance.autonomousHighImpactDecisionMaking).toBe(false);
    expect(profile.governance.consequentialDecisionAuthority).toBe("human");
    expect(profile.governance.shutdownCapability).toBe(true);
    expect(profile.governance.auditability).toBe(true);
  });

  it("fails closed in the declared production safety posture", () => {
    expect(AI_GOVERNANCE_PROFILE.safety.productionGuestChat).toBe(false);
    expect(AI_GOVERNANCE_PROFILE.safety.syntheticProductionTelemetryForbidden).toBe(true);
    expect(AI_GOVERNANCE_PROFILE.safety.failClosedOnCriticalConfiguration).toBe(true);
    expect(AI_GOVERNANCE_PROFILE.evaluation.continuousRiskManagement).toBe(true);
    expect(AI_GOVERNANCE_PROFILE.evaluation.runtimeMonitoring).toBe(true);
  });

  it("never serializes credential-like fields or values", () => {
    const serialized = JSON.stringify(AI_GOVERNANCE_PROFILE);
    expect(serialized).not.toMatch(/(?:api[-_ ]?key|password|private[-_ ]?key)\\s*[:=]/i);
    expect(serialized).not.toMatch(/(?:bearer|sk[-_][a-z0-9]{8,})/i);
  });

  it("explicitly avoids claiming legal certification", () => {
    expect(AI_GOVERNANCE_PROFILE.legalNotice).toMatch(/not a legal certification/i);
  });
});
