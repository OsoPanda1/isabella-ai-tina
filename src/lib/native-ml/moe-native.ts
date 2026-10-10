/**
 * Native Mixture-of-Experts (MoE) engine — pure TypeScript, seeded, trainable.
 *
 * Architecture:
 * - E linear experts: z_e(x) = w_e · x + b_e (one scalar output per expert).
 * - Learned router: logits = W_router · x + b_router (E logits) → softmax → top-K
 *   selection with gate weights renormalized over the selected set:
 *   g_e = p_e / Σ_{j in topK} p_j, so Σ g_e = 1.
 * - Training: joint SGD over router + the experts selected by the current gate.
 *
 * Losses:
 * - Task: regression → MSE, classification → BCE with sigmoid on the gated logit.
 * - Load balancing (Switch Transformer style): L_aux = E · Σ_e f_e · P_e where
 *   f_e = fraction of batch tokens whose hard (top-1) assignment is expert e and
 *   P_e = mean router probability of expert e over the batch.
 *
 * Hand-derived gradients (documented honestly, this is what the code applies):
 * Let s = Σ_{e in topK} g_e z_e. With MSE, ds = 2(ŝ − y); with BCE on σ(s), ds = σ(s) − y.
 * Because g_e = p_e / S (S = Σ_{topK} p_j), ∂s/∂p_j = (z_j − s)/S for j in topK and 0
 * otherwise (the discrete top-K set is treated as fixed — a piecewise-constant mask).
 * Softmax backprop: ∂L/∂logit_e = p_e · (∂L/∂p_e − Σ_k ∂L/∂p_k · p_k).
 * Expert backprop: ∂L/∂w_e = (∂L/∂s) · g_e · x, ∂L/∂b_e = (∂L/∂s) · g_e.
 * Auxiliary loss: f_e is a hard count, hence piecewise constant, so (as in the Switch
 * Transformer paper) the gradient flows only through P_e:
 * ∂L_aux/∂logit_e = E · P_e · (f_e − Σ_k f_k · P_k).
 */
import { createHash } from "node:crypto";
import type { ModelIdentity, NativeMLHooks } from "./types";

export type MoeNativeMode = "regression" | "classification";

export interface MoeNativeConfig {
  inputDim: number;
  expertCount: number;
  topK: number;
  mode: MoeNativeMode;
  seed: number;
  learningRate?: number;
  auxLossCoefficient?: number;
  capacityFactor?: number;
  epochs?: number;
  batchSize?: number;
}

export interface MoeNativeHyperParams {
  readonly inputDim: number;
  readonly expertCount: number;
  readonly topK: number;
  readonly mode: MoeNativeMode;
  readonly seed: number;
  readonly learningRate: number;
  readonly auxLossCoefficient: number;
  readonly capacityFactor: number;
  readonly epochs: number;
  readonly batchSize: number;
}

export interface MoeNativeDataset {
  features: number[][];
  labels: number[];
  domainLabels?: number[];
}

export interface MoeGateOutput {
  logits: number[];
  probabilities: number[];
}

export interface MoeSelectedExpert {
  expertIndex: number;
  logit: number;
  probability: number;
  gateWeight: number;
}

export interface MoeRouteDecision {
  logits: number[];
  probabilities: number[];
  selectedExperts: MoeSelectedExpert[];
}

export interface MoePrediction {
  value: number;
  probability: number | null;
  selectedExperts: number[];
  gateWeights: number[];
  overflow: boolean;
  fallbackUsed: boolean;
}

export interface MoeBatchOptions {
  capacityFactor?: number;
  fallbackExpertId?: number;
}

export interface MoeBatchPrediction {
  outputs: number[];
  probabilities: number[] | null;
  assignments: number[][];
  overflow: boolean;
  fallbackUsed: boolean;
}

export interface MoeModelArtifact {
  routerWeights: number[][];
  routerBias: number[];
  expertWeights: number[][];
  expertBias: number[];
  artifactHash: string;
}

export interface MoeTrainOptions {
  ownerId: string;
  territoryId: string;
  hooks?: NativeMLHooks;
}

export interface MoeTrainingResult {
  model: ModelIdentity;
  artifact: MoeModelArtifact;
  artifactHash: string;
  trainingHash: string;
  provenanceId: string;
  approvalRequired: boolean;
  lossHistory: number[];
  auxLossHistory: number[];
  loadFractions: number[];
  domainLoadFractions: number[][] | null;
  metrics: Record<string, number>;
}

interface MoeBatchEvaluation {
  taskLoss: number;
  auxLoss: number;
}

interface MoeDatasetAnalysis extends MoeBatchEvaluation {
  loads: number[];
  domainLoads: number[][] | null;
  routingAccuracy: number | null;
  accuracy: number | null;
  baselineAccuracy: number | null;
  rmse: number | null;
}

// Defaults tuned so the balancing term stays material relative to the task loss
// (measured on the synthetic multi-domain benchmark used by the unit tests).
const DEFAULT_LEARNING_RATE = 0.03;
const DEFAULT_AUX_COEFFICIENT = 0.05;
const DEFAULT_CAPACITY_FACTOR = 1;
const DEFAULT_EPOCHS = 120;
const DEFAULT_BATCH_SIZE = 16;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Deterministic 32-bit PRNG (mulberry32). Seeded only — never Math.random. */
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

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, x))));
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  return exps.map((value) => value / sum);
}

function bceLoss(target: number, probability: number): number {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, probability));
  return -(target * Math.log(p) + (1 - target) * Math.log(1 - p));
}

function selectTopK(probabilities: number[], topK: number): number[] {
  return probabilities
    .map((probability, index) => ({ probability, index }))
    .sort((a, b) => b.probability - a.probability || a.index - b.index)
    .slice(0, topK)
    .map((entry) => entry.index);
}

function zeros(rows: number, columns: number): number[][] {
  return Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
}

function requireFinite(value: number, code: string): void {
  if (!Number.isFinite(value)) throw new Error(code);
}

function validateHyperParams(config: MoeNativeConfig): MoeNativeHyperParams {
  if (!Number.isInteger(config.inputDim) || config.inputDim < 1) {
    throw new Error("moe_input_dim_invalid");
  }
  if (!Number.isInteger(config.expertCount) || config.expertCount < 2) {
    throw new Error("moe_expert_count_invalid");
  }
  if (!Number.isInteger(config.topK) || config.topK < 1 || config.topK > config.expertCount) {
    throw new Error("moe_topk_invalid");
  }
  if (config.mode !== "regression" && config.mode !== "classification") {
    throw new Error("moe_mode_invalid");
  }
  if (!Number.isInteger(config.seed)) throw new Error("moe_seed_invalid");
  const learningRate = config.learningRate ?? DEFAULT_LEARNING_RATE;
  const auxLossCoefficient = config.auxLossCoefficient ?? DEFAULT_AUX_COEFFICIENT;
  const capacityFactor = config.capacityFactor ?? DEFAULT_CAPACITY_FACTOR;
  const epochs = config.epochs ?? DEFAULT_EPOCHS;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!(learningRate > 0) || !Number.isFinite(learningRate)) {
    throw new Error("moe_learning_rate_invalid");
  }
  if (!(auxLossCoefficient >= 0) || !Number.isFinite(auxLossCoefficient)) {
    throw new Error("moe_aux_coefficient_invalid");
  }
  if (!(capacityFactor > 0) || !Number.isFinite(capacityFactor)) {
    throw new Error("moe_capacity_factor_invalid");
  }
  if (!Number.isInteger(epochs) || epochs < 1) throw new Error("moe_epochs_invalid");
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("moe_batch_size_invalid");
  return {
    inputDim: config.inputDim,
    expertCount: config.expertCount,
    topK: config.topK,
    mode: config.mode,
    seed: config.seed,
    learningRate,
    auxLossCoefficient,
    capacityFactor,
    epochs,
    batchSize,
  };
}

function validateVector(vector: number[], expectedLength: number, code: string): void {
  if (vector.length !== expectedLength) throw new Error(code);
  for (const value of vector) requireFinite(value, "moe_input_not_finite");
}

function validateDataset(
  dataset: MoeNativeDataset,
  hyper: MoeNativeHyperParams,
): { domainLabels: number[] | null; domainCount: number } {
  const { features, labels, domainLabels } = dataset;
  if (!Array.isArray(features) || features.length < 2) throw new Error("moe_dataset_empty");
  if (labels.length !== features.length) throw new Error("moe_dataset_cardinality_mismatch");
  for (const row of features) validateVector(row, hyper.inputDim, "moe_feature_dimension_mismatch");
  for (const label of labels) {
    requireFinite(label, "moe_label_not_finite");
    if (hyper.mode === "classification" && label !== 0 && label !== 1) {
      throw new Error("moe_label_class_invalid");
    }
  }
  if (!domainLabels) return { domainLabels: null, domainCount: 0 };
  if (domainLabels.length !== features.length) throw new Error("moe_domain_labels_invalid");
  let domainCount = 0;
  for (const domain of domainLabels) {
    if (!Number.isInteger(domain) || domain < 0) throw new Error("moe_domain_labels_invalid");
    if (domain + 1 > domainCount) domainCount = domain + 1;
  }
  return { domainLabels, domainCount };
}

export class MoeNativeModel {
  readonly hyper: MoeNativeHyperParams;
  private readonly routerW: number[][];
  private readonly routerB: number[];
  private readonly expertW: number[][];
  private readonly expertB: number[];

  constructor(config: MoeNativeConfig) {
    this.hyper = validateHyperParams(config);
    const { inputDim, expertCount, seed } = this.hyper;
    const random = mulberry32(seed);
    const scale = 1 / Math.sqrt(inputDim);
    this.routerW = Array.from({ length: expertCount }, () =>
      Array.from({ length: inputDim }, () => (random() * 2 - 1) * scale),
    );
    this.routerB = Array.from({ length: expertCount }, () => (random() * 2 - 1) * scale);
    this.expertW = Array.from({ length: expertCount }, () =>
      Array.from({ length: inputDim }, () => (random() * 2 - 1) * 0.1),
    );
    this.expertB = Array.from({ length: expertCount }, () => (random() * 2 - 1) * 0.1);
  }

  private validateInput(vector: number[]): void {
    validateVector(vector, this.hyper.inputDim, "moe_input_dimension_mismatch");
  }

  private expertValue(expertIndex: number, vector: number[]): number {
    const weights = this.expertW[expertIndex];
    const bias = this.expertB[expertIndex];
    let sum = bias;
    for (let j = 0; j < vector.length; j++) sum += weights[j] * vector[j];
    return sum;
  }

  gate(vector: number[]): MoeGateOutput {
    this.validateInput(vector);
    const logits = this.routerW.map(
      (weights, expertIndex) =>
        this.routerB[expertIndex] + weights.reduce((sum, weight, j) => sum + weight * vector[j], 0),
    );
    return { logits, probabilities: softmax(logits) };
  }

  route(vector: number[]): MoeRouteDecision {
    const { logits, probabilities } = this.gate(vector);
    const selected = selectTopK(probabilities, this.hyper.topK);
    const mass = selected.reduce((sum, expertIndex) => sum + probabilities[expertIndex], 0);
    const selectedExperts = selected.map((expertIndex) => ({
      expertIndex,
      logit: logits[expertIndex],
      probability: probabilities[expertIndex],
      gateWeight: probabilities[expertIndex] / mass,
    }));
    return { logits, probabilities, selectedExperts };
  }

  private forwardToken(
    vector: number[],
    hasCapacity: (expertIndex: number) => boolean,
    fallbackExpertId: number,
  ): {
    value: number;
    probability: number | null;
    selected: number[];
    gateWeights: number[];
    overflow: boolean;
    fallbackUsed: boolean;
  } {
    const { probabilities } = this.gate(vector);
    const selected = selectTopK(probabilities, this.hyper.topK);
    let available = selected.filter(hasCapacity);
    let overflow = false;
    let fallbackUsed = false;
    if (available.length === 0) {
      overflow = true;
      fallbackUsed = true;
      available = [fallbackExpertId];
    } else if (available.length < selected.length) {
      overflow = true;
    }
    const acceptedMass = available.reduce(
      (sum, expertIndex) => sum + probabilities[expertIndex],
      0,
    );
    const normalizer = fallbackUsed ? 1 : acceptedMass;
    let combined = 0;
    const gateWeights: number[] = [];
    for (const expertIndex of available) {
      const weight = fallbackUsed ? 1 : probabilities[expertIndex] / normalizer;
      gateWeights.push(weight);
      combined += weight * this.expertValue(expertIndex, vector);
    }
    const probability = this.hyper.mode === "classification" ? sigmoid(combined) : null;
    return {
      value: probability === null ? combined : probability,
      probability,
      selected: available,
      gateWeights,
      overflow,
      fallbackUsed,
    };
  }

  predict(vector: number[]): MoePrediction {
    this.validateInput(vector);
    const result = this.forwardToken(vector, () => true, 0);
    return {
      value: result.value,
      probability: result.probability,
      selectedExperts: result.selected,
      gateWeights: result.gateWeights,
      overflow: result.overflow,
      fallbackUsed: result.fallbackUsed,
    };
  }

  predictBatch(inputs: number[][], options: MoeBatchOptions = {}): MoeBatchPrediction {
    if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("moe_batch_empty");
    const capacityFactor = options.capacityFactor ?? this.hyper.capacityFactor;
    if (!(capacityFactor > 0) || !Number.isFinite(capacityFactor)) {
      throw new Error("moe_capacity_factor_invalid");
    }
    const fallbackExpertId = options.fallbackExpertId ?? 0;
    if (
      !Number.isInteger(fallbackExpertId) ||
      fallbackExpertId < 0 ||
      fallbackExpertId >= this.hyper.expertCount
    ) {
      throw new Error("moe_fallback_expert_invalid");
    }
    const capacity = Math.max(
      1,
      Math.floor((capacityFactor * inputs.length) / this.hyper.expertCount),
    );
    const used = new Array<number>(this.hyper.expertCount).fill(0);
    const outputs: number[] = [];
    const probabilities: number[] = [];
    const assignments: number[][] = [];
    let overflow = false;
    let fallbackUsed = false;
    for (const input of inputs) {
      this.validateInput(input);
      const result = this.forwardToken(
        input,
        (expertIndex) => used[expertIndex] < capacity,
        fallbackExpertId,
      );
      if (result.fallbackUsed) fallbackUsed = true;
      if (result.overflow) overflow = true;
      if (!result.fallbackUsed) {
        for (const expertIndex of result.selected) used[expertIndex] += 1;
      }
      outputs.push(result.value);
      if (result.probability !== null) probabilities.push(result.probability);
      assignments.push(result.selected);
    }
    return {
      outputs,
      probabilities: this.hyper.mode === "classification" ? probabilities : null,
      assignments,
      overflow,
      fallbackUsed,
    };
  }

  getArtifact(): MoeModelArtifact {
    return {
      routerWeights: this.routerW.map((row) => [...row]),
      routerBias: [...this.routerB],
      expertWeights: this.expertW.map((row) => [...row]),
      expertBias: [...this.expertB],
      artifactHash: this.artifactHash(),
    };
  }

  private artifactHash(): string {
    return sha256({
      inputDim: this.hyper.inputDim,
      expertCount: this.hyper.expertCount,
      topK: this.hyper.topK,
      mode: this.hyper.mode,
      routerWeights: this.routerW,
      routerBias: this.routerB,
      expertWeights: this.expertW,
      expertBias: this.expertB,
    });
  }

  private epochStats(order: number[], dataset: MoeNativeDataset): MoeBatchEvaluation {
    const { features, labels } = dataset;
    const { expertCount, topK, batchSize, mode } = this.hyper;
    let taskTotal = 0;
    let auxTotal = 0;
    let batches = 0;
    for (let start = 0; start < order.length; start += batchSize) {
      const batch = order.slice(start, start + batchSize);
      const pSum = new Array<number>(expertCount).fill(0);
      const fCount = new Array<number>(expertCount).fill(0);
      let taskSum = 0;
      for (const index of batch) {
        const vector = features[index];
        const target = labels[index];
        const { probabilities } = this.gate(vector);
        const selected = selectTopK(probabilities, topK);
        const mass = selected.reduce((sum, expertIndex) => sum + probabilities[expertIndex], 0);
        let combined = 0;
        for (const expertIndex of selected) {
          combined += (probabilities[expertIndex] / mass) * this.expertValue(expertIndex, vector);
        }
        if (mode === "regression") {
          const error = combined - target;
          taskSum += error * error;
        } else {
          taskSum += bceLoss(target, sigmoid(combined));
        }
        fCount[selected[0]] += 1;
        for (let expertIndex = 0; expertIndex < expertCount; expertIndex++) {
          pSum[expertIndex] += probabilities[expertIndex];
        }
      }
      const size = batch.length;
      let inner = 0;
      for (let expertIndex = 0; expertIndex < expertCount; expertIndex++) {
        inner += (fCount[expertIndex] / size) * (pSum[expertIndex] / size);
      }
      taskTotal += taskSum / size;
      auxTotal += expertCount * inner;
      batches += 1;
    }
    return { taskLoss: taskTotal / batches, auxLoss: auxTotal / batches };
  }

  private trainEpoch(order: number[], dataset: MoeNativeDataset): void {
    const { features, labels } = dataset;
    const { inputDim, expertCount, topK, batchSize, mode, learningRate, auxLossCoefficient } =
      this.hyper;
    for (let start = 0; start < order.length; start += batchSize) {
      const batch = order.slice(start, start + batchSize);
      const size = batch.length;
      const gRouterW = zeros(expertCount, inputDim);
      const gRouterB = new Array<number>(expertCount).fill(0);
      const gExpertW = zeros(expertCount, inputDim);
      const gExpertB = new Array<number>(expertCount).fill(0);
      const sumX = new Array<number>(inputDim).fill(0);
      const pSum = new Array<number>(expertCount).fill(0);
      const fCount = new Array<number>(expertCount).fill(0);
      for (const index of batch) {
        const vector = features[index];
        const target = labels[index];
        for (let j = 0; j < inputDim; j++) sumX[j] += vector[j];
        const { probabilities } = this.gate(vector);
        const selected = selectTopK(probabilities, topK);
        const mass = selected.reduce((sum, expertIndex) => sum + probabilities[expertIndex], 0);
        const expertOutputs = selected.map((expertIndex) => this.expertValue(expertIndex, vector));
        let combined = 0;
        for (let i = 0; i < selected.length; i++) {
          combined += (probabilities[selected[i]] / mass) * expertOutputs[i];
        }
        let ds: number;
        if (mode === "regression") {
          ds = 2 * (combined - target);
        } else {
          ds = sigmoid(combined) - target;
        }
        const dp = selected.map((_expertIndex, i) => (ds * (expertOutputs[i] - combined)) / mass);
        let dpDotP = 0;
        for (let i = 0; i < selected.length; i++) dpDotP += dp[i] * probabilities[selected[i]];
        for (let expertIndex = 0; expertIndex < expertCount; expertIndex++) {
          const rank = selected.indexOf(expertIndex);
          const dLogit = probabilities[expertIndex] * ((rank >= 0 ? dp[rank] : 0) - dpDotP);
          if (dLogit !== 0) {
            for (let j = 0; j < inputDim; j++) gRouterW[expertIndex][j] += dLogit * vector[j];
            gRouterB[expertIndex] += dLogit;
          }
          pSum[expertIndex] += probabilities[expertIndex];
        }
        for (let i = 0; i < selected.length; i++) {
          const expertIndex = selected[i];
          const gradient = (ds * probabilities[expertIndex]) / mass;
          for (let j = 0; j < inputDim; j++) gExpertW[expertIndex][j] += gradient * vector[j];
          gExpertB[expertIndex] += gradient;
        }
        fCount[selected[0]] += 1;
      }
      const pMean = pSum.map((value) => value / size);
      const fMean = fCount.map((value) => value / size);
      let inner = 0;
      for (let expertIndex = 0; expertIndex < expertCount; expertIndex++) {
        inner += fMean[expertIndex] * pMean[expertIndex];
      }
      const dAux = pMean.map(
        (probability, expertIndex) => expertCount * probability * (fMean[expertIndex] - inner),
      );
      const inverse = 1 / size;
      for (let expertIndex = 0; expertIndex < expertCount; expertIndex++) {
        const auxGradient = auxLossCoefficient * dAux[expertIndex];
        this.routerB[expertIndex] -= learningRate * (gRouterB[expertIndex] * inverse + auxGradient);
        this.expertB[expertIndex] -= learningRate * gExpertB[expertIndex] * inverse;
        for (let j = 0; j < inputDim; j++) {
          this.routerW[expertIndex][j] -=
            learningRate * (gRouterW[expertIndex][j] * inverse + auxGradient * sumX[j]);
          this.expertW[expertIndex][j] -= learningRate * gExpertW[expertIndex][j] * inverse;
        }
      }
    }
  }

  private analyze(dataset: MoeNativeDataset): MoeDatasetAnalysis {
    const { features, labels, domainLabels } = dataset;
    const order = features.map((_, index) => index);
    const stats = this.epochStats(order, dataset);
    const expertCount = this.hyper.expertCount;
    const counts = new Array<number>(expertCount).fill(0);
    const domainCounts: number[][] | null = domainLabels
      ? Array.from({ length: Math.max(...domainLabels) + 1 }, () =>
          new Array<number>(expertCount).fill(0),
        )
      : null;
    let correct = 0;
    let squaredError = 0;
    let positive = 0;
    const modalByDomain = new Map<number, number>();
    const hardAssignments = new Array<number>(features.length).fill(0);
    for (let i = 0; i < features.length; i++) {
      const prediction = this.predict(features[i]);
      const hard = this.route(features[i]).selectedExperts[0].expertIndex;
      hardAssignments[i] = hard;
      counts[hard] += 1;
      if (domainLabels && domainCounts) domainCounts[domainLabels[i]][hard] += 1;
      if (this.hyper.mode === "classification") {
        const predicted = prediction.value >= 0.5 ? 1 : 0;
        if (predicted === labels[i]) correct += 1;
        if (labels[i] === 1) positive += 1;
      } else {
        const error = prediction.value - labels[i];
        squaredError += error * error;
      }
    }
    if (domainLabels && domainCounts) {
      for (let domain = 0; domain < domainCounts.length; domain++) {
        let bestExpert = 0;
        for (let expertIndex = 1; expertIndex < expertCount; expertIndex++) {
          if (domainCounts[domain][expertIndex] > domainCounts[domain][bestExpert]) {
            bestExpert = expertIndex;
          }
        }
        modalByDomain.set(domain, bestExpert);
      }
    }
    let routingMatches = 0;
    if (domainLabels) {
      for (let i = 0; i < features.length; i++) {
        if (modalByDomain.get(domainLabels[i]) === hardAssignments[i]) routingMatches += 1;
      }
    }
    const total = features.length;
    const loads = counts.map((count) => count / total);
    const classification = this.hyper.mode === "classification";
    return {
      taskLoss: stats.taskLoss,
      auxLoss: stats.auxLoss,
      loads,
      domainLoads: domainCounts,
      routingAccuracy: domainLabels ? routingMatches / total : null,
      accuracy: classification ? correct / total : null,
      baselineAccuracy: classification ? Math.max(positive, total - positive) / total : null,
      rmse: classification ? null : Math.sqrt(squaredError / total),
    };
  }

  private assertFiniteParameters(): void {
    for (const row of [...this.routerW, ...this.expertW]) {
      for (const value of row) requireFinite(value, "moe_training_diverged");
    }
    for (const value of [...this.routerB, ...this.expertB]) {
      requireFinite(value, "moe_training_diverged");
    }
  }

  async train(dataset: MoeNativeDataset, options: MoeTrainOptions): Promise<MoeTrainingResult> {
    if (!options.ownerId) throw new Error("moe_owner_required");
    if (!options.territoryId) throw new Error("moe_territory_required");
    const { domainLabels } = validateDataset(dataset, this.hyper);
    const datasetHash = sha256({
      features: dataset.features,
      labels: dataset.labels,
      domainLabels: domainLabels ?? null,
    });
    const modelId = `native-moe-${sha256({
      inputDim: this.hyper.inputDim,
      expertCount: this.hyper.expertCount,
      topK: this.hyper.topK,
      mode: this.hyper.mode,
      seed: this.hyper.seed,
    }).slice(0, 16)}`;
    const decision = await options.hooks?.authorize?.({
      action: "native_ml.moe.train",
      territoryId: options.territoryId,
      modelId,
    });
    if (decision && decision.decision !== "ALLOW") {
      throw new Error(`native_ml_${decision.decision.toLowerCase()}`);
    }
    const order = dataset.features.map((_, index) => index);
    const initial = this.analyze(dataset);
    const lossHistory = [initial.taskLoss];
    const auxLossHistory = [initial.auxLoss];
    const random = mulberry32((this.hyper.seed ^ 0x9e3779b9) >>> 0);
    for (let epoch = 0; epoch < this.hyper.epochs; epoch++) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
      }
      this.trainEpoch(order, dataset);
      this.assertFiniteParameters();
      const stats = this.epochStats(
        dataset.features.map((_, index) => index),
        dataset,
      );
      lossHistory.push(stats.taskLoss);
      auxLossHistory.push(stats.auxLoss);
    }
    const analysis = this.analyze(dataset);
    const artifact = this.getArtifact();
    const metrics: Record<string, number> = {
      initialLoss: lossHistory[0],
      finalLoss: analysis.taskLoss,
      lossReduction: lossHistory[0] - analysis.taskLoss,
      initialAuxLoss: auxLossHistory[0],
      finalAuxLoss: analysis.auxLoss,
      loadMin: Math.min(...analysis.loads),
      loadMax: Math.max(...analysis.loads),
      samples: dataset.features.length,
      epochs: this.hyper.epochs,
      expertCount: this.hyper.expertCount,
      topK: this.hyper.topK,
    };
    analysis.loads.forEach((load, expertIndex) => {
      metrics[`loadExpert${expertIndex}`] = load;
    });
    if (analysis.accuracy !== null) {
      metrics.accuracy = analysis.accuracy;
      metrics.baselineAccuracy = analysis.baselineAccuracy!;
    }
    if (analysis.rmse !== null) metrics.rmse = analysis.rmse;
    if (analysis.routingAccuracy !== null) metrics.routingAccuracy = analysis.routingAccuracy;
    const trainingHash = sha256({
      hyper: this.hyper,
      datasetHash,
      artifactHash: artifact.artifactHash,
      metrics,
      lossHistory,
      auxLossHistory,
    });
    const provenanceId = `prov_${sha256({
      trainingHash,
      ownerId: options.ownerId,
      territoryId: options.territoryId,
    }).slice(0, 24)}`;
    const model: ModelIdentity = {
      modelId,
      version: "0.1.0",
      territoryId: options.territoryId,
      ownerId: options.ownerId,
      task: this.hyper.mode,
      algorithm: "native-moe-topk-sgd",
      datasetIds: [`moe-dataset-${datasetHash.slice(0, 16)}`],
      modelHash: artifact.artifactHash,
      createdAt: new Date().toISOString(),
      approvalStatus: "PENDING_REVIEW",
    };
    await options.hooks?.audit?.("native_ml.moe.training_completed", {
      modelId,
      trainingHash,
      artifactHash: artifact.artifactHash,
      provenanceId,
    });
    return {
      model,
      artifact,
      artifactHash: artifact.artifactHash,
      trainingHash,
      provenanceId,
      approvalRequired: true,
      lossHistory,
      auxLossHistory,
      loadFractions: analysis.loads,
      domainLoadFractions: analysis.domainLoads,
      metrics,
    };
  }
}

export function createMoeNative(config: MoeNativeConfig): MoeNativeModel {
  return new MoeNativeModel(config);
}

export async function trainMoeNative(
  config: MoeNativeConfig,
  dataset: MoeNativeDataset,
  options: MoeTrainOptions,
): Promise<{ model: MoeNativeModel; result: MoeTrainingResult }> {
  const model = new MoeNativeModel(config);
  const result = await model.train(dataset, options);
  return { model, result };
}
