import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ArgusAionBehaviorSentinel } from "@/lib/argus-aion-behavior";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function sample(
  sequence: number,
  overrides: Partial<{
    latencyMs: number;
    riskScore: number;
    vetoRate: number;
    policyVersion: string;
  }> = {},
) {
  return {
    sequence,
    capturedAt: new Date(1_700_000_000_000 + sequence).toISOString(),
    latencyMs: 12,
    riskScore: 0.2,
    vetoRate: 0.1,
    policyVersion: "policy-v1",
    decisionDigest: digest(`decision-${sequence}`),
    ...overrides,
  };
}

describe("ARGUS AION behavioral sentinel", () => {
  it("learns a bounded baseline before declaring normality", () => {
    const sentinel = new ArgusAionBehaviorSentinel({ minimumSamples: 4, baselineWindow: 16 });
    expect(sentinel.observe(sample(1)).status).toBe("LEARNING");
    sentinel.observe(sample(2));
    sentinel.observe(sample(3));
    const assessment = sentinel.observe(sample(4));
    expect(assessment.status).toBe("LEARNING");
    expect(sentinel.observe(sample(5)).status).toBe("NORMAL");
  });

  it("escalates a severe behavioral deviation", () => {
    const sentinel = new ArgusAionBehaviorSentinel({ minimumSamples: 4, baselineWindow: 16 });
    for (let i = 1; i <= 5; i++) sentinel.observe(sample(i));
    const assessment = sentinel.observe(
      sample(6, {
        latencyMs: 20_000,
        riskScore: 0.99,
        vetoRate: 0.99,
        policyVersion: "unexpected",
      }),
    );
    expect(["SUSPICIOUS", "CRITICAL"]).toContain(assessment.status);
    expect(assessment.anomalyScore).toBeGreaterThan(0.55);
  });

  it("rejects replayed or malformed observations", () => {
    const sentinel = new ArgusAionBehaviorSentinel();
    sentinel.observe(sample(1));
    expect(() => sentinel.observe(sample(1))).toThrow("aion_behavior_invalid_sequence");
    expect(() => sentinel.observe({ ...sample(2), decisionDigest: "bad" })).toThrow(
      "aion_behavior_invalid_integrity",
    );
  });
});
