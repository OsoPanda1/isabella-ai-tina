/**
 * BookPI PostgreSQL Runtime — production authority.
 *
 * This module is additive. The historical BookPI implementation remains
 * untouched; production financial/evidence consumers resolve this runtime
 * explicitly so persistence is durable and append-only.
 */
import { createHash, randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { canonicalize } from "../igds/canonical";
import { getPgPool } from "../persistence/postgres";

const GENESIS_HASH = "GENESIS_BLOCK_HASH";
const HASH_CHAIN = "SHA3-512-HASH-CHAIN";
const MAX_TENANT = 128;
const MAX_USER = 128;
const MAX_OPERATION = 512;
const MAX_CATEGORY = 64;
const MAX_LIMIT = 5000;

export interface DurableBookPiBlock {
  index: number;
  tenant_id: string;
  user_id: string;
  timestamp: string;
  operation: string;
  category: string;
  cost_decimal: number;
  tokens_consumed: number;
  previous_hash: string;
  block_hash: string;
  signature_algorithm: string;
  status: "CONFIRMED" | "PENDING" | "FAILED" | "REVERSED";
  nonce: number;
}

export interface DurableBookPiRepository {
  append(input: {
    tenantId: string;
    userId: string;
    operation: string;
    category?: string;
    cost?: number;
    tokens?: number;
    status?: "settled" | "pending" | "refunded" | "pruned";
  }): Promise<{ success: boolean; error?: string; block?: DurableBookPiLegacyBlock }>;
  appendBlock(input: {
    tenant_id: string;
    user_id: string;
    operation: string;
    category?: string;
    cost_decimal?: number;
    tokens_consumed?: number;
    status?: "CONFIRMED" | "PENDING" | "FAILED" | "REVERSED";
  }): Promise<DurableBookPiBlock>;
  batchAppend(inputs: Array<{
    tenantId: string;
    userId: string;
    operation: string;
    category?: string;
    cost?: number;
    tokens?: number;
    status?: "settled" | "pending" | "refunded" | "pruned";
  }>): Promise<{ success: boolean; error?: string; blocks: DurableBookPiLegacyBlock[] }>;
  getLatestBlock(tenantId: string): Promise<DurableBookPiBlock | null>;
  listBlocks(tenantId: string, limit?: number): Promise<readonly DurableBookPiBlock[]>;
  list(tenantId: string): Promise<DurableBookPiLegacyBlock[]>;
  query(tenantId: string, filter: {
    category?: string;
    userId?: string;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<DurableBookPiLegacyBlock[]>;
  verifyLedger(tenantId: string): Promise<{ valid: boolean; count: number; brokenAt?: number }>;
  verifyIntegrity(tenantId: string): Promise<{ success: boolean; error?: string; corruptedIndex?: number }>;
  refund(tenantId: string, index: number, reason?: string): Promise<{ success: boolean; error?: string }>;
}

export interface DurableBookPiLegacyBlock {
  index: number;
  timestamp: string;
  tenantId: string;
  userId: string;
  operation: string;
  category: "inference" | "processing" | "apis" | "skills" | "other";
  costDecimal: string;
  tokensConsumed: number;
  previousHash: string;
  blockHash: string;
  pqcSignature: string | null;
  signatureAlgorithm: string;
  status: "settled" | "pending" | "refunded" | "pruned";
  nonce: string;
}

function safeText(value: string, field: string, max: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(field + "_required");
  if (normalized.length > max) throw new Error(field + "_too_long");
  return normalized;
}

function safeNumber(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(field + "_invalid");
  return value;
}

function normalizeStatus(status: "settled" | "pending" | "refunded" | "pruned" | undefined) {
  if (status === "pending") return "PENDING" as const;
  if (status === "refunded") return "REVERSED" as const;
  if (status === "pruned") return "FAILED" as const;
  return "CONFIRMED" as const;
}

function legacyStatus(status: DurableBookPiBlock["status"]) {
  if (status === "PENDING") return "pending" as const;
  if (status === "REVERSED") return "refunded" as const;
  if (status === "FAILED") return "pruned" as const;
  return "settled" as const;
}

function legacyCategory(category: string) {
  return (["inference", "processing", "apis", "skills", "other"] as const).includes(
    category as "inference" | "processing" | "apis" | "skills" | "other",
  )
    ? (category as "inference" | "processing" | "apis" | "skills" | "other")
    : "other";
}

function toLegacy(block: DurableBookPiBlock): DurableBookPiLegacyBlock {
  return {
    index: block.index,
    timestamp: block.timestamp,
    tenantId: block.tenant_id,
    userId: block.user_id,
    operation: block.operation,
    category: legacyCategory(block.category),
    costDecimal: block.cost_decimal.toFixed(6),
    tokensConsumed: block.tokens_consumed,
    previousHash: block.previous_hash,
    blockHash: block.block_hash,
    pqcSignature: null,
    signatureAlgorithm: block.signature_algorithm,
    status: legacyStatus(block.status),
    nonce: String(block.nonce),
  };
}

function mapRow(row: Record<string, unknown>): DurableBookPiBlock {
  return {
    index: Number(row.index),
    tenant_id: String(row.tenant_id),
    user_id: String(row.user_id),
    timestamp: new Date(String(row.timestamp)).toISOString(),
    operation: String(row.operation),
    category: String(row.category),
    cost_decimal: Number(row.cost_decimal),
    tokens_consumed: Number(row.tokens_consumed),
    previous_hash: String(row.previous_hash),
    block_hash: String(row.block_hash),
    signature_algorithm: String(row.signature_algorithm),
    status: String(row.status) as DurableBookPiBlock["status"],
    nonce: Number(row.nonce),
  };
}

function blockHash(block: Omit<DurableBookPiBlock, "block_hash">): string {
  return createHash("sha3-512")
    .update(
      canonicalize({
        index: block.index,
        tenant_id: block.tenant_id,
        user_id: block.user_id,
        timestamp: block.timestamp,
        operation: block.operation,
        category: block.category,
        cost_decimal: block.cost_decimal,
        tokens_consumed: block.tokens_consumed,
        previous_hash: block.previous_hash,
        signature_algorithm: block.signature_algorithm,
        status: block.status,
        nonce: block.nonce,
      }),
      "utf8",
    )
    .digest("hex");
}

function tenantLockId(tenantId: string): number {
  return createHash("sha256").update(tenantId, "utf8").digest().readInt32BE(0);
}

class PostgresBookPiRuntime implements DurableBookPiRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(
    tenantId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [tenantLockId(tenantId)]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async appendBlock(input: Parameters<DurableBookPiRepository["appendBlock"]>[0]) {
    const tenantId = safeText(input.tenant_id, "tenant_id", MAX_TENANT);
    const userId = safeText(input.user_id, "user_id", MAX_USER);
    const operation = safeText(input.operation, "operation", MAX_OPERATION);
    const category = safeText(input.category ?? "other", "category", MAX_CATEGORY);
    const cost = safeNumber(Number(input.cost_decimal ?? 0), "cost_decimal");
    const tokens = Math.trunc(safeNumber(Number(input.tokens_consumed ?? 0), "tokens_consumed"));

    return this.transaction(tenantId, async (client) => {
      const latest = await client.query(
        "SELECT index, block_hash FROM bookpi_ledger WHERE tenant_id = $1 ORDER BY index DESC LIMIT 1",
        [tenantId],
      );

      const previousHash = latest.rows[0]?.block_hash
        ? String(latest.rows[0].block_hash)
        : GENESIS_HASH;
      const index = latest.rows[0]?.index === undefined
        ? 0
        : Number(latest.rows[0].index) + 1;

      const payload: Omit<DurableBookPiBlock, "block_hash"> = {
        index,
        tenant_id: tenantId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        operation,
        category,
        cost_decimal: cost,
        tokens_consumed: tokens,
        previous_hash: previousHash,
        signature_algorithm: HASH_CHAIN,
        status: input.status ?? "CONFIRMED",
        nonce: randomInt(0, 1_000_000_000),
      };

      const hash = blockHash(payload);
      const result = await client.query(
        "INSERT INTO bookpi_ledger (index, tenant_id, user_id, timestamp, operation, category, cost_decimal, tokens_consumed, previous_hash, block_hash, signature_algorithm, status, nonce) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
        [
          payload.index,
          payload.tenant_id,
          payload.user_id,
          payload.timestamp,
          payload.operation,
          payload.category,
          payload.cost_decimal,
          payload.tokens_consumed,
          payload.previous_hash,
          hash,
          payload.signature_algorithm,
          payload.status,
          payload.nonce,
        ],
      );

      if (!result.rows[0]) throw new Error("bookpi_insert_empty");
      return mapRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async append(input: Parameters<DurableBookPiRepository["append"]>[0]) {
    try {
      const block = await this.appendBlock({
        tenant_id: input.tenantId,
        user_id: input.userId,
        operation: input.operation,
        category: input.category,
        cost_decimal: input.cost ?? 0,
        tokens_consumed: input.tokens ?? 0,
        status: normalizeStatus(input.status),
      });
      return { success: true, block: toLegacy(block) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "BOOKPI_APPEND_FAILED",
      };
    }
  }

  async batchAppend(inputs: Parameters<DurableBookPiRepository["batchAppend"]>[0]) {
    const blocks: DurableBookPiLegacyBlock[] = [];
    for (const input of inputs) {
      const result = await this.append(input);
      if (!result.success) return { success: false, error: result.error, blocks };
      if (result.block) blocks.push(result.block);
    }
    return { success: true, blocks };
  }

  async getLatestBlock(tenantId: string) {
    const safeTenant = safeText(tenantId, "tenantId", MAX_TENANT);
    const result = await this.pool.query(
      "SELECT * FROM bookpi_ledger WHERE tenant_id = $1 ORDER BY index DESC LIMIT 1",
      [safeTenant],
    );
    return result.rows[0] ? mapRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async listBlocks(tenantId: string, limit = 50) {
    const safeTenant = safeText(tenantId, "tenantId", MAX_TENANT);
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
    const result = await this.pool.query(
      "SELECT * FROM bookpi_ledger WHERE tenant_id = $1 ORDER BY index ASC LIMIT $2",
      [safeTenant, safeLimit],
    );
    return result.rows.map((row) => mapRow(row as Record<string, unknown>));
  }

  async list(tenantId: string) {
    return (await this.listBlocks(tenantId, MAX_LIMIT)).map(toLegacy);
  }

  async query(tenantId: string, filter: {
    category?: string;
    userId?: string;
    fromDate?: Date;
    toDate?: Date;
  }) {
    let blocks = await this.list(tenantId);
    if (filter.category) blocks = blocks.filter((item) => item.category === filter.category);
    if (filter.userId) blocks = blocks.filter((item) => item.userId === filter.userId);
    if (filter.fromDate) blocks = blocks.filter((item) => new Date(item.timestamp) >= filter.fromDate!);
    if (filter.toDate) blocks = blocks.filter((item) => new Date(item.timestamp) <= filter.toDate!);
    return blocks;
  }

  async verifyLedger(tenantId: string) {
    const safeTenant = safeText(tenantId, "tenantId", MAX_TENANT);
    const result = await this.pool.query(
      "SELECT * FROM bookpi_ledger WHERE tenant_id = $1 ORDER BY index ASC",
      [safeTenant],
    );
    let previous = GENESIS_HASH;
    for (const row of result.rows) {
      const block = mapRow(row as Record<string, unknown>);
      if (block.previous_hash !== previous || blockHash(block) !== block.block_hash) {
        return { valid: false, count: result.rows.length, brokenAt: block.index };
      }
      previous = block.block_hash;
    }
    return { valid: true, count: result.rows.length };
  }

  async verifyIntegrity(tenantId: string) {
    const verification = await this.verifyLedger(tenantId);
    return {
      success: verification.valid,
      ...(verification.valid ? {} : { error: "BOOKPI_CHAIN_INVALID", corruptedIndex: verification.brokenAt }),
    };
  }

  async refund(tenantId: string, index: number, reason = "refund") {
    const target = await this.pool.query(
      "SELECT user_id FROM bookpi_ledger WHERE tenant_id = $1 AND index = $2 LIMIT 1",
      [tenantId, index],
    );
    if (!target.rows[0]) return { success: false, error: "BOOKPI_BLOCK_NOT_FOUND" };
    const duplicate = await this.pool.query(
      "SELECT 1 FROM bookpi_ledger WHERE tenant_id = $1 AND operation = $2 LIMIT 1",
      [tenantId, "REFUND_OF:" + index],
    );
    if (duplicate.rows[0]) return { success: false, error: "BOOKPI_REFUND_DUPLICATE" };
    const result = await this.append({
      tenantId,
      userId: String(target.rows[0].user_id),
      operation: "REFUND_OF:" + index + ":" + reason.slice(0, 120),
      category: "other",
      cost: 0,
      tokens: 0,
      status: "refunded",
    });
    return result.success ? { success: true } : { success: false, error: result.error };
  }
}

export function createBookpiPostgresRepository(): DurableBookPiRepository {
  const pool = getPgPool();
  if (!pool) {
    throw new Error("BOOKPI_POSTGRES_UNAVAILABLE: DATABASE_URL is required for durable BookPI.");
  }
  return new PostgresBookPiRuntime(pool);
}
