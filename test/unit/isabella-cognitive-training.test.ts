import { describe, expect, it } from "vitest";
import {
  createIsabellaCognitiveTrainingEngine,
  trainingSampleSignature,
} from "../../src/lib/isabella-cognitive-training";

const sample = {
  input: "Explica cómo verificar una migración antes de producción.",
  target: "Ejecutar replay, comprobar invariantes y registrar evidencia.",
  negative: "Desplegar directamente sin validar.",
  source: "test-suite",
  skillIds: ["database", "release"],
  quality: 0.9,
  consent: true,
};

describe("Isabella cognitive training", () => {
  it("expands counterfactual training into multiple auditable signals", () => {
    const engine = createIsabellaCognitiveTrainingEngine();
    const result = engine.train("counterfactual", sample);

    expect(result.accepted).toBeGreaterThan(0);
    expect(result.signatures.length).toBeGreaterThan(0);
  });

  it("supports retrieval and reflective understanding strategies", () => {
    const engine = createIsabellaCognitiveTrainingEngine();
    const retrieval = engine.train("retrieval", sample);
    const reflection = engine.train("reflection", sample);

    expect(retrieval.accepted).toBeGreaterThan(0);
    expect(reflection.accepted).toBeGreaterThan(0);
    expect(engine.evaluateUnderstanding("migración producción").concepts.length).toBeGreaterThan(0);
  });

  it("produces stable strategy signatures", () => {
    expect(trainingSampleSignature("semantic", sample)).toBe(
      trainingSampleSignature("semantic", { ...sample }),
    );
  });

  it("deduplicates skills and clamps quality before persistence", () => {
    const engine = createIsabellaCognitiveTrainingEngine();
    const result = engine.train("semantic", {
      ...sample,
      skillIds: ["DB", "db", " DB "],
      quality: 99,
    });

    expect(result.accepted).toBe(1);
    expect(result.results[0]?.competence[0]?.score).toBeLessThanOrEqual(1);
  });
});
