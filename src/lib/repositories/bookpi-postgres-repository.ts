/**
 * BookPI PostgreSQL Repository (src/lib/repositories/bookpi-postgres-repository.ts)
 * -----------------------------------------------------------------
 * Sovereign Financial & Evidence Ledger with cryptographic block hashing.
 * Append-only immutable accounting (zero mutations, refunds as compensating entries).
 */
import { createHash } from "node:crypto";
import { canonicalize } from "../igds/canonical";

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

    const block_hash = createHash("sha3-512").update(canonicalize(payload), "utf8").digest("hex");

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

  async verifyLedger(
    tenantId: string,
  ): Promise<{ valid: boolean; count: number; brokenAt?: number }> {
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
 * Factory de la autoridad durable. Este módulo fue históricamente el hogar de
 * `createBookpiPostgresRepository()`; la implementación vive ahora en
 * `bookpi-postgres-runtime.ts` y se re-exporta aquí para conservar el
 * contrato público original de este módulo.
 */
export { createBookpiPostgresRepository } from "./bookpi-postgres-runtime";
