import { describe, expect, it } from "vitest";

import { QUPQuantumBridgeIntegrator } from "@/lib/ncua/quantum-align";
import type { ContinuousConceptVector } from "@/lib/ncua/concept-engine";

describe("ncua:quantum-align", () => {
  const dummyConcept: ContinuousConceptVector = {
    conceptId: "concept_aabb1122",
    latentDimensions: [0.5, 0.2, -0.3, 0.9, 0, 0.7, -0.1, 0.4],
    semanticEnergy: 0.42,
    epistemicConfidence: 95,
  };

  it("gradient parameter-shift equivale a cos(theta) exacta", () => {
    const bridge = new QUPQuantumBridgeIntegrator();
    const theta = 0.5;
    const concept: ContinuousConceptVector = {
      ...dummyConcept,
      latentDimensions: [theta, 0.2, 0, 0, 0, 0, 0, 0],
    };
    const result = bridge.executeQuantumStateAlignment(concept);
    const expectedGrad = Math.cos(theta);
    expect(result.parameterShiftGradient).toBeCloseTo(expectedGrad, 6);
  });

  it("entanglementEntropy está en rango [0, 0.985]", () => {
    const result = new QUPQuantumBridgeIntegrator().executeQuantumStateAlignment(dummyConcept);
    expect(result.entanglementEntropy).toBeGreaterThanOrEqual(0);
    expect(result.entanglementEntropy).toBeLessThanOrEqual(0.985);
  });

  it("merkleSeal es SHA3-512 de 128 hex chars determinista", () => {
    const a = new QUPQuantumBridgeIntegrator().executeQuantumStateAlignment(dummyConcept);
    const b = new QUPQuantumBridgeIntegrator().executeQuantumStateAlignment(dummyConcept);
    expect(a.merkleSeal).toBe(b.merkleSeal);
    expect(a.merkleSeal).toHaveLength(128);
  });

  it("qubitAmplitudes tiene exactamente 2 entradas con formato canónico", () => {
    const result = new QUPQuantumBridgeIntegrator().executeQuantumStateAlignment(dummyConcept);
    expect(result.qubitAmplitudes).toHaveLength(2);
    expect(result.qubitAmplitudes[0]).toContain("+ 0.0000i");
    expect(result.qubitAmplitudes[1]).toContain("exp(");
  });
});
