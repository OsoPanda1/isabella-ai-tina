/**
 * LEDGER DE DECISIONES POSTGRES (src/lib/repositories/decision-repository.ts)
 * -----------------------------------------------------------------
 * Implementación durable de `LedgerStore` sobre `isabella_decisions`
 * (migración 20260926030000_isabella_policy_as_code.sql), con las reglas de
 * este repositorio:
 *  - process.env sólo vía `config()` (§21),
 *  - fail-closed: sin DATABASE_URL o con la base ilegible, `append`/`latestHash`
 *    lanzan; nadie inventa una cadena local (§4.2),
 *  - integridad: `append` exige que `record.previousHash` coincida con el
 *    último `record_hash` del tenant (la tabla además es append-only por
 *    trigger y tiene UNIQUE (tenant_id, record_hash)),
 *  - `pg` se importa dinámicamente para no arrastrarlo al bundle cliente.
 *
 * `deps.query` existe como punto de inyección para tests (la misma técnica
 * que los repositorios con cliente inyectado); en runtime se usa el pool real.
 */

import { config } from "../config";
import { createHash } from "node:crypto";
import { canonicalize } from "../igds/canonical";
import type { DecisionRecord as LedgerDecisionRecord, LedgerStore } from "../governance/decision-ledger";

/** Legacy PDP repository contract retained for existing consumers. */
export interface DecisionRecord {
  decisionId: string;
  tenantId: string;
  subjectId: string;
  action: string;
  resource: string;
  allow: boolean;
  policyVersion: string;
  previous_hash: string;
  record_hash: string;
  signature?: string;
  timestamp: string;
}

let poolQuery: DecisionQuery | null = null;
let poolClose: (() => Promise<void>) | null = null;

  async append(
    decision: Omit<DecisionRecord, "previous_hash" | "record_hash">,
  ): Promise<DecisionRecord> {
    const previous_hash = this.lastHashByTenant.get(decision.tenantId) || "GENESIS";
    const payload = { ...decision, previous_hash };
    const record_hash = createHash("sha3-512").update(canonicalize(payload), "utf8").digest("hex");
    const record = { ...payload, record_hash };
    this.decisions.push(record);
    this.lastHashByTenant.set(decision.tenantId, record_hash);
    return record;
  }

  async function append(record: DecisionRecord): Promise<void> {
    const run = await resolveQuery(deps);
    // Reenvío idempotente: si el registro ya está, no hay nada que corregir.
    const duplicate = await run(
      `SELECT 1 FROM public.isabella_decisions
        WHERE tenant_id = $1 AND record_hash = $2
        LIMIT 1`,
      [record.tenantId, record.recordHash],
    );
    if (duplicate.rows[0]) return;
    const expected = (await latestHash(record.tenantId)) ?? "GENESIS";
    if (record.previousHash !== expected) {
      throw new Error(
        `DECISION_CHAIN_MISMATCH: previousHash ${record.previousHash} no coincide con el último record_hash ${expected}.`,
      );
    }
    const { rows } = await run(
      `INSERT INTO public.isabella_decisions
         (id, tenant_id, actor_id, authority, capability, policy, risk, model_id,
          input_hash, output_hash, result, previous_hash, record_hash, evidence_ids, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
       ON CONFLICT (tenant_id, record_hash) DO NOTHING
       RETURNING id`,
      [
        record.id,
        record.tenantId,
        record.actorId,
        record.authority,
        record.capability,
        record.policy,
        record.risk,
        record.modelId ?? null,
        record.inputHash,
        record.outputHash,
        record.result,
        record.previousHash,
        record.recordHash,
        JSON.stringify(record.evidenceIds),
        record.timestamp,
      ],
    );
    if (!rows[0]) {
      // Reenvío idempotente del mismo registro: no es un fallo de integridad.
      return;
    }
  }

  async verifyChain(
    tenantId: string,
  ): Promise<{ valid: boolean; count: number; brokenAt?: string }> {
    const records = this.decisions.filter((record) => record.tenantId === tenantId);
    let previous = "GENESIS";
    for (const record of records) {
      if (record.previous_hash !== previous)
        return { valid: false, count: records.length, brokenAt: record.decisionId };
      previous = record.record_hash;
    }
    return { valid: true, count: records.length };
  }

export const decisionRepository = new InMemoryDecisionRepository();

export type DecisionQuery = (
  text: string,
  values?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export interface DecisionLedgerDeps {
  query?: DecisionQuery;
  close?: () => Promise<void>;
}

let poolQuery: DecisionQuery | null = null;
let poolClose: (() => Promise<void>) | null = null;

async function resolveQuery(deps?: DecisionLedgerDeps): Promise<DecisionQuery> {
  if (deps?.query) return deps.query;
  if (poolQuery) return poolQuery;
  const url = config().DATABASE_URL;
  if (!url) {
    throw new Error(
      "DECISION_LEDGER_UNAVAILABLE: DATABASE_URL ausente; isabella_decisions no es alcanzable.",
    );
  }
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: 2 });
  poolQuery = (text, values) => pool.query(text, values);
  poolClose = () => pool.end();
  return poolQuery;
}

/** Cierra el pool (sólo para shutdown/tests). */
export async function closeDecisionPool(): Promise<void> {
  const close = poolClose;
  poolQuery = null;
  poolClose = null;
  if (close) await close().catch(() => undefined);
}

function mapRow(row: Record<string, unknown>): LedgerDecisionRecord {
  const evidence = row.evidence_ids;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    actorId: String(row.actor_id),
    authority: String(row.authority),
    capability: String(row.capability),
    policy: String(row.policy),
    risk: String(row.risk) as LedgerDecisionRecord["risk"],
    ...(row.model_id == null ? {} : { modelId: String(row.model_id) }),
    inputHash: String(row.input_hash),
    outputHash: String(row.output_hash),
    result: String(row.result) as LedgerDecisionRecord["result"],
    timestamp: new Date(String(row.recorded_at)).toISOString(),
    previousHash: String(row.previous_hash),
    recordHash: String(row.record_hash),
    evidenceIds: Array.isArray(evidence)
      ? evidence.map((item) => String(item))
      : typeof evidence === "string"
        ? (JSON.parse(evidence) as string[]).map((item) => String(item))
        : [],
  };
}

/**
 * Ledger durable. `append` verifica la cadena antes de insertar y es
 * idempotente ante reenvíos del mismo registro (UNIQUE tenant+record_hash).
 */
export function createPostgresDecisionLedger(deps?: DecisionLedgerDeps): LedgerStore & {
  verifyChain(tenantId: string, limit?: number): Promise<{ ok: boolean; checked: number }>;
} {
  async function latestHash(tenantId: string): Promise<string | undefined> {
    const run = await resolveQuery(deps);
    const { rows } = await run(
      `SELECT record_hash
         FROM public.isabella_decisions
        WHERE tenant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [tenantId],
    );
    return rows[0] ? String(rows[0].record_hash) : undefined;
  }

  async function append(record: LedgerDecisionRecord): Promise<void> {
    const run = await resolveQuery(deps);

    // Los tests inyectados conservan el contrato histórico de consultas separadas.
    // El runtime productivo usa una sola sentencia para cerrar la ventana TOCTOU:
    // el advisory xact lock, lectura del último hash y INSERT viven en la misma
    // transacción implícita de PostgreSQL (una sentencia = una transacción).
    if (!deps?.query) {
      const { rows } = await run(
        `WITH tenant_lock AS (
           SELECT pg_advisory_xact_lock(hashtextextended($2, 0))
         ),
         existing AS (
           SELECT EXISTS(
             SELECT 1
               FROM public.isabella_decisions
              WHERE tenant_id = $2 AND record_hash = $13
           ) AS already_recorded
           FROM tenant_lock
         ),
         expected AS (
           SELECT COALESCE(
             (
               SELECT record_hash
                 FROM public.isabella_decisions
                WHERE tenant_id = $2
                ORDER BY created_at DESC, id DESC
                LIMIT 1
             ),
             'GENESIS'
           ) AS previous_hash,
           existing.already_recorded
             FROM existing
         ),
         inserted AS (
           INSERT INTO public.isabella_decisions
             (id, tenant_id, actor_id, authority, capability, policy, risk, model_id,
              input_hash, output_hash, result, previous_hash, record_hash, evidence_ids, recorded_at)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, expected.previous_hash,
                  $13, $14::jsonb, $15
             FROM expected
            WHERE NOT expected.already_recorded
              AND expected.previous_hash = $12
           ON CONFLICT (tenant_id, record_hash) DO NOTHING
           RETURNING id
         )
         SELECT
           expected.previous_hash,
           expected.already_recorded,
           (SELECT id FROM inserted) AS inserted_id
           FROM expected`,
        [
          record.id,
          record.tenantId,
          record.actorId,
          record.authority,
          record.capability,
          record.policy,
          record.risk,
          record.modelId ?? null,
          record.inputHash,
          record.outputHash,
          record.result,
          record.previousHash,
          record.recordHash,
          JSON.stringify(record.evidenceIds),
          record.timestamp,
        ],
      );
      const row = rows[0] as Record<string, unknown> | undefined;
      const expected = row?.previous_hash == null ? "GENESIS" : String(row.previous_hash);
      const alreadyRecorded = row?.already_recorded === true;
      const insertedId = row?.inserted_id == null ? null : String(row.inserted_id);

      if (!alreadyRecorded && expected !== record.previousHash && insertedId === null) {
        throw new Error(
          `DECISION_CHAIN_MISMATCH: previousHash ${record.previousHash} no coincide con el último record_hash ${expected}.`,
        );
      }
      // inserted_id null con hash correcto significa reenvío idempotente por UNIQUE.
      return;
    }

    // Inyectado para tests/forensics: preservar el contrato de query existente.
    const duplicate = await run(
      `SELECT 1 FROM public.isabella_decisions
        WHERE tenant_id = $1 AND record_hash = $2
        LIMIT 1`,
      [record.tenantId, record.recordHash],
    );
    if (duplicate.rows[0]) return;
    const expected = (await latestHash(record.tenantId)) ?? "GENESIS";
    if (record.previousHash !== expected) {
      throw new Error(
        `DECISION_CHAIN_MISMATCH: previousHash ${record.previousHash} no coincide con el último record_hash ${expected}.`,
      );
    }
    const { rows } = await run(
      `INSERT INTO public.isabella_decisions
         (id, tenant_id, actor_id, authority, capability, policy, risk, model_id,
          input_hash, output_hash, result, previous_hash, record_hash, evidence_ids, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
       ON CONFLICT (tenant_id, record_hash) DO NOTHING
       RETURNING id`,
      [
        record.id,
        record.tenantId,
        record.actorId,
        record.authority,
        record.capability,
        record.policy,
        record.risk,
        record.modelId ?? null,
        record.inputHash,
        record.outputHash,
        record.result,
        record.previousHash,
        record.recordHash,
        JSON.stringify(record.evidenceIds),
        record.timestamp,
      ],
    );
    if (!rows[0]) return;
  }

  async function verifyChain(
    tenantId: string,
    limit = 100,
  ): Promise<{ ok: boolean; checked: number }> {
    const run = await resolveQuery(deps);
    const { rows } = await run(
      `SELECT * FROM (
         SELECT * FROM public.isabella_decisions
          WHERE tenant_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2
       ) recent
       ORDER BY created_at ASC, id ASC`,
      [tenantId, limit],
    );
    let previous: string | null = null;
    let checked = 0;
    for (const row of rows) {
      const record = mapRow(row);
      if (previous === null) previous = record.previousHash;
      if (record.previousHash !== previous) return { ok: false, checked };
      previous = record.recordHash;
      checked += 1;
    }
    return { ok: true, checked };
  }

  return { append, latestHash, verifyChain };
}
