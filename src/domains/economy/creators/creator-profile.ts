import { randomBytes } from "node:crypto";
import type { CreatorProfile, CreatorReputation, WalletSummary } from "../types";

/* ========================================================================== *
 * Isabella Creator Profile & Reputation Engine
 *
 * Manages creator identities, reputation scoring, and contribution tracking.
 * ========================================================================== */

const profiles = new Map<string, CreatorProfile>();

function generateId(): string {
  return `creator_${randomBytes(12).toString("hex")}`;
}

function emptyReputation(): CreatorReputation {
  return {
    quality: 0,
    reliability: 0,
    evidence: 0,
    security: 0,
    customerRetention: 0,
    disputeRate: 0,
    globalScore: 0,
    totalTransactions: 0,
    totalRevenue: 0,
    updatedAt: new Date().toISOString(),
  };
}

function emptyWallet(): WalletSummary {
  return {
    balance: 0,
    pendingSettlement: 0,
    totalEarned: 0,
    totalPaidOut: 0,
    currency: "USD",
    updatedAt: new Date().toISOString(),
  };
}

export function createCreatorProfile(params: {
  principalId: string;
  tenantId: string;
  displayName: string;
  capabilities: string[];
  skills: string[];
}): CreatorProfile {
  const key = `${params.tenantId}:${params.principalId}`;
  if (profiles.has(key)) {
    return profiles.get(key)!;
  }
  const now = new Date().toISOString();
  const profile: CreatorProfile = {
    id: generateId(),
    ...params,
    assets: [],
    certifications: [],
    reputation: emptyReputation(),
    wallet: emptyWallet(),
    createdAt: now,
    updatedAt: now,
  };
  profiles.set(key, profile);
  return profile;
}

export function getCreatorProfile(principalId: string, tenantId: string): CreatorProfile | null {
  return profiles.get(`${tenantId}:${principalId}`) || null;
}

export function updateCreatorReputation(
  principalId: string,
  tenantId: string,
  update: Partial<CreatorReputation>,
): CreatorReputation | null {
  const key = `${tenantId}:${principalId}`;
  const profile = profiles.get(key);
  if (!profile) return null;

  const rep = { ...profile.reputation, ...update };

  rep.globalScore =
    Math.round(
      ((rep.quality * 0.25 +
        rep.reliability * 0.2 +
        rep.evidence * 0.2 +
        rep.security * 0.2 +
        rep.customerRetention * 0.15) *
        100) /
        100,
    ) / 100;

  rep.updatedAt = new Date().toISOString();
  profile.reputation = rep;
  profile.updatedAt = new Date().toISOString();
  return rep;
}

export function recordTransaction(
  principalId: string,
  tenantId: string,
  amount: number,
): CreatorReputation | null {
  const key = `${tenantId}:${principalId}`;
  const profile = profiles.get(key);
  if (!profile) return null;

  profile.reputation.totalTransactions += 1;
  profile.reputation.totalRevenue += amount;
  profile.wallet.totalEarned += amount;
  profile.wallet.balance += amount;
  profile.wallet.updatedAt = new Date().toISOString();

  const qualityDelta = Math.min(0.02, 1 / (profile.reputation.totalTransactions + 10));
  profile.reputation.quality = Math.min(1, profile.reputation.quality + qualityDelta);
  profile.reputation.reliability = Math.min(1, profile.reputation.reliability + qualityDelta * 0.8);
  profile.reputation.updatedAt = new Date().toISOString();
  profile.updatedAt = new Date().toISOString();

  return profile.reputation;
}

export function listCreators(tenantId: string): CreatorProfile[] {
  const result: CreatorProfile[] = [];
  for (const [key, profile] of profiles) {
    if (key.startsWith(`${tenantId}:`)) {
      result.push(profile);
    }
  }
  return result;
}
