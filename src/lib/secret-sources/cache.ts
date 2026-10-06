/**
 * Per-key, in-process TTL cache for resolved secrets.
 *
 * Port of Hermes' in-process layer (`agent.secret_sources._cache.CachedFetch`):
 * entries are keyed by source namespace + secret name, expire after a TTL, and
 * hold values only in this process' memory.
 *
 * Deliberately NOT ported: the on-disk cache (plaintext or AES-GCM derived
 * from the bootstrap token). Isabella runs on Vercel serverless, where the
 * only writable volume is an ephemeral, shared `/tmp`, so a disk cache would
 * buy almost nothing while creating an at-rest copy of live secrets
 * (AGENTS.md §2.3). The atomic/0600 write mechanics are therefore dropped
 * along with it: there is nothing left to write.
 *
 * Values in this cache are secrets: they are never logged, never serialized,
 * and are dropped by `clearSecretCache()` (call it after a rotation).
 */

/** Freshness window for both `command` and `bitwarden` fetches (Hermes default). */
export const SECRET_CACHE_TTL_MS = 300_000;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const entries = new Map<string, CacheEntry>();
const NAMESPACE_SEPARATOR = "\u0000";

function entryKey(namespace: string, key: string): string {
  return `${namespace}${NAMESPACE_SEPARATOR}${key}`;
}

export function cacheGet(namespace: string, key: string): string | null {
  const id = entryKey(namespace, key);
  const entry = entries.get(id);
  if (entry === undefined) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(id);
    return null;
  }
  return entry.value;
}

export function cacheSet(namespace: string, key: string, value: string, ttlMs: number): void {
  if (ttlMs <= 0) return;
  entries.set(entryKey(namespace, key), { value, expiresAt: Date.now() + ttlMs });
}

/** Drops every entry, or only the entries of one namespace (post-rotation). */
export function cacheClear(namespace?: string): void {
  if (namespace === undefined) {
    entries.clear();
    return;
  }
  const prefix = `${namespace}${NAMESPACE_SEPARATOR}`;
  for (const id of [...entries.keys()]) {
    if (id.startsWith(prefix)) entries.delete(id);
  }
}

/** Number of live entries — diagnostics and tests only, never the values. */
export function cacheSize(): number {
  return entries.size;
}
