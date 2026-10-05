import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IRepository, AuditEntry, RepositoryError, WriteOptions } from "../repository";
import { config } from "../../config";
import { getRequestIdentity } from "../../identity-context";
import { SecuritySystem } from "../../security";

const TABLE_MAP: Record<string, string> = {
  tenant: "tenants",
  session: "sessions",
  apiKey: "api_keys",
  audit: "audit_events",
};

function toRepositoryError(message: string, statusCode = 500, tenantId?: string): RepositoryError {
  const err = new Error(message) as RepositoryError;
  err.code = "REPOSITORY_ERROR";
  err.statusCode = statusCode;
  if (tenantId !== undefined) err.tenantId = tenantId;
  err.retryable = statusCode >= 500;
  return err;
}

function toSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Cliente Supabase con la identidad del request (tenant-scoped, RLS).
 * P0-13: NUNCA usa service_role. Si hay principal autenticado, se reemite un
 * JWT firmado HS256 con `SUPABASE_JWT_SECRET` (Legacy JWT Secret de Supabase,
 * no `AUTH_JWT_SECRET`) para que PostgREST pueble `request.jwt.claims` con
 * tenantId/role y RLS aplique.
 * Sin identidad devuelve `null` (fail-closed; solo diagnóstico puede usar anon).
 */
async function getSupabase(): Promise<SupabaseClient | null> {
  const cfg = config();
  const url = cfg.SUPABASE_URL;
  if (!url) return null;
  const identity = getRequestIdentity();
  if (!identity) return null;
  const jwt = SecuritySystem.generateSupabaseRlsToken(
    identity.userId,
    identity.tenantId,
    identity.scope,
  );
  return toSupabaseClient(url, jwt);
}

async function requireSupabase(tenantId?: string): Promise<SupabaseClient> {
  const client = await getSupabase();
  if (!client) {
    throw toRepositoryError(
      "Supabase require identidad de request (tenant-scoped) para operaciones RLS — sin principal autenticado; service_role prohibido (P0-13)",
      500,
      tenantId,
    );
  }
  return client;
}

export class SupabaseRepository<T extends { id: string }> implements IRepository<T> {
  private readonly table: string;
  private readonly type: string;

  constructor(type: string) {
    this.type = type;
    this.table = TABLE_MAP[type] ?? type;
  }

  async create(tenantId: string, data: Partial<T>, options?: WriteOptions): Promise<T> {
    if (!tenantId) throw toRepositoryError("tenantId required for create", 400);
    const supabase = await requireSupabase(tenantId);
    const payload = {
      ...data,
      tenant_id: tenantId,
      tenantId: undefined,
    } as Record<string, unknown>;
    // Map camelCase to snake_case for known fields
    const row = toSnake(payload);
    if (options?.idempotencyKey) {
      // Use idempotency key as id if provided and no id set
      if (!row.id) row.id = options.idempotencyKey;
    }
    const { data: inserted, error } = await supabase.from(this.table).insert(row).select().single();
    if (error) throw toRepositoryError(`Supabase insert failed: ${error.message}`, 500, tenantId);
    return toCamel<T>(inserted);
  }

  async read(tenantId: string, id: string): Promise<T | null> {
    if (!tenantId) throw toRepositoryError("tenantId required for read", 400);
    const supabase = await requireSupabase(tenantId);
    const { data, error } = await supabase
      .from(this.table)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw toRepositoryError(`Supabase read failed: ${error.message}`, 500, tenantId);
    return data ? toCamel<T>(data) : null;
  }

  async list(
    tenantId: string,
    filters?: Record<string, unknown>,
    limit?: number,
    offset?: number,
  ): Promise<{ items: T[]; total: number }> {
    if (!tenantId) throw toRepositoryError("tenantId required for list", 400);
    const supabase = await requireSupabase(tenantId);
    let query = supabase.from(this.table).select("*", { count: "exact" }).eq("tenant_id", tenantId);
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        const col = toSnakeKey(k);
        if (v !== undefined) query = query.eq(col, v as string);
      }
    }
    if (offset !== undefined) query = query.range(offset, offset + (limit ?? 50) - 1);
    else if (limit !== undefined) query = query.limit(limit);
    const { data, error, count } = await query;
    if (error) throw toRepositoryError(`Supabase list failed: ${error.message}`, 500, tenantId);
    const items = (data ?? []).map(toCamel<T>);
    return { items, total: count ?? items.length };
  }

  async update(tenantId: string, id: string, data: Partial<T>): Promise<T> {
    if (!tenantId) throw toRepositoryError("tenantId required for update", 400);
    const supabase = await requireSupabase(tenantId);
    const row = toSnake(data as Record<string, unknown>);
    const { data: updated, error } = await supabase
      .from(this.table)
      .update(row)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select()
      .single();
    if (error) throw toRepositoryError(`Supabase update failed: ${error.message}`, 500, tenantId);
    if (!updated) throw toRepositoryError(`Record ${id} not found`, 404, tenantId);
    return toCamel<T>(updated);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    if (!tenantId) throw toRepositoryError("tenantId required for delete", 400);
    const supabase = await requireSupabase(tenantId);
    const { error, count } = await supabase
      .from(this.table)
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw toRepositoryError(`Supabase delete failed: ${error.message}`, 500, tenantId);
    return (count ?? 0) > 0;
  }

  async audit(entry: AuditEntry): Promise<void> {
    const supabase = await requireSupabase(entry.tenantId);
    // P0-06: la columna canónica es `event` (no `action`), y la auditoría
    // transaccional exige verification_hash + previous_log_hash (hash chaining).
    const { createHash, randomUUID } = await import("node:crypto");
    const { data: lastRow } = await supabase
      .from("audit_events")
      .select("verification_hash")
      .eq("tenant_id", entry.tenantId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    const previousLogHash = (lastRow?.verification_hash as string) ?? "0".repeat(64);
    const timestamp = entry.timestamp ?? new Date().toISOString();
    const details = JSON.stringify(entry.details ?? {});
    const payload = `${entry.id}|${timestamp}|${entry.traceId}|${entry.action}|${entry.resource}|${entry.actor}|${entry.result}|${details}|${entry.severity}|${entry.tenantId}|${previousLogHash}`;
    const verificationHash = createHash("sha256").update(payload).digest("hex");
    const { error } = await supabase.from("audit_events").insert({
      id: entry.id ?? `audit_${randomUUID().slice(0, 8)}`,
      tenant_id: entry.tenantId,
      trace_id: entry.traceId,
      correlation_id: entry.traceId,
      actor_ip: "",
      event: entry.action,
      severity: entry.severity,
      details,
      remediated: false,
      verification_hash: verificationHash,
      previous_log_hash: previousLogHash,
    });
    if (error)
      throw toRepositoryError(`Supabase audit failed: ${error.message}`, 500, entry.tenantId);
  }

  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = performance.now();
    try {
      const supabase = await getSupabase();
      if (!supabase) return { ok: false, latencyMs: performance.now() - start };
      const { error } = await supabase.from(this.table).select("id").limit(1);
      return { ok: !error, latencyMs: performance.now() - start };
    } catch {
      return { ok: false, latencyMs: performance.now() - start };
    }
  }

  // Specialized lookup for API keys by prefix — avoids generic list for auth, tenant-agnostic then hash-verify
  // P0-04: la columna canónica en api_keys es `prefix`, no `key_prefix`.
  async findByPrefix(prefix: string): Promise<T | null> {
    const supabase = (await getSupabase()) ?? (await requireSupabase());
    const { data, error } = await supabase
      .from(this.table)
      .select("*")
      .eq("prefix", prefix)
      .maybeSingle();
    if (error) throw toRepositoryError(`Supabase findByPrefix failed: ${error.message}`, 500);
    return data ? toCamel<T>(data) : null;
  }
}

// Helpers: camelCase <-> snake_case
function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[toSnakeKey(k)] = v;
  }
  return out;
}
function toSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
function toCamel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[toCamelKey(k)] = v;
  }
  return out as T;
}
function toCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
