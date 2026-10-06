import { describe, it, expect } from "vitest";
import { doublePipeline } from "../../src/lib/isabella/double-pipeline";
import { MetricsDashboard } from "../../src/components/isabella/MetricsDashboard";

describe("MetricsDashboard & Super Turbo Hexagonal Latency", () => {
  it("MetricsDashboard component is defined and exported correctly", () => {
    expect(MetricsDashboard).toBeDefined();
    expect(typeof MetricsDashboard).toBe("function");
  });

  it("DoublePipeline expone percentiles e historial sin muestras fabricadas", () => {
    const snapshot = doublePipeline.getSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot.metricsA).toBeDefined();
    expect(snapshot.metricsB).toBeDefined();

    // Antes de la primera ejecución real los percentiles son 0 (sin datos);
    // el pipeline ya no siembra 20 latencias sintéticas de arranque (P0-10).
    expect(snapshot.metricsA.p50).toBe(0);
    expect(snapshot.metricsA.p95).toBeGreaterThanOrEqual(snapshot.metricsA.p50);
    expect(snapshot.metricsA.p99).toBeGreaterThanOrEqual(snapshot.metricsA.p95);
    expect(snapshot.healthA).toBe(0);
    expect(snapshot.turboSpeedupFactor).toBeGreaterThanOrEqual(1.0);

    // El historial arranca vacío: sólo se llena con puntos reales.
    expect(snapshot.history.length).toBe(0);
  });

  it("Super Turbo benchmark updates latency history dynamically", async () => {
    const beforeCount = doublePipeline.getSnapshot().history.length;
    const snap = await doublePipeline.runSuperTurboBenchmark(2);

    expect(snap.turboModeEnabled).toBe(true);
    // Speedup medido a partir de las series reales (sin serie regular
    // comparable devuelve 1.0), nunca una constante 3.42 (P0-10).
    expect(snap.turboSpeedupFactor).toBeGreaterThanOrEqual(1.0);
    expect(snap.parallelSavingsMs).toBeGreaterThan(0);
    expect(snap.totalProcessed).toBeGreaterThan(0);
    expect(snap.history.length).toBeGreaterThanOrEqual(beforeCount);
    expect(snap.history.length).toBeGreaterThan(0);
  });
});
