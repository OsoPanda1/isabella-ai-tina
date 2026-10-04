/**
 * Isabella Villaseñor AI — API Key Management
 *
 * Production-oriented key lifecycle service:
 * - One-time plaintext delivery.
 * - HMAC-SHA-256 digest with server-side pepper.
 * - Key lookup by embedded public key id.
 * - Constant-time digest comparison.
 * - Explicit allowlisted scopes; wildcard is forbidden.
 * - Tenant-aware ownership checks.
 * - Atomic rotation through repository transactions.
 * - Audit events without plaintext keys or digests.
 * - No silent in-memory fallback in production.
 *
 * IMPORTANT:
 * This module does not implement persistence itself. Inject an ApiKeyRepository
 * backed by durable storage. SQLite is acceptable for a single persistent node;
 * serverless or multi-instance deployments require a distributed repository.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getNativeSecret, type NativePrincipal } from "./native-auth";

/* ========================================================================== *
 * Constants and policy
 * ========================================================================== */

const KEY_VERSION = 1 as const;
const KEY_PREFIX = "iv" as const;
const KEY_SECRET_BYTES = 32;
const KEY_SECRET_LENGTH = 43; // base64url encoding of 32 bytes
const MAX_RAW_KEY_LENGTH = 256;
const DEFAULT_PLAN = "free";
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
const MAX_RATE_LIMIT_PER_MINUTE = 100_000;
const MAX_EXPIRY_DAYS = 3_650;
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000;

/**
 * Do not add "*". Administrative authority must be explicit.
 *
 * Every scope a route demands through requireScope(...) must be mintable
 * here; otherwise the endpoint is unreachable for API-key principals and
 * dies with a permanent 403. Keep this list aligned with server.ts.
 */
export const API_KEY_SCOPES = [
  "chat:read",
  "chat:write",
  "models:read",
  "territory:read",
  "billing:read",
  "billing:checkout",
  "audit:read",
  "ledger:read",
  "admin:keys",
  "keys:manage",
  "memory:read",
  "memory:write",
  "agent:chat",
  "agent:lease",
  "governance:read",
  "quantum:execute",
  "tools:execute",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export type ApiKeyStatus = "active" | "expired" | "revoked";

const ALLOWED_SCOPES = new Set<string>(API_KEY_SCOPES);
const ADMIN_SCOPES = new Set<ApiKeyScope>(["admin:keys", "keys:manage"]);

/* ========================================================================== *
 * Public types
 * ========================================================================== */

export interface ApiKeyRecord {
  id: string;
  version: number;
  keyPrefix: string;
  /** HMAC-SHA-256 digest encoded as lowercase hexadecimal. */
  keyDigest: string;
  name: string;
  userId: string;
  tenantId: string;
  scopes: ApiKeyScope[];
  plan: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rateLimitPerMinute: number;
  createdBy: string;
  replacedBy: string | null;
}

export interface ApiKeyCreateRequest {
  name: string;
  userId: string;
  tenantId: string;
  createdBy: string;
  scopes: readonly string[];
  plan?: string;
  /** Whole days from creation. Undefined means no expiration. */
  expiresInDays?: number;
  rateLimitPerMinute?: number;
}

export interface ApiKeyCreatedResponse {
  /** Public identifier; safe to persist in client metadata. */
  id: string;
  /** Plaintext key. Return only at creation/rotation and never persist it. */
  key: string;
  keyPrefix: string;
  name: string;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
  createdAt: string;
}

export type SafeApiKeyRecord = Omit<ApiKeyRecord, "keyDigest">;

export interface ApiKeyAuditEvent {
  eventId: string;
  event: "created" | "validated" | "validation_failed" | "revoked" | "rotated" | "deleted";
  keyId: string | null;
  userId: string | null;
  tenantId: string | null;
  occurredAt: string;
  traceId?: string;
  reasonCode?: string;
}

export interface ApiKeyRepository {
  /** Must fail atomically on duplicate id or digest. */
  insert(record: ApiKeyRecord): void;
  findById(id: string): ApiKeyRecord | null;
  listByOwner(userId: string, tenantId: string): ApiKeyRecord[];
  markUsed(id: string, at: string): void;
  revoke(id: string, userId: string, tenantId: string, at: string, replacedBy?: string): boolean;
  delete(id: string, userId: string, tenantId: string): boolean;
  /** Must provide an actual durable transaction in production. */
  transaction<T>(callback: () => T): T;
  audit(event: ApiKeyAuditEvent): void;
}

export interface ApiKeyServiceOptions {
  /**
   * In production this must come from KMS, Vault, Secret Manager or an
   * equivalent secret store. Minimum 32 bytes is enforced.
   */
  pepper?: string | Buffer;
  now?: () => number;
  idFactory?: () => string;
  randomBytesFactory?: (size: number) => Buffer;
  auditValidationSuccess?: boolean;
}

export class ApiKeyServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = "ApiKeyServiceError";
    this.code = code;
    this.status = status;
  }
}

/* ========================================================================== *
 * Pure helpers
 * ========================================================================== */

const nowIso = (now: () => number) => new Date(now()).toISOString();

const assertText = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== "string") throw new ApiKeyServiceError(`${field}_invalid`);
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new ApiKeyServiceError(`${field}_invalid`);
  }
  return normalized;
};

const normalizeScopes = (scopes: readonly string[]): ApiKeyScope[] => {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ApiKeyServiceError("scopes_required");
  }

  const normalized = [...new Set(scopes.map((scope) => assertText(scope, "scope", 80)))];

  if (normalized.includes("*")) {
    throw new ApiKeyServiceError("wildcard_scope_forbidden", 403);
  }

  if (normalized.some((scope) => !ALLOWED_SCOPES.has(scope))) {
    throw new ApiKeyServiceError("scope_not_allowed", 403);
  }

  return normalized.sort() as ApiKeyScope[];
};

const boundedInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ApiKeyServiceError("number_out_of_range");
  }
  return value;
};

const expiryFromDays = (days: unknown, now: () => number): string | null => {
  if (days === undefined || days === null) return null;
  const safeDays = boundedInteger(days, 0, 1, MAX_EXPIRY_DAYS);
  return new Date(now() + safeDays * 86_400_000).toISOString();
};

const readPepper = (configured?: string | Buffer): Buffer => {
  const source = configured ?? process.env.API_KEY_PEPPER;
  const pepper = Buffer.isBuffer(source)
    ? Buffer.from(source)
    : typeof source === "string"
      ? Buffer.from(source, "utf8")
      : null;

  if (!pepper) {
    /*
     * Derive a dedicated pepper from the native-auth secret via domain
     * separation. The raw secret stays exclusive to JWT signing; key
     * digests get their own HMAC context, so one material compromise
     * does not collapse both proofs.
     */
    const base = getNativeSecret();
    return createHmac("sha256", Buffer.from(base, "utf8"))
      .update("isabella/api-key-pepper/v1")
      .digest();
  }

  if (pepper.length < 32) {
    throw new ApiKeyServiceError("api_key_pepper_too_short", 500);
  }
  return pepper;
};

const digestKey = (rawKey: string, pepper: Buffer): Buffer =>
  createHmac("sha256", pepper).update(rawKey, "utf8").digest();

const digestHex = (rawKey: string, pepper: Buffer): string =>
  digestKey(rawKey, pepper).toString("hex");

const secureEqualDigest = (expectedHex: string, candidate: Buffer): boolean => {
  if (!/^[a-f0-9]{64}$/.test(expectedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
};

const createRawKey = (id: string, randomBytesFactory: (size: number) => Buffer): string => {
  const secret = randomBytesFactory(KEY_SECRET_BYTES).toString("base64url");
  return `${KEY_PREFIX}_${id}_${secret}`;
};

const parseRawKey = (rawKey: unknown): { id: string } | null => {
  if (typeof rawKey !== "string" || rawKey.length > MAX_RAW_KEY_LENGTH) return null;
  const expression = new RegExp(
    `^${KEY_PREFIX}_([A-Za-z0-9_-]{20,80})_([A-Za-z0-9_-]{${KEY_SECRET_LENGTH}})$`,
  );
  const match = expression.exec(rawKey);
  return match ? { id: match[1] } : null;
};

const statusOf = (record: ApiKeyRecord, now: number): ApiKeyStatus => {
  if (record.revokedAt) return "revoked";
  if (record.expiresAt && Date.parse(record.expiresAt) <= now) return "expired";
  return "active";
};

const principalFor = (record: ApiKeyRecord): NativePrincipal => ({
  sub: record.userId,
  tenantId: record.tenantId,
  roles: [record.scopes.some((scope) => ADMIN_SCOPES.has(scope)) ? "key-admin" : "api-client"],
  plan: record.plan,
  scopes: [...record.scopes],
  kind: "api-key",
  apiKeyId: record.id,
});

/* ========================================================================== *
 * Service
 * ========================================================================== */

export class ApiKeyService {
  private readonly pepper: Buffer;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly randomBytesFactory: (size: number) => Buffer;
  private readonly auditValidationSuccess: boolean;

  constructor(
    private readonly repository: ApiKeyRepository,
    options: ApiKeyServiceOptions = {},
  ) {
    this.pepper = readPepper(options.pepper);
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? randomUUID;
    this.randomBytesFactory = options.randomBytesFactory ?? randomBytes;
    this.auditValidationSuccess = options.auditValidationSuccess ?? false;
  }

  create(request: ApiKeyCreateRequest): ApiKeyCreatedResponse {
    const name = assertText(request.name, "name", 120);
    const userId = assertText(request.userId, "userId", 160);
    const tenantId = assertText(request.tenantId, "tenantId", 160);
    const createdBy = assertText(request.createdBy, "createdBy", 160);
    const scopes = normalizeScopes(request.scopes);
    const plan = assertText(request.plan ?? DEFAULT_PLAN, "plan", 80);
    const rateLimitPerMinute = boundedInteger(
      request.rateLimitPerMinute,
      DEFAULT_RATE_LIMIT_PER_MINUTE,
      1,
      MAX_RATE_LIMIT_PER_MINUTE,
    );
    const expiresAt = expiryFromDays(request.expiresInDays, this.now);
    const id = this.idFactory();
    const rawKey = createRawKey(id, this.randomBytesFactory);
    const createdAt = nowIso(this.now);

    const record: ApiKeyRecord = {
      id,
      version: KEY_VERSION,
      keyPrefix: rawKey.slice(0, Math.min(16, rawKey.length)),
      keyDigest: digestHex(rawKey, this.pepper),
      name,
      userId,
      tenantId,
      scopes,
      plan,
      createdAt,
      lastUsedAt: null,
      expiresAt,
      revokedAt: null,
      rateLimitPerMinute,
      createdBy,
      replacedBy: null,
    };

    this.repository.insert(record);
    this.repository.audit({
      eventId: this.idFactory(),
      event: "created",
      keyId: record.id,
      userId: record.userId,
      tenantId: record.tenantId,
      occurredAt: createdAt,
    });

    return {
      id: record.id,
      key: rawKey,
      keyPrefix: record.keyPrefix,
      name: record.name,
      scopes: [...record.scopes],
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    };
  }

  validate(rawKey: string, traceId?: string): NativePrincipal | null {
    const parsed = parseRawKey(rawKey);
    if (!parsed) return null;

    const record = this.repository.findById(parsed.id);
    if (!record || record.version !== KEY_VERSION) return null;

    const candidateDigest = digestKey(rawKey, this.pepper);
    if (!secureEqualDigest(record.keyDigest, candidateDigest)) {
      this.repository.audit({
        eventId: this.idFactory(),
        event: "validation_failed",
        keyId: record.id,
        userId: null,
        tenantId: null,
        occurredAt: nowIso(this.now),
        traceId,
        reasonCode: "DIGEST_MISMATCH",
      });
      return null;
    }

    const currentTime = this.now();
    if (statusOf(record, currentTime) !== "active") {
      return null;
    }

    const lastUsedTime = record.lastUsedAt ? Date.parse(record.lastUsedAt) : NaN;
    if (
      !Number.isFinite(lastUsedTime) ||
      currentTime - lastUsedTime >= LAST_USED_WRITE_INTERVAL_MS
    ) {
      this.repository.markUsed(record.id, new Date(currentTime).toISOString());
    }

    if (this.auditValidationSuccess) {
      this.repository.audit({
        eventId: this.idFactory(),
        event: "validated",
        keyId: record.id,
        userId: record.userId,
        tenantId: record.tenantId,
        occurredAt: nowIso(this.now),
        traceId,
      });
    }

    return principalFor(record);
  }

  list(userId: string, tenantId: string): SafeApiKeyRecord[] {
    const owner = assertText(userId, "userId", 160);
    const tenant = assertText(tenantId, "tenantId", 160);
    return this.repository.listByOwner(owner, tenant).map(({ keyDigest: _keyDigest, ...safe }) => ({
      ...safe,
      scopes: [...safe.scopes],
    }));
  }

  revoke(keyId: string, userId: string, tenantId: string): boolean {
    const id = assertText(keyId, "keyId", 100);
    const owner = assertText(userId, "userId", 160);
    const tenant = assertText(tenantId, "tenantId", 160);
    const occurredAt = nowIso(this.now);
    const changed = this.repository.revoke(id, owner, tenant, occurredAt);

    if (changed) {
      this.repository.audit({
        eventId: this.idFactory(),
        event: "revoked",
        keyId: id,
        userId: owner,
        tenantId: tenant,
        occurredAt,
      });
    }
    return changed;
  }

  rotate(keyId: string, userId: string, tenantId: string): ApiKeyCreatedResponse | null {
    const id = assertText(keyId, "keyId", 100);
    const owner = assertText(userId, "userId", 160);
    const tenant = assertText(tenantId, "tenantId", 160);

    return this.repository.transaction(() => {
      const old = this.repository.findById(id);
      if (
        !old ||
        old.userId !== owner ||
        old.tenantId !== tenant ||
        statusOf(old, this.now()) !== "active"
      ) {
        return null;
      }

      const remainingDays = old.expiresAt
        ? Math.ceil((Date.parse(old.expiresAt) - this.now()) / 86_400_000)
        : undefined;

      const next = this.create({
        name: old.name,
        userId: old.userId,
        tenantId: old.tenantId,
        createdBy: owner,
        scopes: old.scopes,
        plan: old.plan,
        rateLimitPerMinute: old.rateLimitPerMinute,
        expiresInDays: remainingDays && remainingDays > 0 ? remainingDays : undefined,
      });

      const revoked = this.repository.revoke(old.id, owner, tenant, nowIso(this.now), next.id);

      if (!revoked) {
        throw new ApiKeyServiceError("rotation_revoke_failed", 500);
      }

      this.repository.audit({
        eventId: this.idFactory(),
        event: "rotated",
        keyId: old.id,
        userId: owner,
        tenantId: tenant,
        occurredAt: nowIso(this.now),
        reasonCode: `REPLACED_BY:${next.id}`,
      });

      return next;
    });
  }

  /**
   * Prefer revoke for normal lifecycle operations. Permanent deletion should
   * be restricted to a retention/legal process and separately audited.
   */
  delete(keyId: string, userId: string, tenantId: string): boolean {
    const id = assertText(keyId, "keyId", 100);
    const owner = assertText(userId, "userId", 160);
    const tenant = assertText(tenantId, "tenantId", 160);
    const deleted = this.repository.delete(id, owner, tenant);

    if (deleted) {
      this.repository.audit({
        eventId: this.idFactory(),
        event: "deleted",
        keyId: id,
        userId: owner,
        tenantId: tenant,
        occurredAt: nowIso(this.now),
        reasonCode: "EXPLICIT_LIFECYCLE_DELETE",
      });
    }
    return deleted;
  }
}

/* ========================================================================== *
 * Optional compatibility facade
 * ========================================================================== *
 * Configure the repository and pepper explicitly before using this facade.
 * It intentionally throws instead of silently falling back to memory.
 */

let configuredService: ApiKeyService | null = null;

export const configureApiKeyService = (
  repository: ApiKeyRepository,
  options: ApiKeyServiceOptions = {},
): ApiKeyService => {
  configuredService = new ApiKeyService(repository, options);
  return configuredService;
};

const service = (): ApiKeyService => {
  if (!configuredService) {
    throw new ApiKeyServiceError("api_key_service_not_configured", 500);
  }
  return configuredService;
};

export const createApiKey = (request: ApiKeyCreateRequest) => service().create(request);
export const validateApiKey = (rawKey: string, traceId?: string) =>
  service().validate(rawKey, traceId);
export const listApiKeys = (userId: string, tenantId: string) => service().list(userId, tenantId);
export const revokeApiKey = (keyId: string, userId: string, tenantId: string) =>
  service().revoke(keyId, userId, tenantId);
export const rotateApiKey = (keyId: string, userId: string, tenantId: string) =>
  service().rotate(keyId, userId, tenantId);
export const deleteApiKey = (keyId: string, userId: string, tenantId: string) =>
  service().delete(keyId, userId, tenantId);
