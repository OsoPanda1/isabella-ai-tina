/**
 * PostgreSQL Persistence Manager (src/lib/persistence/postgres.ts)
 * -------------------------------------------------------------
 * Provides connection pooling, migration runner, and health checks
 * for PostgreSQL / Neon / Supabase database authorities.
 */
import pg from "pg";
import { config } from "../config";

let pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool | null {
  if (pool) return pool;
  const connectionString = config().DATABASE_URL;
  if (!connectionString) return null;

  try {
    pool = new pg.Pool({
      connectionString,
      ssl:
        connectionString.includes("sslmode=require") ||
        connectionString.includes("neon.tech") ||
        connectionString.includes("supabase.co")
          ? { rejectUnauthorized: true }
          : undefined,
      max: 10,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
    return pool;
  } catch (err) {
    console.error("[Postgres] Failed to initialize pool:", err);
    return null;
  }
}

export async function runPostgresMigration(sql: string): Promise<boolean> {
  const p = getPgPool();
  if (!p) return false;
  try {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[Postgres] Migration error:", err);
    return false;
  }
}

export async function pgHealthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const p = getPgPool();
  if (!p) {
    return { ok: false, error: "DATABASE_URL_NOT_CONFIGURED" };
  }
  const start = Date.now();
  try {
    const res = await p.query("SELECT 1 as alive");
    return { ok: res.rows.length > 0, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}

export default { getPgPool, runPostgresMigration, pgHealthCheck };
