/** Learning Plane contracts: identity, provenance and reproducibility are mandatory. */
export type DatasetStatus = "PROPOSED" | "VALIDATED" | "APPROVED" | "REJECTED" | "REVOKED";
export type TrainingStatus =
  "QUEUED" | "RUNNING" | "SUCCEEDED" | "COMPLETED" | "FAILED" | "CANCELLED" | "REJECTED";
export interface DatasetIdentity {
  datasetId: string;
  version: string;
  territoryId: string;
  source: string;
  license: string;
  schemaHash: string;
  contentHash: string;
  status: DatasetStatus;
  createdAt: string;
}
export interface DatasetValidation {
  valid: boolean;
  checks?: Record<string, boolean>;
  errors: string[];
  warnings?: string[];
  reasons?: string[];
  contentHash: string;
  schemaHash: string;
}
export interface TrainingPolicy {
  policyId?: string;
  allowedLicenses: string[];
  requireHumanApproval: boolean;
  requireProvenance: boolean;
  requireContaminationCheck?: boolean;
  requireEvaluation: boolean;
  maxDatasetSize?: number;
  maxSamples?: number;
  maxEpochs?: number;
}
export interface TrainingRun {
  runId: string;
  datasetIds: string[];
  baseModelId?: string;
  algorithm: string;
  hyperparameters: Record<string, unknown>;
  seed: number;
  status: TrainingStatus;
  sourceCommit?: string;
  inputHash: string;
  outputHash?: string;
  createdAt: string;
  completedAt?: string;
}
