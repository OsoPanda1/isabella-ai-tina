import { createHash } from "node:crypto";
import { NeonRepository } from "@/lib/persistence/adapters/neon-adapter";
import type { DatasetIdentity, TrainingRun } from "./types";

export interface RegisteredModel {
  id: string;
  tenantId: string;
  version: string;
  territoryId: string;
  ownerId: string;
  task: string;
  algorithm: string;
  datasetIds: string[];
  modelHash: string;
  approvalStatus: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "REVOKED";
  createdAt: string;
}
export interface EvaluationRun {
  id: string;
  tenantId: string;
  modelId: string;
  datasetId: string;
  protocolHash: string;
  metrics: Record<string, number>;
  baseline: Record<string, number>;
  artifactHash: string;
  status: "RUNNING" | "PASSED" | "FAILED";
  createdAt: string;
}
interface DbDataset {
  id: string;
  version: string;
  territoryId: string;
  source: string;
  license: string;
  schemaHash: string;
  contentHash: string;
  status: DatasetIdentity["status"];
  createdAt: string;
}
interface DbTrainingRun {
  id: string;
  datasetIds: string[];
  baseModelId?: string;
  algorithm: string;
  hyperparameters: Record<string, unknown>;
  seed: number;
  status: TrainingRun["status"];
  sourceCommit: string;
  inputHash: string;
  outputHash?: string;
  createdAt: string;
  completedAt?: string;
}

const datasets = new NeonRepository<DbDataset>("fgais_datasets");
const models = new NeonRepository<RegisteredModel>("fgais_models");
const training = new NeonRepository<DbTrainingRun>("fgais_training_runs");
const evaluations = new NeonRepository<EvaluationRun>("fgais_evaluations");

function hashObject(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function registerDataset(
  tenantId: string,
  dataset: DatasetIdentity,
): Promise<DatasetIdentity> {
  if (dataset.status !== "VALIDATED")
    throw new Error("Only validated datasets may enter the training registry");
  if (!dataset.license.trim() || !dataset.contentHash || !dataset.schemaHash)
    throw new Error("Dataset provenance is incomplete");
  await datasets.create(tenantId, {
    id: dataset.datasetId,
    version: dataset.version,
    territoryId: dataset.territoryId,
    source: dataset.source,
    license: dataset.license,
    schemaHash: dataset.schemaHash,
    contentHash: dataset.contentHash,
    status: dataset.status,
    createdAt: dataset.createdAt,
  });
  return dataset;
}

export async function registerModel(
  tenantId: string,
  model: RegisteredModel,
): Promise<RegisteredModel> {
  if (model.approvalStatus !== "PENDING_REVIEW")
    throw new Error("New models must start PENDING_REVIEW");
  if (!model.modelHash || model.datasetIds.length === 0)
    throw new Error("Model provenance is incomplete");
  return models.create(tenantId, model);
}

export async function createTrainingRun(
  tenantId: string,
  input: Omit<TrainingRun, "inputHash">,
): Promise<TrainingRun> {
  const run: TrainingRun = { ...input, inputHash: hashObject(input) };
  await training.create(tenantId, {
    id: run.runId,
    datasetIds: run.datasetIds,
    baseModelId: run.baseModelId,
    algorithm: run.algorithm,
    hyperparameters: run.hyperparameters,
    seed: run.seed,
    status: run.status,
    sourceCommit: run.sourceCommit,
    inputHash: run.inputHash,
    outputHash: run.outputHash,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  });
  return run;
}

export async function recordEvaluation(
  tenantId: string,
  evaluation: EvaluationRun,
): Promise<EvaluationRun> {
  if (!evaluation.protocolHash || !evaluation.artifactHash)
    throw new Error("Evaluation evidence is incomplete");
  return evaluations.create(tenantId, evaluation);
}

export { hashObject };
