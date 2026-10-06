import { describe, expect, it } from "vitest";
import { AdvancedReinforcementEngine } from "./reinforcement";

describe("AdvancedReinforcementEngine", () => {
  it("evaluates actual model outputs deterministically with percentile latency evidence", async () => {
    const metrics = await AdvancedReinforcementEngine.evaluateDataset([
      {
        inputData: "uno",
        expectedOutput: "respuesta uno",
        actualOutput: "respuesta uno",
        latencyMs: 10,
      },
      {
        inputData: "dos",
        expectedOutput: "respuesta dos",
        actualOutput: "respuesta dos",
        latencyMs: 30,
      },
      {
        inputData: "tres",
        expectedOutput: "respuesta tres",
        actualOutput: "respuesta diferente",
        latencyMs: 50,
      },
    ]);

    expect(metrics.sampleCount).toBe(3);
    expect(metrics.evaluatedSampleCount).toBe(3);
    expect(metrics.invalidSampleCount).toBe(0);
    expect(metrics.datasetDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(metrics.benchmarkId).toMatch(/^[0-9a-f]{16}$/);
    expect(metrics.latencyP50Ms).toBe(30);
    expect(metrics.latencyP95Ms).toBeGreaterThanOrEqual(30);
    expect(metrics.latencyP99Ms).toBeGreaterThanOrEqual(metrics.latencyP95Ms);
    expect(metrics.f1Score).toBeGreaterThan(0);
    expect(metrics.accuracy).toBeGreaterThan(0);
  });

  it("fails closed when actual model output is absent", async () => {
    await expect(
      AdvancedReinforcementEngine.evaluateSample({
        inputData: "input",
        expectedOutput: "expected",
      }),
    ).rejects.toThrow("evaluation_requires_actual_model_output");
  });
});
