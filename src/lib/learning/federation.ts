import { createHash, timingSafeEqual } from "node:crypto";

export interface FederatedUpdate {
  updateId: string;
  nodeId: string;
  modelId: string;
  baseModelVersion: string;
  deltaWeights: number[];
  deltaBias: number;
  sampleCount: number;
  updateHash: string;
  signature: string;
  createdAt: string;
}

export interface FederationPolicy {
  maxSamplesPerUpdate: number;
  maxDimension: number;
  maxAbsDelta: number;
  maxClockSkewMs: number;
}

const DEFAULT_POLICY: FederationPolicy = {
  maxSamplesPerUpdate: 1_000_000,
  maxDimension: 100_000,
  maxAbsDelta: 100,
  maxClockSkewMs: 5 * 60_000,
};
const seenUpdates = new Set<string>();

function digest(update: Omit<FederatedUpdate, "updateHash" | "signature">): string {
  return createHash("sha256").update(JSON.stringify(update)).digest("hex");
}

function signDigest(hash: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${hash}`).digest("hex");
}

export function validateFederatedUpdate(
  update: FederatedUpdate,
  secret: string,
  policy = DEFAULT_POLICY,
): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!secret) reasons.push("trusted federation key missing");
  if (!update.updateId || seenUpdates.has(update.updateId))
    reasons.push("replay or missing update id");
  if (!update.nodeId || !update.modelId || !update.baseModelVersion)
    reasons.push("identity incomplete");
  if (
    !Number.isInteger(update.sampleCount) ||
    update.sampleCount < 1 ||
    update.sampleCount > policy.maxSamplesPerUpdate
  )
    reasons.push("invalid sample count");
  if (update.deltaWeights.length === 0 || update.deltaWeights.length > policy.maxDimension)
    reasons.push("invalid update dimension");
  if (
    update.deltaWeights.some(
      (value) => !Number.isFinite(value) || Math.abs(value) > policy.maxAbsDelta,
    ) ||
    !Number.isFinite(update.deltaBias) ||
    Math.abs(update.deltaBias) > policy.maxAbsDelta
  )
    reasons.push("unsafe update magnitude");
  const created = Date.parse(update.createdAt);
  if (!Number.isFinite(created) || Math.abs(Date.now() - created) > policy.maxClockSkewMs)
    reasons.push("stale update");
  const unsigned = {
    updateId: update.updateId,
    nodeId: update.nodeId,
    modelId: update.modelId,
    baseModelVersion: update.baseModelVersion,
    deltaWeights: update.deltaWeights,
    deltaBias: update.deltaBias,
    sampleCount: update.sampleCount,
    createdAt: update.createdAt,
  };
  const expectedHash = digest(unsigned);
  if (expectedHash !== update.updateHash) reasons.push("update hash mismatch");
  const expectedSignature = signDigest(expectedHash, secret);
  const a = Buffer.from(expectedSignature);
  const b = Buffer.from(update.signature || "");
  if (a.length !== b.length || !timingSafeEqual(a, b)) reasons.push("signature mismatch");
  return { allowed: reasons.length === 0, reasons };
}

export function acceptFederatedUpdate(
  update: FederatedUpdate,
  secret: string,
  policy?: FederationPolicy,
): void {
  const result = validateFederatedUpdate(update, secret, policy);
  if (!result.allowed) throw new Error(`federated_update_rejected: ${result.reasons.join(", ")}`);
  seenUpdates.add(update.updateId);
}

export function aggregateFedAvg(updates: FederatedUpdate[]): {
  deltaWeights: number[];
  deltaBias: number;
} {
  if (updates.length === 0) throw new Error("No federated updates");
  const dimension = updates[0].deltaWeights.length;
  if (updates.some((u) => u.deltaWeights.length !== dimension))
    throw new Error("Federated dimensions differ");
  const total = updates.reduce((sum, u) => sum + u.sampleCount, 0);
  if (total <= 0) throw new Error("Invalid federated sample total");
  const weights = Array.from({ length: dimension }, () => 0);
  let bias = 0;
  for (const update of updates) {
    const factor = update.sampleCount / total;
    update.deltaWeights.forEach((value, index) => {
      weights[index] += value * factor;
    });
    bias += update.deltaBias * factor;
  }
  return { deltaWeights: weights, deltaBias: bias };
}
