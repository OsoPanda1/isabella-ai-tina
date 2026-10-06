import { describe, expect, it } from "vitest";
import { NativeMLEngine, robustMedianAggregate } from "@/lib/cognitive/native-engine";

describe("NativeMLEngine", () => {
  it("trains deterministic binary classifier", () => {
    const engine = new NativeMLEngine();
    const model = engine.trainClassification([[0], [1], [2], [3]], [0, 0, 1, 1], {
      epochs: 400,
      learningRate: 0.2,
    });
    expect(engine.predict(model, [[0], [3]])).toEqual([0, 1]);
    expect(model.artifactHash).toHaveLength(64);
  });

  it("detects distribution drift", () => {
    const engine = new NativeMLEngine();
    const result = engine.drift([[0], [0.1], [0.2], [0.3]], [[5], [6], [7], [8]]);
    expect(result.psi).toBeGreaterThan(0.2);
  });

  it("supports robust median aggregation", () => {
    expect(
      robustMedianAggregate([
        [1, 2],
        [2, 3],
        [100, 4],
      ]),
    ).toEqual([2, 3]);
  });
});
