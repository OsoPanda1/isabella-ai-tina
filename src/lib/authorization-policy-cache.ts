import { createHash } from "node:crypto";
import type { AuthorizationDynamicContext } from "./authorization-context";

export interface CachedAuthorizationPolicy {
  tenantId: string;
  subjectId: string;
  action: string;
  resource: string;
  role?: string;
  authenticated: boolean;
  policyVersion: string;
  allow: boolean;
  obligations: string[];
  denyReason: string | null;
  issuedAt: number;
  expiresAt: number;
  invalidationKeys: string[];
}

export interface AuthorizationPolicyCacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

const ALLOW_TTL_MS = 2 * 60_000;
const DENY_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 5_000;
const cache = new Map<string, CachedAuthorizationPolicy>();
let hits = 0;
let misses = 0;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/**
 * The cache stores the deterministic policy result, not the signed decision.
 * A fresh decision_id, signature and ledger-chain position are generated on
 * every authorization request, preserving the existing cryptographic chain.
 */
export function authorizationPolicyCacheKey(input: {
  tenantId: string;
  subjectId: string;
  action: string;
  resource: string;
  role?: string;
  authenticated: boolean;
  resourceTenantId?: string;
  resourceOwner?: string;
  policyVersion: string;
  dynamicContext?: AuthorizationDynamicContext;
}): string {
  return digest({
    tenantId: input.tenantId,
    subjectId: input.subjectId,
    action: input.action,
    resource: input.resource,
    role: input.role ?? null,
    authenticated: input.authenticated,
    resourceTenantId: input.resourceTenantId ?? null,
    resourceOwner: input.resourceOwner ?? null,
    policyVersion: input.policyVersion,
    dynamicContext: input.dynamicContext ?? null,
  });
}

export function getAuthorizationPolicyCache(
  key: string,
  now = Date.now(),
): CachedAuthorizationPolicy | null {
  const entry = cache.get(key);
  if (!entry) {
    misses++;
    return null;
  }
  if (entry.expiresAt <= now) {
    cache.delete(key);
    misses++;
    return null;
  }
  hits++;
  return {
    ...entry,
    obligations: [...entry.obligations],
    invalidationKeys: [...entry.invalidationKeys],
  };
}

export function setAuthorizationPolicyCache(
  key: string,
  input: Omit<CachedAuthorizationPolicy, "issuedAt" | "expiresAt">,
): CachedAuthorizationPolicy {
  const now = Date.now();
  const entry: CachedAuthorizationPolicy = {
    ...input,
    obligations: [...input.obligations],
    invalidationKeys: [...input.invalidationKeys],
    issuedAt: now,
    expiresAt: now + (input.allow ? ALLOW_TTL_MS : DENY_TTL_MS),
  };
  for (const [existingKey, existing] of cache) {
    if (existing.expiresAt <= now) cache.delete(existingKey);
  }
  cache.set(key, entry);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].issuedAt - b[1].issuedAt)
      .slice(0, cache.size - MAX_CACHE_ENTRIES);
    for (const [oldestKey] of oldest) cache.delete(oldestKey);
  }
  return {
    ...entry,
    obligations: [...entry.obligations],
    invalidationKeys: [...entry.invalidationKeys],
  };
}

export function invalidateAuthorizationCache(keys: readonly string[]): number {
  const wanted = new Set(keys);
  let removed = 0;
  for (const [key, entry] of cache) {
    if (entry.invalidationKeys.some((candidate) => wanted.has(candidate))) {
      cache.delete(key);
      removed++;
    }
  }
  return removed;
}

export function invalidateAuthorizationCacheByTenant(tenantId: string): number {
  return invalidateAuthorizationCache([`tenant:${tenantId}`]);
}

export function invalidateAuthorizationCacheBySubject(subjectId: string): number {
  return invalidateAuthorizationCache([`subject:${subjectId}`]);
}

export function invalidateAuthorizationCacheByPolicy(policyVersion: string): number {
  return invalidateAuthorizationCache([`policy:${policyVersion}`]);
}

export function getAuthorizationPolicyCacheStats(): AuthorizationPolicyCacheStats {
  const total = hits + misses;
  return {
    size: cache.size,
    hits,
    misses,
    hitRate: total === 0 ? 0 : hits / total,
  };
}

export function clearAuthorizationPolicyCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}
