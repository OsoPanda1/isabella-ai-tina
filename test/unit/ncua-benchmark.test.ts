import { beforeAll, describe, expect, it } from "vitest";

import {
  executeNcuaBenchmark,
  estimateNcuaVramSavings,
  BENCHMARK_ENTROPY_THRESHOLDS,
  NCUA_BENCHMARK_PROMPTS,
  type NcuaBenchmarkReport,
} from "@/lib/ncua/benchmark";

describe("ncua:benchmark", () => {
  let report: NcuaBenchmarkReport;

  beforeAll(() => {
    report = executeNcuaBenchmark();
  });

  it("ejecuta 5 umbrales de entropía", () => {
    expect(report.rows.length).toBe(BENCHMARK_ENTROPY_THRESHOLDS.length);
    expect(report.thresholds).toEqual([...BENCHMARK_ENTROPY_THRESHOLDS]);
  });

  it("umbral recomendado está en rango [1.8, 2.0]", () => {
    expect(report.recommendedThreshold).toBeGreaterThanOrEqual(1.8);
    expect(report.recommendedThreshold).toBeLessThanOrEqual(2.0);
  });

  it("latencia positiva en todos los escenarios", () => {
    for (const scenario of report.scenarios) {
      expect(scenario.ncuaLatencyMs).toBeGreaterThanOrEqual(0);
      expect(scenario.traditionalLatencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("aceleración NCUA sobre pipeline BPE simulado", () => {
    for (const scenario of report.scenarios) {
      expect(Number.isFinite(scenario.speedupX)).toBe(true);
      expect(scenario.speedupX).toBeGreaterThan(0);
      expect(scenario.ncuaLatencyMs).toBeLessThan(50);
    }
  });

  it("VRAM estimada NCUA es cero (sin matriz de embeddings)", () => {
    expect(report.ncuaEstimatedVramMb).toBe(0);
  });

  it("VRAM estimada del pipeline BPE es significativamente mayor a cero", () => {
    expect(report.traditionalPeakVramMb).toBeGreaterThan(100);
  });

  it("estimación de ahorro de VRAM coherente", () => {
    const scenario = report.scenarios[0];
    const savings = estimateNcuaVramSavings(scenario);
    expect(savings.ncuaMb).toBe(0);
    expect(savings.savingsMb).toBe(savings.traditionalMb);
  });

  it("parches generados en escenarios > 0", () => {
    for (const scenario of report.scenarios) {
      expect(scenario.patches).toBeGreaterThanOrEqual(1);
    }
  });

  it("prompts de benchmark contienen 3 escenarios", () => {
    expect(NCUA_BENCHMARK_PROMPTS.length).toBe(3);
  });
});
