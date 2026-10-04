/**
 * BookPI PostgreSQL Repository (src/lib/repositories/bookpi-postgres-repository.ts)
 * -----------------------------------------------------------------
 * Sovereign Financial & Evidence Ledger with cryptographic block hashing.
 * Append-only immutable accounting (zero mutations, refunds as compensating entries).
 */
import { createHash } from "node:crypto";
import { canonicalize } from "../igds/canonical";
import { getPgPool } from "../persistence/postgres";

export interface BookPiBlock {
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

export interface BookPiRepository {
  appendBlock(input: {
    tenant_id: string;
    user_id: string;
    operation: string;
    category?: string;
    cost_decimal?: number;
    tokens_consumed?: number;
    status?: "CONFIRMED" | "PENDING" | "FAILED" | "REVERSED";
  }): Promise<BookPiBlock>;
  getLatestBlock(tenantId: string): Promise<BookPiBlock | null>;
  verifyLedger(tenantId: string): Promise<{ valid: boolean; count: number; brokenAt?: number }>;
  listBlocks(tenantId: string, limit?: number): Promise<readonly BookPiBlock[]>;
}

class InMemoryBookPiRepository implements BookPiRepository {
  private blocks: BookPiBlock[] = [];
  private lastIndexByTenant = new Map<string, number>();
  private lastHashByTenant = new Map<string, string>();

  async appendBlock(input: {
    tenant_id: string;
    user_id: string;
    operation: string;
    category?: string;
    cost_decimal?: number;
    tokens_consumed?: number;
    status?: "CONFIRMED" | "PENDING" | "FAILED" | "REVERSED";
  }): Promise<BookPiBlock> {
    const currentIndex = (this.lastIndexByTenant.get(input.tenant_id) ?? 0) + 1;
    const previous_hash = this.lastHashByTenant.get(input.tenant_id) || "GENESIS_BLOCK_HASH";
    const timestamp = new Date().toISOString();
    const nonce = Math.floor(Math.random() * 1000000);

    const payload = {
      index: currentIndex,
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      timestamp,
      operation: input.operation,
      category: input.category || "ai_inference",
      cost_decimal: input.cost_decimal || 0,
      tokens_consumed: input.tokens_consumed || 0,
      previous_hash,
      signature_algorithm: "HMAC-SHA3-512",
      status: input.status || "CONFIRMED",
      nonce,
    };

    const block_hash = createHash("sha3-512")
      .update(canonicalize(payload), "utf8")
      .digest("hex");

    const block: BookPiBlock = {
      ...payload,
      block_hash,
    };

    this.blocks.push(block);
    this.lastIndexByTenant.set(input.tenant_id, currentIndex);
    this.lastHashByTenant.set(input.tenant_id, block_hash);
    return block;
  }

  async getLatestBlock(tenantId: string): Promise<BookPiBlock | null> {
    const tenantBlocks = this.blocks.filter((b) => b.tenant_id === tenantId);
    return tenantBlocks.length > 0 ? tenantBlocks[tenantBlocks.length - 1] : null;
  }

  async verifyLedger(tenantId: string): Promise<{ valid: boolean; count: number; brokenAt?: number }> {
    const tenantBlocks = this.blocks.filter((b) => b.tenant_id === tenantId);
    let previous = "GENESIS_BLOCK_HASH";

    for (const b of tenantBlocks) {
      if (b.previous_hash !== previous) {
        return { valid: false, count: tenantBlocks.length, brokenAt: b.index };
      }
      const expected = createHash("sha3-512")
        .update(
          canonicalize({
            index: b.index,
            tenant_id: b.tenant_id,
            user_id: b.user_id,
            timestamp: b.timestamp,
            operation: b.operation,
            category: b.category,
            cost_decimal: b.cost_decimal,
            tokens_consumed: b.tokens_consumed,
            previous_hash: b.previous_hash,
            signature_algorithm: b.signature_algorithm,
            status: b.status,
            nonce: b.nonce,
          }),
          "utf8",
        )
        .digest("hex");

      if (b.block_hash !== expected) {
        return { valid: false, count: tenantBlocks.length, brokenAt: b.index };
      }
      previous = b.block_hash;
    }

    return { valid: true, count: tenantBlocks.length };
  }

  async listBlocks(tenantId: string, limit: number = 50): Promise<readonly BookPiBlock[]> {
    return this.blocks.filter((b) => b.tenant_id === tenantId).slice(-limit);
  }
}

export const bookpiPostgresRepository = new InMemoryBookPiRepository();
export default bookpiPostgresRepository;


/**
 * Durable production authority.
 *
 * NOTE: The legacy InMemoryBookPiRepository above is intentionally preserved
 * for backward compatibility. Production consumers that require persistence
 * must call createBookpiPostgresRepository(), which uses public.bookpi_ledger.
 */
import type { Pool, PoolClient } from "pg";

export interface DurableBookPiRepository {
  append(input: {
    tenantId: string;
    userId: string;
    operation: string;
    category?: string;
    cost?: number;
    tokens?: number;
    status?: "settled" | "pending" | "refunded" | "pruned" | "CONFIRMED" | "PENDING" | "FAILED" | "REVERSED";
  }): Promise<{ success: boolean; error?: string; block?: {
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
  } }>;
  appendBlock(input: {
    tenant_id: string;
    user_id: string;
    operation: string;
    category?: string;
    cost_decimal?: number;
    tokens_consumed?: number;
    status?: "CONFIRMED" | "PENDING" | "FAILED" | "REVERSED";
  }): Promise<BookPiBlock>;
  batchAppend(inputs: Array<{
    tenantId: string;
    userId: string;
    operation: string;
    category?: string;
    cost?: number;
    tokens?: number;
    status?: "settled" | "pending" | "refunded" | "pruned";
  }>): Promise<{ success: boolean; error?: string; blocks?: Array<NonNullable<Awaited<ReturnType<DurableBookPiRepository["append"]>>["block"]>> }>;
  getLatestBlock(tenantId: string): Promise<BookPiBlock | null>;
  listBlocks(tenantId: string, limit?: number): Promise<readonly BookPiBlock[]>;
  list(tenantId: string): Promise<Array<NonNullable<Awaited<ReturnType<DurableBookPiRepository["append"]>>["block"]>>>;
  verifyLedger(tenantId: string): Promise<{ valid: boolean; count: number; brokenAt?: number }>;
  verifyIntegrity(tenantId: string): Promise<{ success: boolean; error?: string; corruptedIndex?: number }>;
  query?(tenantId: string, filter: { category?: string; userId?: string; fromDate?: Date; toDate?: Date }): Promise<Array<NonNullable<Awaited<ReturnType<DurableBookPiRepository["append"]>>["block"]>>>;
  refund?(tenantId: string, index: number, reason?: string): Promise<{ success: boolean; error?: string }>;
}

const DURABLE_GENESIS_HASH = "GENESIS_BLOCK_HASH";
const DURABLE_HASH_ALGORITHM = "SHA3-512-HASH-CHAIN";

function durableNormalizeStatus(
  status: DurableBookPiRepository["append"] extends (input: infer I) => Promise<any>
    ? I extends { status?: infer S } ? S : never
    : never,
): BookPiBlock["status"] {
  switch (status) {
    case "pending":
    case "PENDING":
      return "PENDING";
    case "refunded":
    case "REVERSED":
      return "REVERSED";
    case "pruned":
    case "FAILED":
      return "FAILED";
    default:
      return "CONFIRMED";
  }
}

function durableLegacyStatus(status: BookPiBlock["status"]) {
  if (status === "PENDING") return "pending" as const;
  if (status === "REVERSED") return "refunded" as const;
  if (status === "FAILED") return "pruned" as const;
  return "settled" as const;
}

function durableCategory(category: string | undefined) {
  return (["inference", "processing", "apis", "skills", "other"] as const).includes(
    category as "inference" | "processing" | "apis" | "skills" | "other",
  )
    ? (category as "inference" | "processing" | "apis" | "skills" | "other")
    : "other";
}

function durableBlockToLegacy(block: BookPiBlock) {
  return {
    index: block.index,
    timestamp: block.timestamp,
    tenantId: block.tenant_id,
    userId: block.user_id,
    operation: block.operation,
    category: durableCategory(block.category),
    costDecimal: block.cost_decimal.toFixed(6),
    tokensConsumed: block.tokens_consumed,
    previousHash: block.previous_hash,
    blockHash: block.block_hash,
    pqcSignature: null,
    signatureAlgorithm: block.signature_algorithm,
    status: durableLegacyStatus(block.status),
    nonce: String(block.nonce),
  };
}

function durableHashPayload(block: Omit<BookPiBlock, "block_hash">): string {
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

function durableMapRow(row: Record<string, unknown>): BookPiBlock {
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
    status: String(row.status) as BookPiBlock["status"],
    nonce: Number(row.nonce),
  };
}

function durableTenantLockId(tenantId: string): number {
  return createHash("sha256").update(tenantId, "utf8").digest().readInt32BE(0);
}

class PostgresBookPiRepository implements DurableBookPiRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(
    tenantId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [durableTenantLockId(tenantId)]);
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

  async appendBlock(input: {
    tenant_id: string;
    user_id: string;
    operation: string;
    category?: string;
    cost_decimal?: number;
    tokens_consumed?: number;
    status?: "CONFIRMED" | "PENDING" | "FAILED" | "REVERSED";
  }): Promise<BookPiBlock> {
    if (!input.tenant_id.trim()) throw new Error("tenant_id_required");
    if (!input.user_id.trim()) throw new Error("user_id_required");
    if (!input.operation.trim()) throw new Error("operation_required");
    if (!Number.isFinite(input.cost_decimal ?? 0) || (input.cost_decimal ?? 0) < 0) {
      throw new Error("cost_decimal_invalid");
    }
    if (!Number.isFinite(input.tokens_consumed ?? 0) || (input.tokens_consumed ?? 0) < 0) {
      throw new Error("tokens_consumed_invalid");
    }

    const tenantId = input.tenant_id.trim().slice(0, 128);
    const userId = input.user_id.trim().slice(0, 128);
    const operation = input.operation.trim().slice(0, 512);
    const category = (input.category ?? "other").trim().slice(0, 64);
    const cost = Number(input.cost_decimal ?? 0);
    const tokens = Math.trunc(Number(input.tokens_consumed ?? 0));
    const status = input.status ?? "CONFIRMED";

    return this.transaction(tenantId, async (client) => {
      const latest = await client.query(
        "SELECT index, block_hash FROM bookpi_ledger WHERE tenant_id = $1 ORDER BY index DESC LIMIT 1",
        [tenantId],
      );

      const previousHash =
        latest.rows[0]?.block_hash ? String(latest.rows[0].block_hash) : DURABLE_GENESIS_HASH;
      const index = latest.rows[0]?.index === undefined
        ? 0
        : Number(latest.rows[0].index) + 1;

      const payload: Omit<BookPiBlock, "block_hash"> = {
        index,
        tenant_id: tenantId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        operation,
        category,
        cost_decimal: cost,
        tokens_consumed: tokens,
        previous_hash: previousHash,
        signature_algorithm: DURABLE_HASH_ALGORITHM,
        status,
        nonce: Math.floor(Math.random() * 1_000_000_000),
      };

      const blockHash = durableHashPayload(payload);
      const inserted = await client.query(
        `INSERT INTO bookpi_ledger
          (index, tenant_id, user_id, timestamp, operation, category, cost_decimal,
           tokens_consumed, previous_hash, block_hash, signature_algorithm, status, nonce)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
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
          blockHash,
          payload.signature_algorithm,
          payload.status,
          payload.nonce,
        ],
      );

      if (!inserted.rows[0]) throw new Error("bookpi_insert_empty");
      return durableMapRow(inserted.rows[0] as Record<string, unknown>);
    });
  }

  async append(input: {
    tenantId: string;
    userId: string;
    operation: string;
    category?: string;
    cost?: number;
    tokens?: number;
    status?: "settled" | "pending" | "refunded" | "pruned" | "CONFIRMED" | "PENDING" | "FAILED" | "REVERSED";
  }) {
    try {
      const block = await this.appendBlock({
        tenant_id: input.tenantId,
        user_id: input.userId,
        operation: input.operation,
        category: input.category,
        cost_decimal: input.cost ?? 0,
        tokens_consumed: input.tokens ?? 0,
        status: durableNormalizeStatus(input.status),
      });
      return { success: true, block: durableBlockToLegacy(block) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "BOOKPI_APPEND_FAILED",
      };
    }
  }

  async batchAppend(inputs: Array<Parameters<DurableBookPiRepository["append"]>[0]>) {
    const blocks: Array<NonNullable<Awaited<ReturnType<DurableBookPiRepository["append"]>>["block"]>> = [];
    for (const input of inputs) {
      const result = await this.append(input);
      if (!result.success) return { success: false, error: result.error, blocks };
      if (result.block) blocks.push(result.block);
    }
    return { success: true, blocks };
  }

  async getLatestBlock(tenantId: string): Promise<BookPiBlock | null> {
    const result = await this.pool.query(
      "SELECT * FROM bookpi_ledger WHERE tenant_id = $1 ORDER BY index DESC LIMIT 1",
      [tenantId.trim().slice(0, 128)],
    );
    return result.rows[0]
      ? durableMapRow(result.rows[0] as Record<string, unknown>)
      : null;
  }

  async listBlocks(tenantId: string, limit = 50): Promise<readonly BookPiBlock[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 5000));
    const result = await this.pool.query(
      "SELECT * FROM bookpi_ledger WHERE tenant_id = $1 ORDER BY index ASC LIMIT $2",
      [tenantId.trim().slice(0, 128), safeLimit],
    );
    return result.rows.map((row) => durableMapRow(row as Record<string, unknown>));
  }

  async list(tenantId: string) {
    return (await this.listBlocks(tenantId, 5000)).map(durableBlockToLegacy);
  }

  async query(
    tenantId: string,
    filter: { category?: string; userId?: string; fromDate?: Date; toDate?: Date },
  ) {
    let blocks = await this.list(tenantId);
    if (filter.category) blocks = blocks.filter((block) => block.category === filter.category);
    if (filter.userId) blocks = blocks.filter((block) => block.userId === filter.userId);
    if (filter.fromDate) blocks = blocks.filter((block) => new Date(block.timestamp) >= filter.fromDate!);
    if (filter.toDate) blocks = blocks.filter((block) => new Date(block.timestamp) <= filter.toDate!);
    return blocks;
  }

  async verifyLedger(tenantId: string) {
    const rows = await this.pool.query(
      "SELECT * FROM bookpi_ledger WHERE tenant_id = $1 ORDER BY index ASC",
      [tenantId.trim().slice(0, 128)],
    );
    let previous = DURABLE_GENESIS_HASH;
    for (const row of rows.rows) {
      const block = durableMapRow(row as Record<string, unknown>);
      if (block.previous_hash !== previous) {
        return { valid: false, count: rows.rows.length, brokenAt: block.index };
      }
      if (durableHashPayload(block) !== block.block_hash) {
        return { valid: false, count: rows.rows.length, brokenAt: block.index };
      }
      previous = block.block_hash;
    }
    return { valid: true, count: rows.rows.length };
  }

  async verifyIntegrity(tenantId: string) {
    const verification = await this.verifyLedger(tenantId);
    return {
      success: verification.valid,
      ...(verification.valid ? {} : { error: "BOOKPI_CHAIN_INVALID" }),
      ...(verification.brokenAt === undefined ? {} : { corruptedIndex: verification.brokenAt }),
    };
  }

  async refund(tenantId: string, index: number, reason = "refund") {
    const original = await this.getLatestBlock(tenantId);
    if (!original || original.index !== index) {
      const rows = await this.pool.query(
        "SELECT * FROM bookpi_ledger WHERE tenant_id = $1 AND index = $2 LIMIT 1",
        [tenantId, index],
      );
      if (!rows.rows[0]) return { success: false, error: "BOOKPI_BLOCK_NOT_FOUND" };
    }
    const existing = await this.pool.query(
      "SELECT 1 FROM bookpi_ledger WHERE tenant_id = $1 AND operation = $2 LIMIT 1",
      [tenantId, `REFUND_OF:${index}`],
    );
    if (existing.rows[0]) return { success: false, error: "BOOKPI_REFUND_DUPLICATE" };
    const target = await this.pool.query(
      "SELECT * FROM bookpi_ledger WHERE tenant_id = $1 AND index = $2 LIMIT 1",
      [tenantId, index],
    );
    const userId = String(target.rows[0]?.user_id ?? "system");
    const result = await this.append({
      tenantId,
      userId,
      operation: `REFUND_OF:${index}:${reason.slice(0, 120)}`,
      category: "other",
      cost: 0,
      tokens: 0,
      status: "refunded",
    });
    return result.success ? { success: true } : { success: false, error: result.error };
  }
  
  async prune(_tenantId: string, _maxAgeMs: number) {
    return { success: false, error: "BOOKPI_PRUNE_FORBIDDEN_APPEND_ONLY_LEDGER" };
  }
  
  async pruneInactive(_inactiveDays: number) {
    return { success: false, error: "BOOKPI_PRUNE_INACTIVE_FORBIDDEN_APPEND_ONLY_LEDGER" };
  }
}

export function createBookpiPostgresRepository(): DurableBookPiRepository {
  const pool = getPgPool();
  if (!pool) {
    throw new Error("BOOKPI_POSTGRES_UNAVAILABLE: DATABASE_URL is required for durable BookPI.");
  }
  return new PostgresBookPiRepository(pool);
}
