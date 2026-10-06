import { describe, expect, it } from "vitest";
import {
  NATIVE_SKILL_SOURCES,
  createNativeFusedSkill,
  executeNativeSkill,
  nativeSkillSimilarity,
  resolveNativeSkillFamily,
} from "@/lib/native-ml/skill-fusion";

describe("native skill fusion", () => {
  it("registers every requested external skill family as native capability metadata", () => {
    expect(NATIVE_SKILL_SOURCES.length).toBeGreaterThanOrEqual(19);
    expect(NATIVE_SKILL_SOURCES.every((source) => source.native)).toBe(true);
    expect(NATIVE_SKILL_SOURCES.every((source) => source.externalSideEffectsRequireAdapter)).toBe(
      true,
    );
  });

  it("routes ordinary reasoning through the local NCUA substrate", () => {
    const result = executeNativeSkill({
      skillId: "knowledge-work-summary",
      task: "research evidence and prepare a structured brief",
      input: { prompt: "research evidence" },
    });

    expect(result.native).toBe(true);
    expect(result.status).toBe("SUCCESS");
    expect(result.semanticVector).toHaveLength(64);
    expect(result.provenanceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.evidence.length).toBe(2);
  });

  it("refuses to simulate external side effects", () => {
    const result = executeNativeSkill({
      skillId: "shipping-and-launch",
      task: "deploy the application and publish the release",
      input: {},
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.missingAdapters).toContain("external-side-effect-adapter");
    expect(result.summary).toContain("adaptador");
  });

  it("produces deterministic semantic similarity", () => {
    const first = nativeSkillSimilarity(
      "financial earnings analysis",
      "analysis of financial earnings",
    );
    const second = nativeSkillSimilarity("financial earnings analysis", "flutter widget testing");
    expect(first).toBeGreaterThan(second);
    expect(first).toBeLessThanOrEqual(1);
    expect(second).toBeLessThanOrEqual(1);
  });

  it("creates a registry-compatible fused skill", async () => {
    const skill = createNativeFusedSkill({
      id: "native-fixture",
      name: "Native Fixture",
      version: "1.0.0",
      federation: "TERRITORY",
      risk: "LOW",
      description: "fixture",
    });
    const result = await skill.run(
      { prompt: "analyze a territorial report" },
      { requestId: "req_test", locale: "es-MX", federation: "TERRITORY", intent: "analysis" },
    );
    expect(result.skillId).toBe("native-fixture");
    expect(result.status).toBe("SUCCESS");
    expect(result.data).toMatchObject({ native: true });
    expect(result.auditEvents).toHaveLength(1);
  });

  it("resolves known source families without introducing executable dependencies", () => {
    const source = resolveNativeSkillFamily("anthropics-skills-frontend-design");
    expect(source.native).toBe(true);
    expect(source.externalSideEffectsRequireAdapter).toBe(true);
  });
});
