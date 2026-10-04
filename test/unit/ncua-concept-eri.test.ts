import { describe, expect, it } from "vitest";

import {
  computeEri,
  entropyPenalty,
  fragmentationPenalty,
  isEriCompliant,
  ERI_MIN_SCORE,
  detectSycophancy,
  detectTerritorialDrift,
} from "@/lib/ncua/eri";
import { classifySophiaLevel } from "@/lib/ncua/sophia-epistemics";
import { ContinuousConceptEngine, TunableConceptEngine } from "@/lib/ncua/concept-engine";
import { ByteEntropyPatcher } from "@/lib/ncua/entropy-patcher";

describe("ncua:eri — entropyPenalty", () => {
  it("penaliza por debajo del rango objetivo (entropía baja = tokenización saturada)", () => {
    expect(entropyPenalty(1.8)).toBe(0);
    expect(entropyPenalty(1.5)).toBe(12);
    expect(entropyPenalty(1.0)).toBe(32);
  });

  it("penaliza levemente por encima del rango (corpus natural rico)", () => {
    expect(entropyPenalty(2.0)).toBe(0);
    expect(entropyPenalty(3.0)).toBe(8);
    expect(entropyPenalty(4.0)).toBe(16);
  });
});

describe("ncua:eri — fragmentationPenalty", () => {
  it("no penaliza cuando los parches son proporcionales al tamaño del input", () => {
    expect(fragmentationPenalty(10, 100)).toBe(0);
  });

  it("penaliza exceso de fragmentación", () => {
    expect(fragmentationPenalty(60, 100)).toBeGreaterThan(0);
  });
});

describe("ncua:eri — computeEri", () => {
  it("content E3 con entropía natural y sin sesgo pasa el umbral", () => {
    const result = computeEri({
      avgEntropy: 3.0,
      inputBytes: 300,
      patchCount: 20,
      evidenceLevel: 3,
      sycophancyDetected: false,
      territorialDriftDetected: false,
    });
    expect(result.eri).toBeGreaterThanOrEqual(ERI_MIN_SCORE);
    expect(result.compliant).toBe(true);
    expect(result.breakdown.evidenceBonus).toBe(24);
  });

  it("content E0 con sycophancy y corpus saturado es rechazado", () => {
    const result = computeEri({
      avgEntropy: 1.5,
      inputBytes: 100,
      patchCount: 10,
      evidenceLevel: 0,
      sycophancyDetected: true,
      territorialDriftDetected: false,
    });
    expect(result.eri).toBeLessThan(ERI_MIN_SCORE);
    expect(result.compliant).toBe(false);
    expect(result.breakdown.biasPenalty).toBe(15);
  });

  it("doble sesgo (sycophancy + drift territorial) incrementa penalidad", () => {
    const result = computeEri({
      avgEntropy: 2.0,
      inputBytes: 200,
      patchCount: 10,
      evidenceLevel: 0,
      sycophancyDetected: true,
      territorialDriftDetected: true,
    });
    expect(result.breakdown.biasPenalty).toBe(30);
  });
});

describe("ncua:eri — bias detection", () => {
  it("detecta sycophancy en español", () => {
    const result = detectSycophancy("Claro, tienes razón y a mi parecer es impecable.");
    expect(result.detected).toBe(true);
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
  });

  it("detecta deriva territorial", () => {
    const result = detectTerritorialDrift(
      "Aplicar la ley de estados unidos es incorrecto en este territorio.",
    );
    expect(result.detected).toBe(true);
  });
});

describe("ncua:sophia-epistemics", () => {
  it("clasifica E0 para opiniones personales", () => {
    const result = classifySophiaLevel("A mi parecer, esto es lo mejor que he visto.");
    expect(result.level).toBe(0);
    expect(result.score).toBe(0);
  });

  it("clasifica E3 para contenido experimental reproducible", () => {
    const result = classifySophiaLevel(
      "El experimento reproducible usó un método de medición con métricas benchmark y protocolo estándar.",
    );
    expect(result.level).toBe(3);
    expect(result.score).toBe(24);
  });

  it("clasifica E4 para demostraciones axiomáticas", () => {
    const result = classifySophiaLevel(
      "La segunda ley de la termodinámica es un axioma verificable por teorema y ecuación.",
    );
    expect(result.level).toBe(4);
    expect(result.score).toBe(32);
  });
});

describe("ncua:concept-engine — TunableConceptEngine", () => {
  it("umbral 1.8 maximiza la gaussiana ERI de tuning", () => {
    const patcher18 = new ByteEntropyPatcher(4, 1.8);
    const patcher25 = new ByteEntropyPatcher(4, 2.5);
    const text = "Ejecutar análisis de soberanía territorial e inspección cuántica.";
    const p18 = patcher18.segmentIntoBytePatches(text);
    const p25 = patcher25.segmentIntoBytePatches(text);
    const engine = new TunableConceptEngine(8);
    expect(engine.projectToContinuousConcept(p18, 1.8).eriScore).toBeGreaterThanOrEqual(
      engine.projectToContinuousConcept(p25, 2.5).eriScore,
    );
  });
});
