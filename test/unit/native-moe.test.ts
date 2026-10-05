import { beforeAll, describe, expect, it } from "vitest";

import {
  MoeNativeModel,
  createMoeNative,
  type MoeNativeDataset,
  type MoeTrainingResult,
} from "@/lib/native-ml/moe-native";
import { createMoERoute, type MoeExpertArtifact } from "@/lib/native-ml/moe-engine";

/** Deterministic PRNG for the synthetic benchmark (no Math.random anywhere). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(random: () => number): number {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const CENTROIDS = [
  [-3, 0, 0],
  [0, -3, 0],
  [0, 0, -3],
];

/** Three domains, three incompatible linear targets, compact disjoint clusters. */
function targetForDomain(domain: number, x: number[]): number {
  if (domain === 0) return 2 * x[0] + 1;
  if (domain === 1) return -3 * x[1] + 0.5;
  return 0.5 * x[0] + 4 * x[2] - 2;
}

function sampleDomain(random: () => number, domain: number): number[] {
  return CENTROIDS[domain].map((center) => center + gauss(random) * 0.35);
}

function regressionDataset(seed: number, perDomain = 80): MoeNativeDataset {
  const random = mulberry32(seed);
  const features: number[][] = [];
  const labels: number[] = [];
  const domainLabels: number[] = [];
  for (let domain = 0; domain < 3; domain++) {
    for (let i = 0; i < perDomain; i++) {
      const x = sampleDomain(random, domain);
      features.push(x);
      labels.push(targetForDomain(domain, x) + gauss(random) * 0.05);
      domainLabels.push(domain);
    }
  }
  return { features, labels, domainLabels };
}

/** Domain-specific decision rules: no single global threshold can solve all three. */
function classificationDataset(seed: number, perDomain = 80): MoeNativeDataset {
  const random = mulberry32(seed);
  const features: number[][] = [];
  const labels: number[] = [];
  const domainLabels: number[] = [];
  for (let domain = 0; domain < 3; domain++) {
    for (let i = 0; i < perDomain; i++) {
      const x = sampleDomain(random, domain);
      features.push(x);
      labels.push(x[domain] > CENTROIDS[domain][domain] ? 1 : 0);
      domainLabels.push(domain);
    }
  }
  return { features, labels, domainLabels };
}

function dominantExpertsPerDomain(result: MoeTrainingResult): number[] {
  return (result.domainLoadFractions ?? []).map((row) => row.indexOf(Math.max(...row)));
}

function domainDominantFractions(result: MoeTrainingResult): number[] {
  return (result.domainLoadFractions ?? []).map((row) => {
    const total = row.reduce((sum, value) => sum + value, 0);
    return Math.max(...row) / total;
  });
}

const TRAIN_OPTIONS = { ownerId: "test-owner", territoryId: "test-territory" } as const;

describe("native MoE engine (moe-native)", () => {
  let regressionModel: MoeNativeModel;
  let regressionResult: MoeTrainingResult;
  let classificationModel: MoeNativeModel;
  let classificationResult: MoeTrainingResult;

  beforeAll(async () => {
    regressionModel = createMoeNative({
      inputDim: 3,
      expertCount: 3,
      topK: 2,
      mode: "regression",
      seed: 11,
    });
    regressionResult = await regressionModel.train(regressionDataset(7), TRAIN_OPTIONS);
    classificationModel = createMoeNative({
      inputDim: 3,
      expertCount: 3,
      topK: 2,
      mode: "classification",
      seed: 11,
      learningRate: 0.05,
      epochs: 250,
    });
    classificationResult = await classificationModel.train(classificationDataset(9), TRAIN_OPTIONS);
  });

  it("reduces task loss clearly during joint SGD training", () => {
    const initial = regressionResult.metrics.initialLoss;
    const final = regressionResult.metrics.finalLoss;
    expect(regressionResult.lossHistory).toHaveLength(regressionResult.metrics.epochs + 1);
    expect(Number.isFinite(initial)).toBe(true);
    expect(Number.isFinite(final)).toBe(true);
    expect(final).toBeLessThan(initial * 0.05);
    for (const value of regressionResult.lossHistory) expect(Number.isFinite(value)).toBe(true);
    for (const value of regressionResult.auxLossHistory) expect(Number.isFinite(value)).toBe(true);
    // L_aux = E · Σ f_e · P_e is bounded above by E because both are probability vectors.
    expect(regressionResult.auxLossHistory.at(-1)).toBeGreaterThan(0);
    expect(regressionResult.auxLossHistory.at(-1)).toBeLessThanOrEqual(
      regressionResult.metrics.expertCount,
    );
  });

  it("specializes one distinct expert per domain", () => {
    const dominant = dominantExpertsPerDomain(regressionResult);
    const fractions = domainDominantFractions(regressionResult);
    expect(regressionResult.domainLoadFractions).not.toBeNull();
    expect(dominant).toHaveLength(3);
    for (const fraction of fractions) expect(fraction).toBeGreaterThanOrEqual(0.6);
    expect(new Set(dominant).size).toBe(3);
    expect(regressionResult.metrics.routingAccuracy).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps every expert load usable and bounded", () => {
    const loads = regressionResult.loadFractions;
    expect(loads).toHaveLength(3);
    for (const load of loads) expect(load).toBeGreaterThanOrEqual(0.05);
    expect(Math.max(...loads)).toBeLessThanOrEqual(0.6);
    expect(loads.reduce((sum, load) => sum + load, 0)).toBeCloseTo(1, 10);
  });

  it("selects exactly topK experts with gate weights renormalized to 1", () => {
    const x = regressionDataset(7).features[0];
    const decision = regressionModel.route(x);
    expect(decision.logits).toHaveLength(3);
    expect(decision.probabilities).toHaveLength(3);
    expect(decision.selectedExperts).toHaveLength(regressionModel.hyper.topK);
    expect(decision.probabilities.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 10);
    const gateSum = decision.selectedExperts.reduce((sum, entry) => sum + entry.gateWeight, 0);
    expect(gateSum).toBeCloseTo(1, 10);
    const indices = decision.selectedExperts.map((entry) => entry.expertIndex);
    expect(new Set(indices).size).toBe(indices.length);
    const prediction = regressionModel.predict(x);
    expect(prediction.selectedExperts).toHaveLength(regressionModel.hyper.topK);
    expect(prediction.gateWeights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 10);
    expect(Number.isFinite(prediction.value)).toBe(true);
  });

  it("feeds its learned logits into the existing createMoERoute gate", () => {
    const artifacts: MoeExpertArtifact[] = [0, 1, 2].map((index) => ({
      expertId: `expert-${index}`,
      version: "1.0.0",
      modelHash: `hash-${index}`,
      datasetId: "synthetic-multi-domain",
      datasetVersion: "1",
      license: "MIT",
      capacity: 8,
      execute: (input: number[]) => input,
    }));
    const gate = createMoERoute(artifacts, { topK: 2 });
    const x = regressionDataset(7).features[1];
    const decisions = gate.route(x, regressionModel.gate(x).logits);
    expect(decisions).toHaveLength(2);
    expect(decisions.map((entry) => entry.expertId)).toEqual([
      ...decisions
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .map((entry) => entry.expertId),
    ]);
  });

  it("overflows expert capacity into the explicit fallback without breaking inference", () => {
    const dataset = classificationDataset(9, 40);
    const repeated = Array.from({ length: 90 }, () => dataset.features[0]);
    const overflowing = regressionModel.predictBatch(repeated, { capacityFactor: 0.1 });
    expect(overflowing.overflow).toBe(true);
    expect(overflowing.fallbackUsed).toBe(true);
    expect(overflowing.outputs).toHaveLength(90);
    expect(overflowing.assignments.every((row) => row.length >= 1)).toBe(true);
    for (const value of overflowing.outputs) expect(Number.isFinite(value)).toBe(true);

    const roomy = regressionModel.predictBatch(repeated, { capacityFactor: 100 });
    expect(roomy.overflow).toBe(false);
    expect(roomy.fallbackUsed).toBe(false);
    expect(roomy.outputs).toHaveLength(90);
  });

  it("is reproducible: same seed → same weights and artifactHash, different seed → different", async () => {
    const dataset = regressionDataset(7, 24);
    const first = createMoeNative({
      inputDim: 3,
      expertCount: 3,
      topK: 2,
      mode: "regression",
      seed: 42,
      epochs: 20,
    });
    const second = createMoeNative({
      inputDim: 3,
      expertCount: 3,
      topK: 2,
      mode: "regression",
      seed: 42,
      epochs: 20,
    });
    const third = createMoeNative({
      inputDim: 3,
      expertCount: 3,
      topK: 2,
      mode: "regression",
      seed: 43,
      epochs: 20,
    });
    const firstResult = await first.train(dataset, TRAIN_OPTIONS);
    const secondResult = await second.train(dataset, TRAIN_OPTIONS);
    const thirdResult = await third.train(dataset, TRAIN_OPTIONS);
    expect(firstResult.artifactHash).toBe(secondResult.artifactHash);
    expect(firstResult.trainingHash).toBe(secondResult.trainingHash);
    expect(firstResult.artifact.routerWeights).toEqual(secondResult.artifact.routerWeights);
    expect(firstResult.artifact.expertWeights).toEqual(secondResult.artifact.expertWeights);
    expect(firstResult.artifactHash).not.toBe(thirdResult.artifactHash);
    expect(firstResult.trainingHash).not.toBe(thirdResult.trainingHash);
    expect(firstResult.artifact.routerWeights).not.toEqual(thirdResult.artifact.routerWeights);
    expect(firstResult.artifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(firstResult.trainingHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("trains in classification mode and beats the majority-class baseline", () => {
    const accuracy = classificationResult.metrics.accuracy!;
    const baseline = classificationResult.metrics.baselineAccuracy!;
    expect(accuracy).toBeGreaterThan(baseline + 0.15);
    expect(accuracy).toBeGreaterThanOrEqual(0.7);
    expect(classificationResult.metrics.finalLoss).toBeLessThan(
      classificationResult.metrics.initialLoss * 0.8,
    );
    const prediction = classificationModel.predict(classificationDataset(9).features[0]);
    expect(prediction.probability).not.toBeNull();
    expect(prediction.probability!).toBeGreaterThanOrEqual(0);
    expect(prediction.probability!).toBeLessThanOrEqual(1);
    expect(prediction.value).toBeCloseTo(prediction.probability!, 12);
  });

  it("fails closed on invalid configuration, data and inputs", async () => {
    expect(
      () =>
        new MoeNativeModel({
          inputDim: 3,
          expertCount: 1,
          topK: 1,
          mode: "regression",
          seed: 1,
        }),
    ).toThrow("moe_expert_count_invalid");
    expect(
      () =>
        new MoeNativeModel({
          inputDim: 3,
          expertCount: 3,
          topK: 0,
          mode: "regression",
          seed: 1,
        }),
    ).toThrow("moe_topk_invalid");
    expect(
      () =>
        new MoeNativeModel({
          inputDim: 3,
          expertCount: 3,
          topK: 4,
          mode: "regression",
          seed: 1,
        }),
    ).toThrow("moe_topk_invalid");
    expect(
      () =>
        new MoeNativeModel({
          inputDim: 0,
          expertCount: 3,
          topK: 1,
          mode: "regression",
          seed: 1,
        }),
    ).toThrow("moe_input_dim_invalid");
    expect(
      () =>
        new MoeNativeModel({
          inputDim: 3,
          expertCount: 3,
          topK: 1,
          mode: "clustering" as "regression",
          seed: 1,
        }),
    ).toThrow("moe_mode_invalid");

    const model = createMoeNative({
      inputDim: 3,
      expertCount: 3,
      topK: 2,
      mode: "regression",
      seed: 1,
    });
    expect(() => model.predict([1, 2])).toThrow("moe_input_dimension_mismatch");
    expect(() => model.predict([1, 2, Number.NaN])).toThrow("moe_input_not_finite");
    expect(() => model.predict([1, 2, Number.POSITIVE_INFINITY])).toThrow("moe_input_not_finite");
    expect(() => model.predictBatch([])).toThrow("moe_batch_empty");
    expect(() => model.predictBatch([[1, 2, 3]], { capacityFactor: 0 })).toThrow(
      "moe_capacity_factor_invalid",
    );
    expect(() => model.predictBatch([[1, 2, 3]], { fallbackExpertId: 7 })).toThrow(
      "moe_fallback_expert_invalid",
    );
    await expect(
      model.train(regressionDataset(7), { ownerId: "", territoryId: "t" }),
    ).rejects.toThrow("moe_owner_required");
    await expect(
      model.train(regressionDataset(7), { ownerId: "o", territoryId: "" }),
    ).rejects.toThrow("moe_territory_required");
    await expect(
      model.train({ features: [[1, 2, 3]], labels: [1] }, { ownerId: "o", territoryId: "t" }),
    ).rejects.toThrow("moe_dataset_empty");
    await expect(
      model.train(
        {
          features: [
            [1, 2],
            [3, 4],
          ],
          labels: [1, 2],
        },
        { ownerId: "o", territoryId: "t" },
      ),
    ).rejects.toThrow("moe_feature_dimension_mismatch");
    await expect(
      model.train(
        {
          features: [
            [1, 2, 3],
            [4, 5, 6],
          ],
          labels: [1, Number.NaN],
        },
        { ownerId: "o", territoryId: "t" },
      ),
    ).rejects.toThrow("moe_label_not_finite");
    const classifier = createMoeNative({
      inputDim: 3,
      expertCount: 3,
      topK: 2,
      mode: "classification",
      seed: 1,
      epochs: 1,
    });
    await expect(
      classifier.train(
        {
          features: [
            [1, 2, 3],
            [4, 5, 6],
          ],
          labels: [0, 2],
        },
        { ownerId: "o", territoryId: "t" },
      ),
    ).rejects.toThrow("moe_label_class_invalid");
    await expect(
      model.train(
        {
          features: [
            [1, 2, 3],
            [4, 5, 6],
          ],
          labels: [1, 2],
          domainLabels: [0],
        },
        { ownerId: "o", territoryId: "t" },
      ),
    ).rejects.toThrow("moe_domain_labels_invalid");
  });

  it("returns provenance metadata consistent with the native ML contracts", () => {
    expect(regressionResult.model.modelId).toContain("native-moe-");
    expect(regressionResult.model.modelHash).toBe(regressionResult.artifactHash);
    expect(regressionResult.model.algorithm).toBe("native-moe-topk-sgd");
    expect(regressionResult.model.approvalStatus).toBe("PENDING_REVIEW");
    expect(regressionResult.approvalRequired).toBe(true);
    expect(regressionResult.provenanceId).toMatch(/^prov_[0-9a-f]{24}$/);
    expect(regressionResult.artifact.expertWeights).toHaveLength(3);
    expect(regressionResult.artifact.routerBias).toHaveLength(3);
    expect(regressionResult.domainLoadFractions).toHaveLength(3);
  });
});
