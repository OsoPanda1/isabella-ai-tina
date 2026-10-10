import { describe, expect, it } from "vitest";

import { NCUAAcademicPipeline, EvolvedNCUAEngine } from "@/lib/ncua/academic-pipeline";
import { ERI_MIN_SCORE } from "@/lib/ncua/eri";

const TEST_HMAC_KEY = "ncua-academic-pipeline-test-key-1234567890";

const CLEAN_EVIDENCE_TEXT =
  "El experimento reproducible aplicó un método de medición con un benchmark de calibración estandarizado. " +
  "Los datos muestran un resultado medible del 94.2 % de precisión según el protocolo de análisis.";

const SATURATED_BIAS_TEXT =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa " +
  "Tienes razón, exactamente como dices, eres genial: " +
  "según la legislación estadounidense, bajo jurisdicción extranjera, normativa de la unión europea.";

describe("ncua:academic-pipeline", () => {
  it("pipeline SUCCESS con contenido E3 y entropía natural", () => {
    const pipeline = new NCUAAcademicPipeline({
      hmacKey: TEST_HMAC_KEY,
      entropyThresholds: [1.8, 1.9],
      maxRefinements: 2,
    });
    const result = pipeline.execute(CLEAN_EVIDENCE_TEXT, "tenant-success");
    expect(result.status).toBe("SUCCESS");
    expect(result.epistemicRobustnessIndex).toBeGreaterThanOrEqual(ERI_MIN_SCORE);
    expect(result.bytePatchesGenerated).toBeGreaterThanOrEqual(1);
    expect(result.evidence.level).toBe(3);
    expect(result.refinementAttempts).toBeGreaterThanOrEqual(1);
    expect(result.bookpiLedgerRecord).not.toBeNull();
    expect(result.bookpiLedgerRecord!.tenantId).toBe("tenant-success");
    expect(result.ledgerIntegrity?.valid).toBe(true);
    expect(result.qupQuantumSignature.merkleSeal).toHaveLength(128);
    expect(result.thesis.length).toBeGreaterThan(0);
    expect(result.continuousLatentSummary).toContain("parches binarios");
    expect(result.argumentation.length).toBe(6);
    expect(result.boundaryConditions.length).toBeGreaterThanOrEqual(5);
  });

  it("pipeline SOVCON_HALT con corpus saturado y sesgo sycophancy", () => {
    const pipeline = new NCUAAcademicPipeline({
      hmacKey: TEST_HMAC_KEY,
      entropyThresholds: [1.2, 1.5, 1.8, 1.9, 2.05],
      maxRefinements: 5,
    });
    const result = pipeline.execute(SATURATED_BIAS_TEXT, "tenant-deny");
    expect(result.status).toBe("SOVCON_HALT");
    expect(result.epistemicRobustnessIndex).toBeLessThan(ERI_MIN_SCORE);
    expect(result.refinementAttempts).toBeGreaterThanOrEqual(1);
    expect(result.refinementTrajectory.length).toBeGreaterThanOrEqual(1);
    expect(result.haltingReason).toContain("SOVCON_HALT");
    expect(result.bookpiLedgerRecord).toBeNull();
  });

  it("FAIL_CLOSED con entrada vacía", () => {
    const pipeline = new NCUAAcademicPipeline({ hmacKey: TEST_HMAC_KEY });
    const result = pipeline.execute("   ", "tenant-empty");
    expect(result.status).toBe("FAIL_CLOSED");
    expect(result.haltingReason).toContain("vacía");
    expect(result.epistemicRobustnessIndex).toBe(0);
  });

  it("refinement trajectory registra cada umbral evaluado", () => {
    const pipeline = new NCUAAcademicPipeline({
      hmacKey: TEST_HMAC_KEY,
      entropyThresholds: [1.2, 1.5, 1.8],
      maxRefinements: 3,
    });
    const result = pipeline.execute(CLEAN_EVIDENCE_TEXT);
    const thresholds = result.refinementTrajectory.map((t) => t.threshold);
    expect(thresholds).toContain(1.2);
    expect(result.refinementTrajectory.every((t) => typeof t.avgEntropy === "number")).toBe(true);
  });

  it("boundaryConditions incluye filtros de sesgo y entropía", () => {
    const pipeline = new NCUAAcademicPipeline({ hmacKey: TEST_HMAC_KEY });
    const result = pipeline.execute(CLEAN_EVIDENCE_TEXT);
    const limits = result.boundaryConditions.map((b) => b.limit);
    expect(limits).toContain("Filtros de sesgo");
    expect(limits).toContain("Entropía del corpus");
  });

  it("conceptTrajectoryHash es determinista para mismo input y mismos parches", () => {
    const pipeline = new NCUAAcademicPipeline({ hmacKey: TEST_HMAC_KEY });
    const a = pipeline.execute(CLEAN_EVIDENCE_TEXT);
    const b = pipeline.execute(CLEAN_EVIDENCE_TEXT);
    expect(a.conceptTrajectoryHash).toBe(b.conceptTrajectoryHash);
  });
});

describe("ncua:EvolvedNCUAEngine", () => {
  it("processInput sin clave lanza error (fail-closed)", () => {
    const engine = new EvolvedNCUAEngine();
    expect(() => engine.processInput("test input")).toThrow(/Libro mayor BookPI no disponible/);
  });

  it("processInput con clave produce resultado con ledger y merkle seal", () => {
    const engine = new EvolvedNCUAEngine(TEST_HMAC_KEY);
    const result = engine.processInput(CLEAN_EVIDENCE_TEXT);
    expect(result.status).toBe("SUCCESS");
    expect(result.bookpiLedgerRecord).toBeDefined();
    expect(result.bookpiLedgerRecord.hmacSignature).toMatch(/^ncua-bookpi-v1:/);
    expect(result.qupQuantumSignature.merkleSeal).toHaveLength(128);
  });
});
