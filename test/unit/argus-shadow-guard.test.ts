import { describe, expect, it } from "vitest";
import { evaluateArgusShadow, verifyArgusShadowBinding } from "@/lib/argus-shadow-guard";

const base = {
  tenantId: "tenant-a",
  actorId: "actor-a",
  requestId: "request-a",
  traceId: "trace-a",
  action: "tool.execute",
  payloadDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  authenticated: true,
  approvalBound: true,
  integrityVerified: true,
};

describe("ARGUS shadow guard", () => {
  it("keeps a low-risk valid request on the CPU-only fast path", () => {
    const decision = evaluateArgusShadow({ ...base, riskScore: 0.1 });
    expect(decision.decision).toBe("ALLOW");
    expect(decision.latencyClass).toBe("FAST_PATH");
    expect(verifyArgusShadowBinding({ ...base, riskScore: 0.1 }, decision)).toBe(true);
  });

  it("vetoes invalid integrity or identity even at low risk", () => {
    const decision = evaluateArgusShadow({
      ...base,
      riskScore: 0.05,
      authenticated: false,
      integrityVerified: false,
    });
    expect(decision.decision).toBe("DENY");
    expect(decision.reasonCodes).toEqual(
      expect.arrayContaining(["IDENTITY_REQUIRED", "INTEGRITY_UNVERIFIED"]),
    );
  });

  it("rejects a decision replayed against a different request", () => {
    const decision = evaluateArgusShadow({ ...base, riskScore: 0.1 });
    expect(
      verifyArgusShadowBinding(
        { ...base, requestId: "different-request", riskScore: 0.1 },
        decision,
      ),
    ).toBe(false);
  });

  it("vetoes critical risk without granting authority to the shadow layer", () => {
    const decision = evaluateArgusShadow({ ...base, riskScore: 0.99 });
    expect(decision.decision).toBe("DENY");
    expect(decision.riskLevel).toBe("CRITICAL");
  });
});
