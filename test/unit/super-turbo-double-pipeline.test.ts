import { describe, it, expect, beforeEach } from "vitest";
import {
  HexagonalPipeline,
  DoublePipelineRouter,
  TriangularTurboCache,
} from "../../src/lib/isabella/double-pipeline";

describe("Super Turbo Hexagonal Pipeline Engine", () => {
  let router: DoublePipelineRouter;

  beforeEach(() => {
    router = new DoublePipelineRouter();
  });

  it("TriangularTurboCache correctly handles Ring A, B, and C with TTL", () => {
    const cache = new TriangularTurboCache();

    // Ring A (Policy verdicts)
    cache.setRingA("policy-hash-1", true, 5000);
    expect(cache.getRingA("policy-hash-1")).toBe(true);
    expect(cache.getRingA("non-existent")).toBeNull();

    // Ring B (Contextual resolutions)
    const ctxData = { tenantId: "rdm-tenant", scopes: ["historical", "territorial"] };
    cache.setRingB("ctx-hash-1", ctxData, 5000);
    expect(cache.getRingB("ctx-hash-1")).toEqual(ctxData);

    // Ring C (Inference results)
    cache.setRingC("inf-hash-1", { response: "Isabella turbo ready" }, 5000);
    expect(cache.getRingC("inf-hash-1")).toEqual({ response: "Isabella turbo ready" });
  });

  it("HexagonalPipeline.executeTurbo executes with concurrent policy & context ports and non-blocking evidence", async () => {
    const pipeline = new HexagonalPipeline("A");

    const execution = await pipeline.executeTurbo(
      async () => {
        return { message: "Turbo execution success", value: 42 };
      },
      {
        tenantId: "test-tenant",
        userId: "test-user",
        input: "turbo speed test",
      },
    );

    expect(execution.result.message).toBe("Turbo execution success");
    expect(execution.result.value).toBe(42);
    expect(execution.turboSavingsMs).toBeGreaterThan(0);
    expect(pipeline.getTurboExecutions()).toBe(1);
    expect(pipeline.getParallelSavings()).toBeGreaterThan(0);

    const metrics = execution.metrics;
    expect(metrics.portBreakdown.Ingest).toBeDefined();
    expect(metrics.portBreakdown.Policy).toBeDefined();
    expect(metrics.portBreakdown.Context).toBeDefined();
    expect(metrics.portBreakdown.Inference).toBeDefined();
    expect(metrics.portBreakdown.Evidence).toBeDefined();
    expect(metrics.portBreakdown.Delivery).toBeDefined();
  });

  it("DoublePipelineRouter routes via executeTurbo when turboMode is active and benchmarks speedup", async () => {
    expect(router.isTurboMode()).toBe(true);

    const snap = await router.runSuperTurboBenchmark(4);
    expect(snap.turboModeEnabled).toBe(true);
    // Speedup MEDIDO: sin serie regular comparable se declara 1.0; nunca se
    // devuelve un 3.42 fijo (auditoría P0-10).
    expect(snap.turboSpeedupFactor).toBeGreaterThanOrEqual(1.0);
    expect(snap.healthA).toBeGreaterThanOrEqual(0);
    expect(snap.healthA).toBeLessThanOrEqual(1);
    expect(snap.parallelSavingsMs).toBeGreaterThan(0);

    // Route a task through the router
    const result = await router.route(
      async () => "Hello from accelerated Isabella",
      { A: 0.99, B: 0.98, latencyA: 1.2, latencyB: 1.5 },
      { tenantId: "rdm-hub", userId: "anubis", input: "verify speed" },
    );

    expect(result.result).toBe("Hello from accelerated Isabella");
  });

  it("Allows toggling turbo mode on and off", () => {
    router.setTurboMode(false);
    expect(router.isTurboMode()).toBe(false);
    expect(router.getSnapshot().turboSpeedupFactor).toBe(1.0);

    router.setTurboMode(true);
    expect(router.isTurboMode()).toBe(true);
    // Sin ejecuciones regulares y turbo comparables no hay speedup medible.
    expect(router.getSnapshot().turboSpeedupFactor).toBe(1.0);
  });

  it("mide el speedup a partir de ejecuciones reales, no de una constante", async () => {
    const pipeline = new HexagonalPipeline("A");
    expect(pipeline.getTurboSpeedupFactor()).toBe(1.0); // sin datos

    await pipeline.execute(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "regular";
    });
    expect(pipeline.getTurboSpeedupFactor()).toBe(1.0); // falta la serie turbo

    await pipeline.executeTurbo(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "turbo";
    });
    const factor = pipeline.getTurboSpeedupFactor();
    expect(Number.isFinite(factor)).toBe(true);
    expect(factor).toBeGreaterThan(0);
  });

  it("la salud refleja éxitos y fallos reales (sin valores declarados)", async () => {
    const pipeline = new HexagonalPipeline("B");
    expect(pipeline.getHealth()).toBe(0); // sin ejecuciones: sin datos

    await pipeline.execute(async () => "ok");
    expect(pipeline.getHealth()).toBe(1);

    await expect(
      pipeline.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(pipeline.getHealth()).toBe(0.5);
  });
});
