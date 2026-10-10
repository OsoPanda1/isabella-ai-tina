/**
 * BookPI Development Repository (src/lib/repositories/bookpi-dev-repository.ts)
 */
import { BookPiRepository, bookpiPostgresRepository } from "./bookpi-postgres-repository";

export const bookpiDevRepository: BookPiRepository = bookpiPostgresRepository;
export default bookpiDevRepository;

import type { BlockPIBlock, LedgerCategory, LedgerStatus } from "../bookpi/types";
import { createHash, randomInt } from "node:crypto";

export interface BookpiDevRepository {
  append(input: {
    tenantId: string;
    userId: string;
    operation: string;
    category: LedgerCategory;
    cost: number;
    tokens: number;
    status?: LedgerStatus;
  }): { success: boolean; error?: string; block?: BlockPIBlock };
  list(tenantId: string): BlockPIBlock[];
  refund(tenantId: string, index: number, reason?: string): { success: boolean; error?: string };
  verifyIntegrity(tenantId: string): { success: boolean; error?: string; corruptedIndex?: number };
}

class InMemoryBookpiDevRepository implements BookpiDevRepository {
  private readonly blocks = new Map<string, BlockPIBlock[]>();

  append(input: {
    tenantId: string;
    userId: string;
    operation: string;
    category: LedgerCategory;
    cost: number;
    tokens: number;
    status?: LedgerStatus;
  }) {
    if (!input.tenantId || !input.userId || !input.operation)
      return { success: false, error: "bookpi_input_required" };
    if (!Number.isFinite(input.cost) || input.cost < 0)
      return { success: false, error: "cost_invalid" };
    if (!Number.isFinite(input.tokens) || input.tokens < 0)
      return { success: false, error: "tokens_invalid" };
    const ledger = this.blocks.get(input.tenantId) ?? [];
    const previousHash = ledger.at(-1)?.blockHash ?? "GENESIS_BLOCK_HASH";
    const payload = {
      index: ledger.length,
      timestamp: new Date().toISOString(),
      tenantId: input.tenantId,
      userId: input.userId,
      operation: input.operation,
      category: input.category,
      costDecimal: input.cost.toFixed(6),
      tokensConsumed: Math.trunc(input.tokens),
      previousHash,
      pqcSignature: null,
      signatureAlgorithm: "DEV-SHA3-512-HASH-CHAIN",
      status: input.status ?? "settled",
      nonce: String(randomInt(0, 1_000_000_000)),
    } satisfies Omit<BlockPIBlock, "blockHash">;
    const block: BlockPIBlock = {
      ...payload,
      blockHash: createHash("sha3-512").update(JSON.stringify(payload), "utf8").digest("hex"),
    };
    ledger.push(block);
    this.blocks.set(input.tenantId, ledger);
    return { success: true, block };
  }

  list(tenantId: string): BlockPIBlock[] {
    return [...(this.blocks.get(tenantId) ?? [])];
  }

  refund(tenantId: string, index: number, reason = "refund") {
    const original = this.list(tenantId).find((block) => block.index === index);
    if (!original) return { success: false, error: "BOOKPI_BLOCK_NOT_FOUND" };
    if (
      this.list(tenantId).some((block) => block.operation.startsWith("REFUND_OF:" + index + ":"))
    ) {
      return { success: false, error: "BOOKPI_REFUND_DUPLICATE" };
    }
    return this.append({
      tenantId,
      userId: original.userId,
      operation: "REFUND_OF:" + index + ":" + reason.slice(0, 120),
      category: "other",
      cost: 0,
      tokens: 0,
      status: "refunded",
    });
  }

  verifyIntegrity(tenantId: string) {
    let previous = "GENESIS_BLOCK_HASH";
    for (const block of this.list(tenantId)) {
      if (block.previousHash !== previous)
        return { success: false, error: "BOOKPI_CHAIN_BROKEN", corruptedIndex: block.index };
      const { blockHash, ...payload } = block;
      const expected = createHash("sha3-512").update(JSON.stringify(payload), "utf8").digest("hex");
      if (expected !== blockHash)
        return { success: false, error: "BOOKPI_HASH_MISMATCH", corruptedIndex: block.index };
      previous = blockHash;
    }
    return { success: true };
  }
}

export function createBookpiDevRepository(): BookpiDevRepository {
  return new InMemoryBookpiDevRepository();
}
