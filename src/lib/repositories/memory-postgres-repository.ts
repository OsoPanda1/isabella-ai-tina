import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { config } from "../config";
import type {
  MemoryRecord,
  MemoryRepository,
  MemoryScope,
  MemorySensitivity,
  MemorySource,
} from "./memory-repository";

const GENESIS_HASH = "0".repeat(64);
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const dsn = config().DATABASE_URL;
    if (!dsn) throw new Error("DATABASE_URL is required for PostgreSQL memory persistence");
    pool = new Pool({
      connectionString: dsn,
      max: 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
    });
  }
  return pool;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function contentHash(input: {
  id: string;
  tenantId: string;
  content: string;
  source: MemorySource;
  scope: MemoryScope;
  sensitivity: MemorySensitivity;
}): string {
  return sha256(
    `${input.id}|${input.tenantId}|${input.content}|${input.source}|${input.scope}|${input.sensitivity}`,
  );
}

function chainHash(previous: string, contentDigest: string): string {
  return sha256(`${previous}|${contentDigest}`);
}

function normalizeIso(value: unknown): string {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid memory timestamp");
  return date.toISOString();
}

function mapScope(value: unknown): MemoryScope {
  const scope = String(value).toLowerCase();
  if (
    scope === "turn" ||
    scope === "session" ||
    scope === "project" ||
    scope === "territorial" ||
    scope === "historical"
  )
    return scope;
  throw new Error(`Unsupported memory scope: ${scope}`);
}

function mapSensitivity(value: unknown): MemorySensitivity {
  const sensitivity = String(value).toLowerCase();
  if (
    sensitivity === "public" ||
    sensitivity === "internal" ||
    sensitivity === "personal" ||
    sensitivity === "restricted"
  )
    return sensitivity;
  throw new Error(`Unsupported memory sensitivity: ${sensitivity}`);
}

function mapSource(value: unknown): MemorySource {
  const source = String(value).toLowerCase();
  if (source === "user" || source === "system" || source === "tool" || source === "document")
    return source;
  return "system";
}

function mapRow(row: Record<string, unknown>): MemoryRecord {
  const source = mapSource(row.source);
  const scope = mapScope(row.scope);
  const sensitivity = mapSensitivity(row.sensitivity);
  const record: MemoryRecord = {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    content: String(row.content),
    source,
    scope,
    sensitivity,
    purpose: String(row.purpose ?? ""),
    consentRequired: Boolean(row.consent_required),
    consentGranted: Boolean(row.consent),
    createdAt: normalizeIso(row.created_at),
    deletable: true,
    provenance: String(row.provenance ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    contentHash: String(row.content_hash ?? ""),
    chainHash: String(row.chain_hash ?? GENESIS_HASH),
    previousChainHash: String(row.previous_chain_hash ?? GENESIS_HASH),
  };
  if (row.user_id) record.ownerId = String(row.user_id);
  if (row.expires_at) record.expiresAt = normalizeIso(row.expires_at);
  return record;
}

function validateInput(input: Parameters<MemoryRepository["add"]>[0]): string | null {
  if (!input.tenantId) return "tenantId requerido.";
  if (!input.content.trim()) return "Contenido de memoria vacío.";
  if (!input.purpose.trim()) return "Purpose de memoria requerido.";
  if (input.consentRequired && !input.consentGranted)
    return "Consentimiento requerido para esta memoria.";
  if ((input.sensitivity === "personal" || input.sensitivity === "restricted") && !input.ownerId)
    return "ownerId requerido para memoria personal/restringida.";
  return null;
}

/** PostgreSQL authority for production memory. */
export function createMemoryPostgresRepository() {
  return {
    async add(input: Parameters<MemoryRepository["add"]>[0]) {
      const error = validateInput(input);
      if (error) return { success: false as const, error };
      const client = await getPool().connect();
      const id = `mem_${randomUUID()}`;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          input.tenantId,
        ]);
        const { rows: previousRows } = await client.query(
          `SELECT chain_hash FROM public.memories WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
          [input.tenantId],
        );
        const previousChainHash = String(previousRows[0]?.chain_hash ?? GENESIS_HASH);
        const digest = contentHash({
          id,
          tenantId: input.tenantId,
          content: input.content,
          source: input.source,
          scope: input.scope,
          sensitivity: input.sensitivity,
        });
        const nextChainHash = chainHash(previousChainHash, digest);
        const { rows } = await client.query(
          `INSERT INTO public.memories
            (id, tenant_id, user_id, content, scope, sensitivity, purpose, consent_required,
             consent, provenance, content_hash, previous_chain_hash, chain_hash, metadata, expires_at, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
           RETURNING *`,
          [
            id,
            input.tenantId,
            input.ownerId ?? null,
            input.content,
            input.scope,
            input.sensitivity,
            input.purpose,
            input.consentRequired,
            input.consentGranted,
            (input.provenance ?? []).join(","),
            digest,
            previousChainHash,
            nextChainHash,
            JSON.stringify({ source: input.source }),
            input.expiresAt ?? null,
            input.source,
          ],
        );
        await client.query("COMMIT");
        if (!rows[0]) return { success: false as const, error: "memory_insert_failed" };
        return { success: true as const, record: mapRow(rows[0]) };
      } catch {
        await client.query("ROLLBACK");
        // No exponer mensajes del driver/DB: pueden revelar tablas, SQL, hosts o constraints.
        return { success: false as const, error: "memory_insert_failed" };
      } finally {
        client.release();
      }
    },

    async list(tenantId: string, scope?: MemoryScope): Promise<MemoryRecord[]> {
      if (!tenantId) return [];
      const params: unknown[] = [tenantId];
      let query = `SELECT * FROM public.memories WHERE tenant_id = $1 AND (expires_at IS NULL OR expires_at >= NOW())`;
      if (scope) {
        query += " AND scope = $2";
        params.push(scope);
      }
      query += " ORDER BY created_at DESC, id DESC";
      const { rows } = await getPool().query(query, params);
      return rows.map(mapRow);
    },

    async prune(now = Date.now()) {
      const { rows } = await getPool().query(
        `DELETE FROM public.memories WHERE expires_at IS NOT NULL AND expires_at < $1 RETURNING id`,
        [new Date(now).toISOString()],
      );
      return { removed: rows.length };
    },

    async verifyIntegrity() {
      const { rows } = await getPool().query(
        `SELECT * FROM public.memories ORDER BY tenant_id, created_at ASC, id ASC`,
      );
      const previousByTenant = new Map<string, string>();
      for (const row of rows) {
        const mapped = mapRow(row);
        const expectedContentHash = contentHash(mapped);
        if (mapped.contentHash !== expectedContentHash)
          return {
            success: false,
            error: "Contenido de memoria alterado.",
            corruptedId: mapped.id,
          };
        const previous = previousByTenant.get(mapped.tenantId) ?? GENESIS_HASH;
        if (mapped.previousChainHash !== previous)
          return { success: false, error: "Cadena de memoria rota.", corruptedId: mapped.id };
        const expectedChain = chainHash(previous, expectedContentHash);
        if (mapped.chainHash !== expectedChain)
          return {
            success: false,
            error: "Hash de cadena de memoria inválido.",
            corruptedId: mapped.id,
          };
        previousByTenant.set(mapped.tenantId, mapped.chainHash);
      }
      return { success: true };
    },
  };
}

export type MemoryPostgresRepository = ReturnType<typeof createMemoryPostgresRepository>;
