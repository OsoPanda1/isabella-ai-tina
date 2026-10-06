import * as crypto from "node:crypto";
import { repositoryFactory } from "./persistence/repository-factory";
import type { ApiKey } from "./persistence/repository";
import { ApiKeyCrypto } from "./api-key-crypto";
import type { ApiKeyRecord } from "./credential-types";
import { config } from "./config";
import { createApiKeyPostgresRepository } from "./repositories/api-key-repository";

export interface ApiKeyMetadata {
  id: string;
  tenant_id: string;
  owner_id: string;
  name: string;
  prefix: string;
  role: string;
  scopes: string[];
  status: ApiKeyRecord["status"];
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
  revoked_at?: string;
  rotated_from?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
}

function recordToApiKey(r: ApiKeyRecord): Partial<ApiKey> {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    ownerId: r.owner_id,
    keyHash: r.key_hash,
    keyPrefix: r.prefix,
    name: r.name,
    secretHint: "",
    role: r.role,
    status: (r.status as ApiKey["status"]) ?? "active",
    scopes: r.scopes,
    createdAt: r.created_at,
    expiresAt: r.expires_at ?? null,
    rotatedAt: r.rotated_from ?? null,
    revokedAt: r.revoked_at ?? null,
    lastUsedAt: r.last_used_at ?? null,
    createdBy: r.created_by ?? "",
    metadata: r.metadata ?? {},
  };
}

function apiKeyToRecord(k: unknown): ApiKeyRecord {
  const kk = k as Record<string, unknown>;
  const prefix = String(kk.prefix ?? kk.keyPrefix ?? "");
  const keyHash = String(kk.key_hash ?? kk.keyHash ?? "");
  const record: ApiKeyRecord = {
    id: String(kk.id),
    tenant_id: String(kk.tenant_id ?? kk.tenantId),
    owner_id: String(kk.owner_id ?? kk.ownerId),
    name: String(kk.name),
    prefix,
    key_hash: keyHash,
    role: String(kk.role),
    scopes: (kk.scopes as string[]) ?? [],
    status: (kk.status as ApiKeyRecord["status"]) ?? "active",
    created_at: String(kk.created_at ?? kk.createdAt),
    metadata: (kk.metadata as Record<string, unknown>) ?? {},
  };
  const optional = {
    expires_at: kk.expires_at ?? kk.expiresAt,
    last_used_at: kk.last_used_at ?? kk.lastUsedAt,
    revoked_at: kk.revoked_at ?? kk.revokedAt,
    rotated_from: kk.rotated_from ?? kk.rotatedAt,
    created_by: kk.created_by ?? kk.createdBy,
  } as Record<string, unknown>;
  for (const key of Object.keys(optional)) {
    const value = optional[key];
    if (value !== undefined && value !== null) {
      (record as unknown as Record<string, unknown>)[key] = String(value);
    }
  }
  return record;
}

function toPublicMetadata(record: ApiKeyRecord): ApiKeyMetadata {
  const { key_hash: _secretHash, ...safe } = record;
  return safe;
}

function resolveCreationPrefix(): string {
  // Existing deployments may still expose the legacy default `isa_live`.
  // New credentials are always issued with the Isabella-owned `isk_live` format.
  const configured = config().API_KEY_PREFIX || "isk_live";
  return configured === "isa_live" ? "isk_live" : configured;
}

function validateScopes(scopes: string[]): void {
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    scopes.length > 64 ||
    scopes.some((scope) => !/^[a-z0-9:_-]{1,128}$/i.test(scope))
  ) {
    throw new Error("invalid_api_key_scopes");
  }
}

export class ApiKeyService {
  private static get repo() {
    return repositoryFactory.getApiKeyRepository();
  }
  private static get auditRepo() {
    return repositoryFactory.getAuditRepository();
  }

  public static async createApiKey(
    tenantId: string,
    ownerId: string,
    name: string,
    role: string,
    scopes: string[],
    expiresInSeconds?: number,
    createdBy?: string,
  ): Promise<{
    id: string;
    name: string;
    key: string;
    prefix: string;
    scopes: string[];
    expiresAt?: string;
  }> {
    if (!tenantId || !ownerId || !name.trim() || name.trim().length > 150) {
      throw new Error("invalid_api_key_request");
    }
    validateScopes(scopes);

    const cfg = config();
    if (
      expiresInSeconds !== undefined &&
      (!Number.isInteger(expiresInSeconds) ||
        expiresInSeconds <= 0 ||
        expiresInSeconds > cfg.API_KEY_MAX_TTL)
    ) {
      throw new Error("invalid_api_key_ttl");
    }

    const id = crypto.randomUUID();
    const prefix = `${resolveCreationPrefix()}_${ApiKeyCrypto.generatePrefix()}`;
    const secret = ApiKeyCrypto.generateSecret();
    const rawKey = `${prefix}_${secret}`;
    const keyHash = ApiKeyCrypto.hashSecret(rawKey);

    const ttl = expiresInSeconds !== undefined ? expiresInSeconds : cfg.API_KEY_DEFAULT_TTL;
    const expiresAt = ttl ? new Date(Date.now() + ttl * 1000).toISOString() : undefined;

    const record: ApiKeyRecord = {
      id,
      tenant_id: tenantId,
      owner_id: ownerId,
      name: name.trim(),
      prefix,
      key_hash: keyHash,
      role,
      scopes: [...new Set(scopes)],
      status: "active",
      created_at: new Date().toISOString(),
      ...(expiresAt ? { expires_at: expiresAt } : {}),
      ...(createdBy ? { created_by: createdBy } : {}),
    };

    await this.repo.create(tenantId, recordToApiKey(record));

    await this.auditRepo.audit({
      id: crypto.randomUUID(),
      tenantId,
      traceId: `trace_ak_${crypto.randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      action: "api_key.created",
      resource: "api_key",
      severity: "S3",
      actor: createdBy || ownerId,
      result: "success",
      details: { keyId: id, prefix, tenantId, scopes: record.scopes },
    });

    return {
      id,
      name: record.name,
      key: rawKey,
      prefix,
      scopes: record.scopes,
      ...(expiresAt ? { expiresAt } : {}),
    };
  }

  public static async verifyApiKey(rawKey: string): Promise<{
    success: boolean;
    record?: ApiKeyRecord;
    error?: string;
  }> {
    if (!rawKey || rawKey.length < 32 || rawKey.length > 512) {
      return { success: false, error: "invalid_credential" };
    }

    const parts = rawKey.split("_");
    if (parts.length < 4 || parts.some((part) => part.length === 0)) {
      return { success: false, error: "invalid_credential" };
    }

    const prefix = parts.slice(0, -1).join("_");
    if (
      !/^isk_(live|stage|test)_[A-Za-z0-9]+$/.test(prefix) &&
      !/^isa_(live|stage|test)_[A-Za-z0-9]+$/.test(prefix)
    ) {
      return { success: false, error: "invalid_credential" };
    }

    const cfg = config();
    const usePostgres = Boolean(cfg.DATABASE_URL);
    let record: ApiKeyRecord | null = null;

    if (usePostgres) {
      const pg = createApiKeyPostgresRepository();
      const row = await pg.findByPrefix(prefix);
      if (row) record = apiKeyToRecord(row);
    } else {
      const repoWithPrefix = this.repo as unknown as {
        findByPrefix?: (p: string) => Promise<unknown>;
      };
      if (repoWithPrefix.findByPrefix) {
        const r = await repoWithPrefix.findByPrefix(prefix);
        if (r) record = apiKeyToRecord(r);
      } else {
        // Sin lookup por prefijo NO hay forma segura de resolver la clave:
        // list("") sería un cruce de tenants. Fail-closed = credencial inválida.
        record = null;
      }
    }

    if (!record) return { success: false, error: "invalid_credential" };

    const signatureMatch = ApiKeyCrypto.verifySecret(rawKey, record.key_hash);
    if (!signatureMatch) return { success: false, error: "invalid_credential" };

    if (record.status !== "active") {
      return { success: false, error: `credential_${record.status}` };
    }

    if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) {
      if (usePostgres) {
        await createApiKeyPostgresRepository().updateStatus(record.id, "expired");
      } else {
        await this.repo.update(record.tenant_id, record.id, { status: "expired" });
      }
      return { success: false, error: "credential_expired" };
    }

    if (usePostgres) {
      await createApiKeyPostgresRepository().touchLastUsed(record.id);
    } else {
      await this.repo.update(record.tenant_id, record.id, {
        lastUsedAt: new Date().toISOString(),
      });
    }

    return { success: true, record };
  }

  public static async revokeApiKey(
    id: string,
    tenantId: string,
    actorId?: string,
  ): Promise<boolean> {
    const existing = await this.repo.read(tenantId, id);
    if (!existing) return false;

    await this.repo.update(tenantId, id, {
      status: "revoked",
      revokedAt: new Date().toISOString(),
    });

    await this.auditRepo.audit({
      id: crypto.randomUUID(),
      tenantId,
      traceId: `trace_ak_${crypto.randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      action: "api_key.revoked",
      resource: "api_key",
      severity: "S2",
      actor: actorId || existing.createdBy,
      result: "success",
      details: { keyId: id },
    });

    return true;
  }

  public static async rotateApiKey(
    id: string,
    tenantId: string,
    actorId?: string,
  ): Promise<{
    success: boolean;
    newKey?: {
      id: string;
      name: string;
      key: string;
      prefix: string;
      scopes: string[];
      expiresAt?: string;
    };
    error?: string;
  }> {
    const existing = await this.repo.read(tenantId, id);
    if (!existing) return { success: false, error: "Llave no encontrada." };

    const rec = apiKeyToRecord(existing);
    const remainingTtl = rec.expires_at
      ? Math.max(1, Math.floor((new Date(rec.expires_at).getTime() - Date.now()) / 1000))
      : undefined;
    await this.repo.update(tenantId, id, {
      status: "revoked",
      revokedAt: new Date().toISOString(),
    });

    const newKey = await this.createApiKey(
      tenantId,
      rec.owner_id,
      rec.name,
      rec.role,
      rec.scopes,
      remainingTtl,
      actorId,
    );
    await this.repo.update(tenantId, newKey.id, { rotatedAt: id });
    return { success: true, newKey };
  }

  public static async listApiKeys(tenantId: string): Promise<ApiKeyMetadata[]> {
    const { items } = await this.repo.list(tenantId, { tenantId });
    return items.map(apiKeyToRecord).map(toPublicMetadata);
  }

  public static async deleteApiKey(
    id: string,
    tenantId: string,
    actorId?: string,
  ): Promise<boolean> {
    if (!id.trim() || !tenantId.trim()) throw new Error("invalid_api_key_delete_request");
    const existing = await this.repo.read(tenantId, id);
    if (!existing) return false;

    const deleted = await this.repo.delete(tenantId, id);
    if (!deleted) return false;

    await this.auditRepo.audit({
      id: crypto.randomUUID(),
      tenantId,
      traceId: `trace_ak_${crypto.randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      action: "api_key.deleted",
      resource: "api_key",
      severity: "S2",
      actor: actorId || existing.createdBy,
      result: "success",
      details: { keyId: id },
    });
    return true;
  }
}
