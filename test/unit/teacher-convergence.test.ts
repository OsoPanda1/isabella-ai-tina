import { describe, expect, it } from "vitest";
import { convergeTeacherObservations } from "@/lib/native-ml";

describe("teacher convergence", () => {
  it("selects the most supported high-confidence observation and preserves provenance", () => {
    const result = convergeTeacherObservations([
      {
        teacherId: "gemini",
        response: "La respuesta requiere verificar la fuente.",
        confidence: 0.9,
      },
      {
        teacherId: "claude",
        response: "La respuesta requiere verificar la fuente.",
        confidence: 0.8,
      },
      {
        teacherId: "copilot",
        response: "La respuesta requiere verificar la fuente.",
        confidence: 0.85,
      },
      {
        teacherId: "chatgpt",
        response: "La respuesta es inmediata y definitiva.",
        confidence: 0.95,
      },
    ]);
    expect(result.consensusText).toContain("verificar la fuente");
    expect(result.teacherIds).toHaveLength(4);
    expect(result.provenanceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("marks strong disagreement instead of manufacturing certainty", () => {
    const result = convergeTeacherObservations([
      { teacherId: "a", response: "Alpha completely unrelated.", confidence: 0.9 },
      { teacherId: "b", response: "Beta entirely different.", confidence: 0.9 },
    ]);
    expect(result.conflict).toBe(true);
    expect(result.agreementScore).toBeLessThan(0.35);
  });

  it("rejects a single teacher because convergence requires independent observations", () => {
    expect(() =>
      convergeTeacherObservations([{ teacherId: "chatgpt", response: "solo", confidence: 1 }]),
    ).toThrow("teacher_convergence_requires_multiple_observations");
  });
});
