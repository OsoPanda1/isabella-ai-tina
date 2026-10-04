import { createHash } from "node:crypto";
import { EvaluationRegistry } from "../models/registry";

/**
 * Governed, deterministic evaluation harness for model candidates.
 *
 * This module deliberately does not train models, call providers, invent
 * outputs, grant production authority, or represent human approval.
 * It preserves the original public API while adding:
 * - strict input validation;
 * - deterministic canonical serialization;
 * - stable sample and dataset digests;
 * - robust token accounting;
 * - percentile latency evidence;
 * - explicit quality/bias/coverage metrics;
 * - fail-closed production evidence;
 * - immutable-style benchmark metadata;
 * - safe handling of invalid numeric values.
 */

export interface MLTrainingSample {
  inputData: string;
  expectedOutput: string;
  actualOutput?: string;
  loss?: number;
  biasPenalty?: number;
  latencyMs?: number;
}

export interface EvaluationThresholds {
  minAccuracy: number;
  minF1: number;
  maxBias: number;
  maxInvalidSamples: number;
  minMeasuredLatencyCoverage: number;
}

export interface EvaluationMetrics {
  sampleCount: number;
  evaluatedSampleCount: number;
  invalidSampleCount: number;
  accuracy: number;
  f1Score: number;
  biasScore: number;
  averageLoss: number;
  latencyMs: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  latencyCoverage: number;
  datasetDigest: string;
  benchmarkId: string;
}

export interface EvaluationResult extends EvaluationMetrics {
  passed: boolean;
  gateReasons: string[];
  evidenceStatus: "EVALUATED_PENDING_APPROVAL";
  approvedBy: "";
  evaluatedAt: string;
}

const DEFAULT_THRESHOLDS: EvaluationThresholds = {
  minAccuracy: 0.85,
  minF1: 0.85,
  maxBias: 0.1,
  maxInvalidSamples: 0,
  minMeasuredLatencyCoverage: 0,
};

const MAX_TEXT_LENGTH = 1_000_000;

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid_${field}`);
  }
}

function normalize(text: string): string[] {
  if (typeof text !== "string") throw new Error("evaluation_text_must_be_string");

  return text.normalize("NFKC").toLocaleLowerCase("und").trim().split(/\s+/u).filter(Boolean);
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFKC"));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_number_in_evaluation");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    // JSON.stringify convierte `undefined` dentro de un arreglo en `null`.
    return `[${value.map((item) => canonicalize(item === undefined ? null : item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
  }
  throw new Error("unsupported_value_in_evaluation");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function validateSample(sample: MLTrainingSample): void {
  if (!sample || typeof sample !== "object") throw new Error("invalid_evaluation_sample");
  if (typeof sample.inputData !== "string" || sample.inputData.length > MAX_TEXT_LENGTH) {
    throw new Error("invalid_sample_input_data");
  }
  if (typeof sample.expectedOutput !== "string" || sample.expectedOutput.length > MAX_TEXT_LENGTH) {
    throw new Error("invalid_sample_expected_output");
  }
  if (sample.actualOutput !== undefined && typeof sample.actualOutput !== "string") {
    throw new Error("invalid_sample_actual_output");
  }
  if (sample.loss !== undefined) assertFiniteNonNegative(sample.loss, "loss");
  if (sample.biasPenalty !== undefined) assertFiniteNonNegative(sample.biasPenalty, "bias_penalty");
  if (sample.latencyMs !== undefined) assertFiniteNonNegative(sample.latencyMs, "latency_ms");
}

function tokenCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function tokenF1(expected: string, actual: string): number {
  const expectedTokens = normalize(expected);
  const actualTokens = normalize(actual);

  if (expectedTokens.length === 0 && actualTokens.length === 0) return 1;
  if (expectedTokens.length === 0 || actualTokens.length === 0) return 0;

  const expectedCounts = tokenCounts(expectedTokens);
  const actualCounts = tokenCounts(actualTokens);
  let overlap = 0;

  for (const [token, count] of actualCounts) {
    overlap += Math.min(count, expectedCounts.get(token) ?? 0);
  }

  const precision = overlap / actualTokens.length;
  const recall = overlap / expectedTokens.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function boundedPenalty(value: number | undefined): number {
  if (value === undefined) return 0;
  assertFiniteNonNegative(value, "penalty");
  return Math.min(1, value);
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function resolveThresholds(thresholds?: Partial<EvaluationThresholds>): EvaluationThresholds {
  const resolved = { ...DEFAULT_THRESHOLDS, ...thresholds };

  if (
    resolved.minAccuracy < 0 ||
    resolved.minAccuracy > 1 ||
    resolved.minF1 < 0 ||
    resolved.minF1 > 1 ||
    resolved.maxBias < 0 ||
    resolved.maxBias > 1 ||
    resolved.maxInvalidSamples < 0 ||
    resolved.minMeasuredLatencyCoverage < 0 ||
    resolved.minMeasuredLatencyCoverage > 1
  ) {
    throw new Error("invalid_evaluation_thresholds");
  }

  return resolved;
}

function benchmarkReasons(
  metrics: Pick<
    EvaluationMetrics,
    "accuracy" | "f1Score" | "biasScore" | "invalidSampleCount" | "latencyCoverage"
  >,
  thresholds: EvaluationThresholds,
): string[] {
  const reasons: string[] = [];
  if (metrics.accuracy < thresholds.minAccuracy) reasons.push("accuracy_below_threshold");
  if (metrics.f1Score < thresholds.minF1) reasons.push("f1_below_threshold");
  if (metrics.biasScore >= thresholds.maxBias) reasons.push("bias_at_or_above_threshold");
  if (metrics.invalidSampleCount > thresholds.maxInvalidSamples)
    reasons.push("invalid_samples_present");
  if (metrics.latencyCoverage < thresholds.minMeasuredLatencyCoverage) {
    reasons.push("latency_coverage_below_threshold");
  }
  return reasons;
}

/**
 * Deterministic evaluation only. This class never fabricates model output,
 * latency, approval, training updates, policy decisions, or bias measurements.
 */
export class AdvancedReinforcementEngine {
  public static async evaluateSample(sample: MLTrainingSample): Promise<number> {
    validateSample(sample);

    if (typeof sample.actualOutput !== "string") {
      throw new Error("evaluation_requires_actual_model_output");
    }

    const f1 = tokenF1(sample.expectedOutput, sample.actualOutput);
    const expected = normalize(sample.expectedOutput).join(" ");
    const actual = normalize(sample.actualOutput).join(" ");
    const exactMatch = expected === actual;
    const baseLoss = exactMatch ? 0 : 1 - f1;
    const biasPenalty = boundedPenalty(sample.biasPenalty);

    return Math.min(1, Math.max(0, baseLoss + biasPenalty));
  }

  public static async evaluateDataset(
    samples: MLTrainingSample[],
    thresholds?: Partial<EvaluationThresholds>,
  ): Promise<EvaluationMetrics> {
    if (!Array.isArray(samples) || samples.length === 0) {
      throw new Error("evaluation_requires_non_empty_dataset");
    }

    const resolvedThresholds = resolveThresholds(thresholds);
    const evaluated = samples.map((sample) => {
      validateSample(sample);
      return sample;
    });

    const actualSamples = evaluated.filter(
      (sample): sample is MLTrainingSample & { actualOutput: string } =>
        typeof sample.actualOutput === "string",
    );

    const invalidSampleCount = evaluated.length - actualSamples.length;
    if (invalidSampleCount > resolvedThresholds.maxInvalidSamples) {
      throw new Error("evaluation_requires_actual_model_output");
    }

    let totalLoss = 0;
    let totalF1 = 0;
    let maxBias = 0;
    const latencies: number[] = [];

    for (const sample of actualSamples) {
      const loss = await this.evaluateSample(sample);
      totalLoss += loss;
      totalF1 += tokenF1(sample.expectedOutput, sample.actualOutput);
      maxBias = Math.max(maxBias, boundedPenalty(sample.biasPenalty));
      if (sample.latencyMs !== undefined) latencies.push(sample.latencyMs);
    }

    const evaluatedSampleCount = actualSamples.length;
    const avgLoss = evaluatedSampleCount > 0 ? totalLoss / evaluatedSampleCount : 1;
    const accuracy = Math.max(0, Math.min(1, 1 - avgLoss));
    const f1Score = evaluatedSampleCount > 0 ? totalF1 / evaluatedSampleCount : 0;
    const latencyCoverage = latencies.length / evaluated.length;
    const latencyMs = latencies.length
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : 0;

    const datasetDigest = digest(
      evaluated.map((sample) => ({
        inputData: sample.inputData,
        expectedOutput: sample.expectedOutput,
        actualOutput: sample.actualOutput,
        loss: sample.loss,
        biasPenalty: sample.biasPenalty,
        latencyMs: sample.latencyMs,
      })),
    );

    const benchmarkId = digest({
      datasetDigest,
      thresholds: resolvedThresholds,
    }).slice(0, 16);

    return {
      sampleCount: evaluated.length,
      evaluatedSampleCount,
      invalidSampleCount,
      accuracy,
      f1Score,
      biasScore: maxBias,
      averageLoss: avgLoss,
      latencyMs,
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
      latencyP99Ms: percentile(latencies, 0.99),
      latencyCoverage,
      datasetDigest,
      benchmarkId,
    };
  }

  // Legacy overload: mantiene compatibilidad con código que esperaba void
  public static async executeReinforcementCycle(
    modelId: string,
    version: string,
    samples: MLTrainingSample[],
    thresholds?: Partial<EvaluationThresholds>,
  ): Promise<EvaluationResult | void> {
    if (!modelId.trim()) throw new Error("evaluation_requires_model_id");
    if (!version.trim()) throw new Error("evaluation_requires_model_version");

    const resolvedThresholds = resolveThresholds(thresholds);
    const metrics = await this.evaluateDataset(samples, resolvedThresholds);
    const gateReasons = benchmarkReasons(metrics, resolvedThresholds);
    const passed = gateReasons.length === 0;
    const evaluatedAt = new Date().toISOString();

    const result: EvaluationResult = {
      ...metrics,
      passed,
      gateReasons,
      evidenceStatus: "EVALUATED_PENDING_APPROVAL",
      // Evaluation evidence is not human approval. Keep this empty so the
      // production gate remains fail-closed until an authorized approver acts.
      approvedBy: "",
      evaluatedAt,
    };

    EvaluationRegistry.addBenchmark(modelId, version, {
      benchmarkId: metrics.benchmarkId,
      modelId,
      version,
      passed,
      accuracy: metrics.accuracy,
      f1Score: metrics.f1Score,
      biasScore: metrics.biasScore,
      latencyMs: metrics.latencyMs,
      approvedBy: "",
      evaluatedAt,
    });

    return result;
  }
}
