import { Pool, PoolClient } from "pg";
import type { IRepository, AuditEntry, RepositoryError, WriteOptions } from "../repository";
import { config } from "../../config";

const TABLE_MAP: Record<string, string> = {
  tenant: "tenants",
  session: "sessions",
  apiKey: "api_keys",
  audit: "audit_events",
};

const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
function assertIdentifier(value: string, label: string): string {
  if (!SQL_IDENTIFIER.test(value)) throw toRepositoryError(`Invalid SQL ${label}`, 400);
  return value;
}

function toRepositoryError(message: string, statusCode = 500, tenantId?: string): RepositoryError {
  const err = new Error(message) as RepositoryError;
  err.code = "REPOSITORY_ERROR";
  err.statusCode = statusCode;
  if (tenantId !== undefined) err.tenantId = tenantId;
  err.retryable = statusCode >= 500;
  return err;
}

let pgPool: Pool | null = null;
export function sanitizeDatabaseUrl(raw: string): string {
  // Neon agrega channel_binding=require que node-postgres no entiende y hace fallar el Pool en 3ms con repository_unhealthy
  try {
    const u = new URL(raw);
    if (u.searchParams.has("channel_binding")) u.searchParams.delete("channel_binding");
    return u.toString();
  } catch {
    // Fallback sin URL parser: elimina channel_binding y limpia artefactos ? & &&
    let cleaned = raw.replace(/[?&]channel_binding=[^&]*/gi, "");
    cleaned = cleaned.replace(/\?&/g, "?").replace(/&&/g, "&").replace(/[?&]$/, "");
    // Si quedó "?&" intermedio o doble ?, normaliza
    cleaned = cleaned.replace(/\?&/g, "?");
    if (cleaned.includes("?") && cleaned.endsWith("&")) cleaned = cleaned.slice(0, -1);
    return cleaned;
  }
}
export function getPgPool(): Pool {
  if (!pgPool) {
    const rawUrl = config().DATABASE_URL;
    if (!rawUrl) throw toRepositoryError("DATABASE_URL not configured", 500);
    const url = sanitizeDatabaseUrl(rawUrl);
    // SSL obligatorio para Supabase/Neon/Vercel Postgres — sin esto SELECT 1 falla con repository_unhealthy
    const needsSsl = /supabase\.co|neon\.tech|\.pooler\.supabase\.com|sslmode=require/i.test(url);
    pgPool = new Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
      ssl: needsSsl ? { rejectUnauthorized: true } : undefined,
    });
    pgPool.on("error", (err) => console.error("Unexpected error on idle Postgres pool", err));
  }
  return pgPool;
}
export function _resetPgPoolForTests(): void {
  if (pgPool) {
    void pgPool.end().catch(() => undefined);
    pgPool = null;
  }
}

function toSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    out[assertIdentifier(toSnakeKey(key), "column")] = value;
  }
  return out;
}

function toPersistencePayload(
  type: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const payload = { ...data };
  if (type === "audit") {
    payload.action ??= payload.event;
    payload.resource ??= "";
    payload.actor ??= "";
    payload.result ??= "success";
  }
  return toSnake(payload);
}

function toCamel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row))
    out[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
  return out as T;
}

export class NeonRepository<T extends object> implements IRepository<T> {
  private readonly table: string;
  private readonly type: string;

  constructor(type: string) {
    this.type = type;
    this.table = assertIdentifier(TABLE_MAP[type] ?? type, "table");
  }

  async create(tenantId: string, data: Partial<T>, options?: WriteOptions): Promise<T> {
    if (!tenantId) throw toRepositoryError("tenantId required for create", 400);
    const pool = getPgPool();
    const row = toPersistencePayload(this.type, {
      ...(data as Record<string, unknown>),
      tenant_id: tenantId,
    });
    if (options?.idempotencyKey && !row.id) row.id = options.idempotencyKey;
    if (Object.keys(row).length === 0)
      throw toRepositoryError("create payload is empty", 400, tenantId);
    const columns = Object.keys(row).join(", ");
    const values = Object.values(row);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await pool.query(
      `INSERT INTO ${this.table} (${columns}) VALUES (${placeholders}) RETURNING *`,
      values,
    );
    if (!rows[0]) throw toRepositoryError("Postgres insert returned no row", 500, tenantId);
    return toCamel<T>(rows[0]);
  }

  async read(tenantId: string, id: string): Promise<T | null> {
    if (!tenantId) throw toRepositoryError("tenantId required for read", 400);
    const { rows } = await getPgPool().query(
      `SELECT * FROM ${this.table} WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, tenantId],
    );
    return rows[0] ? toCamel<T>(rows[0]) : null;
  }

  async list(
    tenantId: string,
    filters?: Record<string, unknown>,
    limit?: number,
    offset?: number,
  ): Promise<{ items: T[]; total: number }> {
    if (!tenantId) throw toRepositoryError("tenantId required for list", 400);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0 || limit > 10_000))
      throw toRepositoryError("invalid limit", 400, tenantId);
    if (offset !== undefined && (!Number.isInteger(offset) || offset < 0))
      throw toRepositoryError("invalid offset", 400, tenantId);

    const pool = getPgPool();
    let where = "WHERE tenant_id = $1";
    const params: unknown[] = [tenantId];
    let index = 2;
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value === undefined) continue;
        const column = assertIdentifier(toSnakeKey(key), "filter column");
        where += ` AND ${column} = $${index++}`;
        params.push(value);
      }
    }
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM ${this.table} ${where}`,
      params,
    );
    const total = Number.parseInt(String(countRows[0]?.count ?? "0"), 10);
    const orderColumn = this.type === "audit" ? "timestamp" : "created_at";
    let query = `SELECT * FROM ${this.table} ${where} ORDER BY ${orderColumn} DESC`;
    if (limit !== undefined) {
      query += ` LIMIT $${index++}`;
      params.push(limit);
    }
    if (offset !== undefined) {
      query += ` OFFSET $${index++}`;
      params.push(offset);
    }
    const { rows } = await pool.query(query, params);
    return { items: rows.map(toCamel<T>), total };
  }

  async update(tenantId: string, id: string, data: Partial<T>): Promise<T> {
    if (!tenantId) throw toRepositoryError("tenantId required for update", 400);
    const row = toPersistencePayload(this.type, data as Record<string, unknown>);
    if (Object.keys(row).length === 0)
      throw toRepositoryError("update payload is empty", 400, tenantId);
    const sets = Object.keys(row)
      .map((key, i) => `${key} = $${i + 3}`)
      .join(", ");
    const values = [id, tenantId, ...Object.values(row)];
    const { rows } = await getPgPool().query(
      `UPDATE ${this.table} SET ${sets} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      values,
    );
    if (!rows[0]) throw toRepositoryError(`Record ${id} not found`, 404, tenantId);
    return toCamel<T>(rows[0]);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    if (!tenantId) throw toRepositoryError("tenantId required for delete", 400);
    const { rowCount } = await getPgPool().query(
      `DELETE FROM ${this.table} WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Durable, per-tenant serialized audit append. */
  async audit(entry: AuditEntry): Promise<void> {
    const pool = getPgPool();
    const { createHash, randomUUID } = await import("node:crypto");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [entry.tenantId]);
      const { rows: lastRows } = await client.query(
        `SELECT verification_hash FROM audit_events WHERE tenant_id = $1 ORDER BY timestamp DESC, id DESC LIMIT 1 FOR UPDATE`,
        [entry.tenantId],
      );
      const previousLogHash = String(lastRows[0]?.verification_hash ?? "0".repeat(64));
      const timestamp = entry.timestamp ?? new Date().toISOString();
      const id = entry.id ?? `audit_${randomUUID().slice(0, 8)}`;
      const details = JSON.stringify(entry.details ?? {});
      const payload = `${id}|${timestamp}|${entry.traceId}|${entry.action}|${entry.resource}|${entry.actor}|${entry.result}|${details}|${entry.severity}|${entry.tenantId}|${previousLogHash}`;
      const verificationHash = createHash("sha256").update(payload).digest("hex");
      await client.query(
        `INSERT INTO audit_events
          (id, tenant_id, trace_id, correlation_id, actor_ip, actor, action, resource, event, severity, result, details, remediated, verification_hash, previous_log_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id,
          entry.tenantId,
          entry.traceId,
          entry.traceId,
          "",
          entry.actor,
          entry.action,
          entry.resource,
          entry.action,
          entry.severity,
          entry.result,
          details,
          false,
          verificationHash,
          previousLogHash,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = performance.now();
    try {
      await getPgPool().query("SELECT 1");
      return { ok: true, latencyMs: performance.now() - start };
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
      console.error(`[NeonRepository:${this.type}] health check failed:`, msg);
      return { ok: false, latencyMs: performance.now() - start, error: msg };
    }
  }

  async findByPrefix(prefix: string): Promise<T | null> {
    const { rows } = await getPgPool().query(
      `SELECT * FROM ${this.table} WHERE COALESCE(key_prefix, prefix) = $1 LIMIT 1`,
      [prefix],
    );
    return rows[0] ? toCamel<T>(rows[0]) : null;
  }

  async withTransaction<R>(fn: (client: PoolClient) => Promise<R>): Promise<R> {
    const client = await getPgPool().connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
