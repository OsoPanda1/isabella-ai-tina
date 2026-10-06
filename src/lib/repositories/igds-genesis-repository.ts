/**
 * IGDS — Repositorio Postgres del registro Genesis
 * -----------------------------------------------------------------
 * Persistencia durable y append-only de sellos documentales. Reutiliza el
 * mismo cálculo de hash canónico que el registro en memoria, de modo que una
 * entrada sellada offline puede cotejarse contra la cadena persistida.
 *
 * Concurrencia: cada append toma un advisory lock transaccional para asignar
 * `sequence` y `previous_entry_hash` de forma estricta.
 */
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import {
  GENESIS_PREVIOUS_HASH,
  computeEntryHash,
  type AppendRevocationInput,
  type AppendSealInput,
  type GenesisRegistry,
} from "../igds";
import type {
  GenesisCheckpoint,
  GenesisEntry,
  GenesisEntryType,
  GenesisRevocationPayload,
} from "../igds";
import type { SignatureEnvelope } from "../igds";

const IGDS_APPEND_LOCK = 872364991;

let pool: Pool | null = null;
let poolUrl = "";

function getPool(): Pool {
  const url = config().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the IGDS Genesis registry.");
  if (!pool || poolUrl !== url) {
    if (pool) void pool.end().catch(() => undefined);
    pool = new Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
    });
    poolUrl = url;
  }
  return pool;
}

export function disposeIgdsPool(): Promise<void> {
  if (!pool) return Promise.resolve();
  const closing = pool;
  pool = null;
  poolUrl = "";
  return closing.end().catch(() => undefined);
}

interface GenesisEntryRow {
  sequence: string | number;
  entry_id: string;
  entry_type: GenesisEntryType;
  document_id: string;
  document_digest: string;
  manifest_digest: string;
  previous_entry_hash: string;
  entry_hash: string;
  signature: SignatureEnvelope;
  revocation: GenesisRevocationPayload | null;
  created_at: Date | string;
}

interface GenesisCheckpointRow {
  tree_size: string | number;
  root_hash: string;
  first_sequence: string | number;
  last_sequence: string | number;
  generated_at: Date | string;
  signature: SignatureEnvelope;
  timestamp_token: GenesisCheckpoint["timestamp_token"];
}

function toEntry(row: GenesisEntryRow): GenesisEntry {
  return {
    sequence: Number(row.sequence),
    entry_id: row.entry_id,
    type: row.entry_type,
    document_id: row.document_id,
    document_digest: row.document_digest,
    manifest_digest: row.manifest_digest,
    previous_entry_hash: row.previous_entry_hash,
    created_at: new Date(row.created_at).toISOString(),
    entry_hash: row.entry_hash,
    signature: row.signature,
    ...(row.revocation ? { revocation: row.revocation } : {}),
  };
}

function toCheckpoint(row: GenesisCheckpointRow): GenesisCheckpoint {
  return {
    tree_size: Number(row.tree_size),
    root_hash: row.root_hash,
    first_sequence: Number(row.first_sequence),
    last_sequence: Number(row.last_sequence),
    generated_at: new Date(row.generated_at).toISOString(),
    signature: row.signature,
    timestamp_token: row.timestamp_token ?? null,
  };
}

async function appendEntry(input: {
  entryId?: string;
  type: GenesisEntryType;
  documentId: string;
  documentDigest: string;
  manifestDigest: string;
  signature: SignatureEnvelope;
  revocation?: GenesisRevocationPayload;
  createdAt?: string;
}): Promise<GenesisEntry> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [IGDS_APPEND_LOCK]);
    const head = await client.query(
      `SELECT sequence, entry_hash FROM igds_entries ORDER BY sequence DESC LIMIT 1`,
    );
    const headRow = head.rows[0] as { sequence: string | number; entry_hash: string } | undefined;
    const previousHash = headRow ? headRow.entry_hash : GENESIS_PREVIOUS_HASH;
    const sequence = headRow ? Number(headRow.sequence) + 1 : 0;

    const payload = {
      sequence,
      entry_id: input.entryId ?? `gen_${randomUUID()}`,
      type: input.type,
      document_id: input.documentId,
      document_digest: input.documentDigest,
      manifest_digest: input.manifestDigest,
      previous_entry_hash: previousHash,
      created_at: input.createdAt ?? new Date().toISOString(),
      ...(input.revocation ? { revocation: input.revocation } : {}),
    };
    const entry: GenesisEntry = {
      ...payload,
      entry_hash: computeEntryHash(payload),
      signature: input.signature,
    };

    await client.query(
      `INSERT INTO igds_entries
        (sequence, entry_id, entry_type, document_id, document_digest, manifest_digest,
         previous_entry_hash, entry_hash, signature, revocation, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12)`,
      [
        entry.sequence,
        entry.entry_id,
        entry.type,
        entry.document_id,
        entry.document_digest,
        entry.manifest_digest,
        entry.previous_entry_hash,
        entry.entry_hash,
        JSON.stringify(entry.signature),
        entry.revocation ? JSON.stringify(entry.revocation) : null,
        JSON.stringify(payload),
        entry.created_at,
      ],
    );

    if (input.revocation) {
      const revocation = input.revocation;
      await client.query(
        `INSERT INTO igds_revocations
          (revocation_id, target_type, target_id, reason, scope, issued_by, effective_at, entry_hash, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT (revocation_id) DO NOTHING`,
        [
          revocation.revocation_id,
          revocation.target_type,
          revocation.target_id,
          revocation.reason,
          revocation.scope,
          revocation.issued_by,
          revocation.effective_at,
          entry.entry_hash,
          JSON.stringify(revocation),
        ],
      );
    }

    await client.query("COMMIT");
    return entry;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Registro Genesis durable sobre PostgreSQL (append-only). */
export function createPostgresGenesisRegistry(): GenesisRegistry {
  return {
    appendSeal(input: AppendSealInput) {
      return appendEntry({
        entryId: input.entryId,
        type: "seal",
        documentId: input.documentId,
        documentDigest: input.documentDigest,
        manifestDigest: input.manifestDigest,
        signature: input.signature,
        createdAt: input.createdAt,
      });
    },
    appendRevocation(input: AppendRevocationInput) {
      return appendEntry({
        entryId: input.entryId,
        type: "revocation",
        documentId: input.revocation.target_id,
        documentDigest: "",
        manifestDigest: "",
        signature: input.signature,
        revocation: input.revocation,
        createdAt: input.createdAt,
      });
    },
    async size() {
      const { rows } = await getPool().query(`SELECT COUNT(*)::bigint AS count FROM igds_entries`);
      return Number((rows[0] as { count: string }).count);
    },
    async get(sequence: number) {
      const { rows } = await getPool().query(
        `SELECT * FROM igds_entries WHERE sequence = $1 LIMIT 1`,
        [sequence],
      );
      const row = (rows as GenesisEntryRow[])[0];
      return row ? toEntry(row) : null;
    },
    async list(limit = 200) {
      const { rows } = await getPool().query(
        `SELECT * FROM igds_entries ORDER BY sequence ASC LIMIT $1`,
        [Math.max(1, Math.floor(limit))],
      );
      return (rows as GenesisEntryRow[]).map(toEntry);
    },
    async head() {
      const { rows } = await getPool().query(
        `SELECT * FROM igds_entries ORDER BY sequence DESC LIMIT 1`,
      );
      const row = (rows as GenesisEntryRow[])[0];
      return row ? toEntry(row) : null;
    },
    async leafHashes() {
      const { rows } = await getPool().query(
        `SELECT entry_hash FROM igds_entries ORDER BY sequence ASC`,
      );
      return (rows as Array<{ entry_hash: string }>).map((row) => row.entry_hash);
    },
  };
}

export async function saveGenesisCheckpoint(checkpoint: GenesisCheckpoint): Promise<void> {
  await getPool().query(
    `INSERT INTO igds_checkpoints
      (tree_size, root_hash, first_sequence, last_sequence, generated_at, signature, timestamp_token)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
     ON CONFLICT (tree_size, root_hash) DO NOTHING`,
    [
      checkpoint.tree_size,
      checkpoint.root_hash,
      checkpoint.first_sequence,
      checkpoint.last_sequence,
      checkpoint.generated_at,
      JSON.stringify(checkpoint.signature),
      checkpoint.timestamp_token ? JSON.stringify(checkpoint.timestamp_token) : null,
    ],
  );
}

export async function listGenesisCheckpoints(limit = 50): Promise<GenesisCheckpoint[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM igds_checkpoints ORDER BY tree_size DESC LIMIT $1`,
    [Math.max(1, Math.floor(limit))],
  );
  return (rows as GenesisCheckpointRow[]).map(toCheckpoint);
}

/** Revocación vigente más reciente para un objetivo (para evaluar confianza). */
export async function latestRevocationForTarget(
  targetType: string,
  targetId: string,
): Promise<GenesisRevocationPayload | null> {
  const { rows } = await getPool().query(
    `SELECT payload FROM igds_revocations
      WHERE target_type = $1 AND target_id = $2
      ORDER BY effective_at DESC LIMIT 1`,
    [targetType, targetId],
  );
  const row = (rows as Array<{ payload: GenesisRevocationPayload }>)[0];
  return row?.payload ?? null;
}

class InMemoryIgdsGenesisRepository {
  private readonly seals = new Map<string, unknown>();

  async saveSeal(seal: unknown): Promise<void> {
    const key = seal as { sealId?: unknown; id?: unknown };
    const id =
      typeof key.sealId === "string"
        ? key.sealId
        : typeof key.id === "string"
          ? key.id
          : `seal_${Date.now()}`;
    this.seals.set(id, seal);
  }

  async getSeal(id: string): Promise<unknown> {
    return this.seals.get(id) ?? null;
  }

  async listSeals(): Promise<readonly unknown[]> {
    return Array.from(this.seals.values());
  }
}

export const igdsGenesisRepository = new InMemoryIgdsGenesisRepository();
export default igdsGenesisRepository;
