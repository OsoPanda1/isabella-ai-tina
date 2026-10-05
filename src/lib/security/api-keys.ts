/**
 * Isabella — Native API Key Management
 *
 * Generación, validación, rotación y gestión de API keys.
 * Keys son 512 bytes internamente, con formato `isa_<base64url>`.
 *
 * Autoría: Edwin Oswaldo Castillo Trejo (Anubis Villaseñor)
 * ORCID: 0009-0008-5050-1539
 * Licencia: CC BY 4.0
 */

import crypto from "crypto";
import {
  generateSecureRandom,
  generate512ByteKey,
  create512ByteKeyFromEntropy,
  createHMAC512,
  sha512,
  sha256,
  generateSecureUUID,
} from "./crypto";

// ============================================================================
// TYPES
// ============================================================================

export interface APIKey {
  id: string;
  keyPrefix: string;
  keyHash: string;
  name: string;
  scopes: APIKeyScope[];
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  rateLimit: RateLimitConfig;
  metadata: Record<string, unknown>;
  revoked: boolean;
  revokedAt: number | null;
}

export type APIKeyScope =
  | "cognitive:read"
  | "cognitive:write"
  | "memory:read"
  | "memory:write"
  | "pipeline:execute"
  | "skills:manage"
  | "admin:read"
  | "admin:write"
  | "api:access"
  | "*";

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
}

export interface GeneratedAPIKey {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
  keyId: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
};

const DEFAULT_EXPIRY_DAYS = 90;
const KEY_PREFIX = "isa_";
const KEY_BYTES = 48;
const VERSION = "v1";

// ============================================================================
// API KEY GENERATION
// ============================================================================

/**
 * Generate a new API key pair (raw key + hash).
 * The raw key is shown once; only the hash is stored.
 */
export function generateAPIKey(options?: {
  name?: string;
  scopes?: APIKeyScope[];
  expiresInDays?: number;
  rateLimit?: Partial<RateLimitConfig>;
}): GeneratedAPIKey {
  const rawEntropy = generateSecureRandom(KEY_BYTES);
  const rawKey = `${KEY_PREFIX}${VERSION}_${rawEntropy.toString("base64url")}`;
  const keyHash = hashAPIKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12) + "...";
  const keyId = generateSecureUUID();

  return {
    rawKey,
    keyPrefix,
    keyHash,
    keyId,
  };
}

/**
 * Create a full API key record with metadata.
 */
export function createAPIKeyRecord(
  generated: GeneratedAPIKey,
  options?: {
    name?: string;
    scopes?: APIKeyScope[];
    expiresInDays?: number;
    rateLimit?: Partial<RateLimitConfig>;
    metadata?: Record<string, unknown>;
  },
): APIKey {
  const now = Date.now();
  const expiresInDays = options?.expiresInDays ?? DEFAULT_EXPIRY_DAYS;

  return {
    id: generated.keyId,
    keyPrefix: generated.keyPrefix,
    keyHash: generated.keyHash,
    name: options?.name ?? "Unnamed API Key",
    scopes: options?.scopes ?? ["api:access"],
    createdAt: now,
    expiresAt: expiresInDays > 0 ? now + expiresInDays * 24 * 60 * 60 * 1000 : null,
    lastUsedAt: null,
    rateLimit: {
      ...DEFAULT_RATE_LIMIT,
      ...options?.rateLimit,
    },
    metadata: options?.metadata ?? {},
    revoked: false,
    revokedAt: null,
  };
}

/**
 * Generate a master key for the system.
 * This is a 512-byte key derived from a passphrase.
 */
export function generateMasterKey(passphrase: string): { masterKey: Buffer; keyId: string } {
  const { key: masterKey } = generate512ByteKey(passphrase);
  const keyId = generateSecureUUID();
  return { masterKey, keyId };
}

/**
 * Generate an internal signing key for tokens.
 */
export function generateSigningKey(): Buffer {
  return generateSecureRandom(64);
}

// ============================================================================
// API KEY HASHING & VERIFICATION
// ============================================================================

/**
 * Hash an API key using SHA-512 with a domain separator.
 */
export function hashAPIKey(key: string): string {
  const domainSeparator = "isabella-api-key-v1";
  return createHMAC512(domainSeparator, key);
}

/**
 * Verify an API key against a stored hash.
 */
export function verifyAPIKey(key: string, storedHash: string): boolean {
  const computedHash = hashAPIKey(key);
  const expectedBuffer = Buffer.from(computedHash, "hex");
  const actualBuffer = Buffer.from(storedHash, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  const { timingSafeEqual } = crypto;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * Extract the key prefix from a raw API key.
 */
export function extractKeyPrefix(key: string): string {
  return key.substring(0, 12) + "...";
}

/**
 * Check if a string looks like an API key.
 */
export function isAPIKeyFormat(key: string): boolean {
  return key.startsWith(KEY_PREFIX) && key.includes(`${VERSION}_`);
}

// ============================================================================
// API KEY VALIDATION
// ============================================================================

export interface APIKeyValidationResult {
  valid: boolean;
  keyId?: string;
  scopes?: APIKeyScope[];
  error?: string;
}

/**
 * Validate an API key against a list of stored keys.
 */
export function validateAPIKey(
  key: string,
  storedKeys: APIKey[],
  requiredScope?: APIKeyScope,
): APIKeyValidationResult {
  if (!isAPIKeyFormat(key)) {
    return { valid: false, error: "Invalid key format" };
  }

  const keyHash = hashAPIKey(key);

  for (const stored of storedKeys) {
    if (stored.revoked) {
      continue;
    }

    if (stored.expiresAt && Date.now() > stored.expiresAt) {
      continue;
    }

    if (stored.keyHash !== keyHash) {
      continue;
    }

    // Key found and valid
    if (requiredScope && !stored.scopes.includes("*")) {
      if (!stored.scopes.includes(requiredScope)) {
        return {
          valid: false,
          keyId: stored.id,
          scopes: stored.scopes,
          error: `Missing required scope: ${requiredScope}`,
        };
      }
    }

    return {
      valid: true,
      keyId: stored.id,
      scopes: stored.scopes,
    };
  }

  return { valid: false, error: "Key not found or invalid" };
}

// ============================================================================
// API KEY STORAGE (In-Memory for client-side)
// ============================================================================

/**
 * In-memory API key store.
 * For production, use a database.
 */
class APIKeyStore {
  private keys: Map<string, APIKey> = new Map();
  private hashToId: Map<string, string> = new Map();

  add(key: APIKey): void {
    this.keys.set(key.id, key);
    this.hashToId.set(key.keyHash, key.id);
  }

  get(id: string): APIKey | undefined {
    return this.keys.get(id);
  }

  getByHash(hash: string): APIKey | undefined {
    const id = this.hashToId.get(hash);
    return id ? this.keys.get(id) : undefined;
  }

  remove(id: string): boolean {
    const key = this.keys.get(id);
    if (!key) return false;
    this.hashToId.delete(key.keyHash);
    this.keys.delete(id);
    return true;
  }

  revoke(id: string): boolean {
    const key = this.keys.get(id);
    if (!key) return false;
    key.revoked = true;
    key.revokedAt = Date.now();
    return true;
  }

  list(): APIKey[] {
    return Array.from(this.keys.values());
  }

  listActive(): APIKey[] {
    return this.list().filter((k) => !k.revoked && (!k.expiresAt || Date.now() < k.expiresAt));
  }

  updateLastUsed(id: string): void {
    const key = this.keys.get(id);
    if (key) {
      key.lastUsedAt = Date.now();
    }
  }

  size(): number {
    return this.keys.size;
  }

  clear(): void {
    this.keys.clear();
    this.hashToId.clear();
  }
}

export const apiKeyStore = new APIKeyStore();

// ============================================================================
// API KEY ROTATION
// ============================================================================

export interface RotationResult {
  oldKeyId: string;
  newKey: GeneratedAPIKey;
  newRecord: APIKey;
}

/**
 * Rotate an API key: revoke the old one, generate a new one.
 */
export function rotateAPIKey(
  oldKeyId: string,
  options?: {
    name?: string;
    scopes?: APIKeyScope[];
    expiresInDays?: number;
    rateLimit?: Partial<RateLimitConfig>;
  },
): RotationResult | null {
  const oldKey = apiKeyStore.get(oldKeyId);
  if (!oldKey) return null;

  // Revoke old key
  apiKeyStore.revoke(oldKeyId);

  // Generate new key
  const newGenerated = generateAPIKey(options);
  const newRecord = createAPIKeyRecord(newGenerated, options);

  // Preserve name if not specified
  if (!options?.name) {
    newRecord.name = oldKey.name + " (rotated)";
  }
  if (!options?.scopes) {
    newRecord.scopes = oldKey.scopes;
  }

  apiKeyStore.add(newRecord);

  return {
    oldKeyId,
    newKey: newGenerated,
    newRecord,
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Get a summary of API key usage.
 */
export function getAPIKeySummary(): {
  total: number;
  active: number;
  revoked: number;
  expired: number;
} {
  const all = apiKeyStore.list();
  const now = Date.now();

  return {
    total: all.length,
    active: all.filter((k) => !k.revoked && (!k.expiresAt || now < k.expiresAt)).length,
    revoked: all.filter((k) => k.revoked).length,
    expired: all.filter((k) => k.expiresAt !== null && now > k.expiresAt!).length,
  };
}

/**
 * Create a demo API key for development/testing.
 */
export function createDemoAPIKey(): {
  key: GeneratedAPIKey;
  record: APIKey;
} {
  const key = generateAPIKey({
    name: "Demo API Key",
    scopes: ["api:access", "cognitive:read", "cognitive:write", "memory:read", "memory:write"],
    expiresInDays: 365,
  });

  const record = createAPIKeyRecord(key, {
    name: "Demo API Key",
    scopes: ["api:access", "cognitive:read", "cognitive:write", "memory:read", "memory:write"],
    expiresInDays: 365,
  });

  apiKeyStore.add(record);

  return { key, record };
}
