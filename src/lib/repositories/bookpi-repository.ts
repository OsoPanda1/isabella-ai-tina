/**
 * REPOSITORIO BOOKPI (src/lib/repositories/bookpi-repository.ts)
 * -----------------------------------------------------------------
 * Libro mayor inmutable (append-only) con cadena criptográfica real.
 * Sin mockdata:
 *  - Cada bloque encadena con el hash del anterior; no hay génesis falso.
 *  - Persistencia real en disco (`node:fs`) con I/O verificada.
 *  - Las refunds se registran como bloques de anulación, nunca se
 *    mutan/bloquean bloques ya asentados.
 *
 * §6.1: el hash usa el MISMO payload canónico que los otros repositorios
 * (`canonicalBookPiPayload`), aplicado en append() y verifyIntegrity().
 * §6.5/§6.6: la firma del bloque usa `bookpi-signer` (nunca `null`).
 *
 * La DECISIÓN de negocio (quién puede escribir/refund) la toma la capa
 * de autorización; este repositorio solo garantiza inmutabilidad,
 * integridad y persistencia real.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { config, isStorageProviderExplicitlyDeclared } from "../config";
import { canonicalBookPiPayload } from "../bookpi/canonical-payload";
import {
  getSigningAlgorithm,
  isSimulatedAlgorithm,
  signBlockHash,
  verifyBlockSignature,
} from "../crypto/bookpi-signer";
import { bookpiPostgresRepository, type BookPiRepository } from "./bookpi-postgres-repository";

/**
 * Autoridad legacy in-memory (`BookPiRepository`: `appendBlock`, `listBlocks`,
 * `getLatestBlock`, `verifyLedger`) y su factory, conservados tal cual para
 * sus consumidores actuales (bookpi-dev-repository, tests de producción).
 */
export type { BookPiRepository };
export { bookpiPostgresRepository };
export default bookpiPostgresRepository;

export function getBookPiRepository(): BookPiRepository {
  return bookpiPostgresRepository;
}

/** Legacy compatibility factory. The historical sync engine intentionally
 * keeps its existing in-memory algorithm; production callers use the
 * explicit createBookpiPostgresRepository() runtime instead. */
export function createBookpiRepository(): BookPiRepository {
  return bookpiPostgresRepository;
}

export type LedgerCategory = "inference" | "processing" | "apis" | "skills" | "other";
export type LedgerStatus = "settled" | "pending" | "refunded" | "pruned";

export interface BlockPIBlock {
  index: number;
  timestamp: string;
  tenantId: string;
  userId: string;
  operation: string;
  category: LedgerCategory;
  costDecimal: string;
  tokensConsumed: number;
  previousHash: string;
  blockHash: string;
  pqcSignature: string | null;
  signatureAlgorithm: string;
  status: LedgerStatus;
  nonce: string;
}

export interface BookPIStoreFile {
  blocks: BlockPIBlock[];
  genesisPreviousHash: string;
}

const GENESIS_PREVIOUS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const STORE_PATH = path.join(process.cwd(), "isabella_bookpi_ledger.json");

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function toCents(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Costo inválido.");
  const cents = Math.round(value * 100);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

/** Halla un bloque por índice dentro del tenant (frontera de tenant obligatoria). */
function findTenantBlock(
  blocks: BlockPIBlock[],
  tenantId: string,
  index: number,
): BlockPIBlock | null {
  return blocks.find((b) => b.tenantId === tenantId && b.index === index) ?? null;
}

/**
 * Crea un repositorio BookPI ligado a una ruta opcional (inyectable).
 * Análisis-estructura: expose métodos puros y capa de persistencia real.
 */
export function createBookpiJsonRepository(storePath: string = STORE_PATH) {
  const runtime = config();
  const isProductionLike =
    runtime.NODE_ENV === "production" ||
    runtime.ISABELLA_RUNTIME_MODE === "production" ||
    runtime.ISABELLA_RUNTIME_MODE === "staging";
  if (isProductionLike) {
    throw new Error(
      "JSON BookPI persistence is disabled in staging and production. Use createBookpiPostgresRepository().",
    );
  }

  // P0-15: aunque el modo no sea production-like, un proveedor de estado
  // autoritativo DECLARADO (postgres|neon) invalida de plano el JSON: nunca
  // se puede caer a fichero cuando la autoridad durable es PostgreSQL.
  if (isStorageProviderExplicitlyDeclared()) {
    const provider = runtime.ISABELLA_STORAGE_PROVIDER;
    const normalized = typeof provider === "string" ? provider.trim().toLowerCase() : "";
    if (["postgres", "neon"].includes(normalized)) {
      throw new Error(
        "JSON BookPI persistence is disabled when ISABELLA_STORAGE_PROVIDER is " +
          `${normalized}. Financial state must live in the authoritative PostgreSQL database.`,
      );
    }
  }

  function loadStore(): BookPIStoreFile {
    if (!fs.existsSync(storePath)) {
      return { blocks: [], genesisPreviousHash: GENESIS_PREVIOUS_HASH };
    }
    try {
      const raw = fs.readFileSync(storePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<BookPIStoreFile>;
      const blocks = Array.isArray(parsed.blocks) ? (parsed.blocks as BlockPIBlock[]) : [];
      const genesisPreviousHash =
        typeof parsed.genesisPreviousHash === "string"
          ? parsed.genesisPreviousHash
          : GENESIS_PREVIOUS_HASH;
      return { blocks, genesisPreviousHash };
    } catch {
      return { blocks: [], genesisPreviousHash: GENESIS_PREVIOUS_HASH };
    }
  }

  function saveStore(store: BookPIStoreFile): void {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
  }

  /**
   * §6.1: hash canónico (mismo payload que el repositorio PostgreSQL).
   * Excluye `blockHash`, `pqcSignature` y `signatureAlgorithm`.
   */
  function computeBlockHash(block: Omit<BlockPIBlock, "blockHash">): string {
    return sha256(canonicalBookPiPayload(block));
  }

  return {
    list(tenantId: string): BlockPIBlock[] {
      return loadStore()
        .blocks.filter((b) => b.tenantId === tenantId)
        .sort((a, b) => a.index - b.index);
    },

    full(): BlockPIBlock[] {
      return loadStore().blocks;
    },

    /** Registra un bloque nuevo encadenado al anterior del tenant (append-only). */
    append(input: {
      tenantId: string;
      userId: string;
      operation: string;
      category: LedgerCategory;
      cost: number;
      tokens: number;
    }): { success: true; block: BlockPIBlock } | { success: false; error: string } {
      if (input.cost < 0) return { success: false, error: "Costo negativo no admitido." };
      if (isSimulatedAlgorithm())
        return { success: false, error: "Algoritmo simulado no permitido." };
      const store = loadStore();

      const tenantBlocks = store.blocks.filter((b) => b.tenantId === input.tenantId);
      const prev = tenantBlocks[tenantBlocks.length - 1];
      const index = tenantBlocks.length;

      const timestamp = new Date().toISOString();
      const previousHash = prev?.blockHash ?? store.genesisPreviousHash;
      const nonce = crypto.randomUUID();
      const base: Omit<BlockPIBlock, "blockHash"> = {
        index,
        timestamp,
        tenantId: input.tenantId,
        userId: input.userId,
        operation: input.operation,
        category: input.category,
        costDecimal: toCents(input.cost),
        tokensConsumed: input.tokens,
        previousHash,
        pqcSignature: null,
        signatureAlgorithm: getSigningAlgorithm(),
        status: "settled",
        nonce,
      };
      const blockHash = computeBlockHash(base);
      // Firma real del hash (nunca null, §6.6).
      const pqcSignature = signBlockHash(blockHash);
      const block: BlockPIBlock = { ...base, blockHash, pqcSignature };
      store.blocks.push(block);
      saveStore(store);
      return { success: true, block };
    },

    batchAppend(
      inputs: Array<{
        tenantId: string;
        userId: string;
        operation: string;
        category: LedgerCategory;
        cost: number;
        tokens: number;
      }>,
    ): { success: true; blocks: BlockPIBlock[] } | { success: false; error: string } {
      if (isSimulatedAlgorithm())
        return { success: false, error: "Algoritmo simulado no permitido." };
      const store = loadStore();
      const newBlocks: BlockPIBlock[] = [];

      for (const input of inputs) {
        if (input.cost < 0) return { success: false, error: "Costo negativo no admitido." };

        // Use updated store state including previously appended blocks in this batch
        const tenantBlocks = store.blocks.filter((b) => b.tenantId === input.tenantId);
        const prev = tenantBlocks[tenantBlocks.length - 1];
        const index = tenantBlocks.length;

        const timestamp = new Date().toISOString();
        const previousHash = prev?.blockHash ?? store.genesisPreviousHash;
        const nonce = crypto.randomUUID();
        const base: Omit<BlockPIBlock, "blockHash"> = {
          index,
          timestamp,
          tenantId: input.tenantId,
          userId: input.userId,
          operation: input.operation,
          category: input.category,
          costDecimal: toCents(input.cost),
          tokensConsumed: input.tokens,
          previousHash,
          pqcSignature: null,
          signatureAlgorithm: getSigningAlgorithm(),
          status: "settled",
          nonce,
        };
        const blockHash = computeBlockHash(base);
        const pqcSignature = signBlockHash(blockHash);
        const block: BlockPIBlock = { ...base, blockHash, pqcSignature };
        store.blocks.push(block);
        newBlocks.push(block);
      }

      saveStore(store);
      return { success: true, blocks: newBlocks };
    },

    query(
      tenantId: string,
      filter: {
        category?: LedgerCategory;
        userId?: string;
        fromDate?: Date;
        toDate?: Date;
      },
    ): BlockPIBlock[] {
      let blocks: BlockPIBlock[] = this.list(tenantId);
      if (filter.category) blocks = blocks.filter((b) => b.category === filter.category);
      if (filter.userId) blocks = blocks.filter((b) => b.userId === filter.userId);
      if (filter.fromDate) blocks = blocks.filter((b) => new Date(b.timestamp) >= filter.fromDate!);
      if (filter.toDate) blocks = blocks.filter((b) => new Date(b.timestamp) <= filter.toDate!);
      return blocks;
    },

    prune(
      tenantId: string,
      maxAgeMs: number,
    ): { success: boolean; prunedCount: number; error?: string } {
      if (isSimulatedAlgorithm())
        return {
          success: false,
          error: "Algoritmo simulado no permitido.",
          prunedCount: 0,
        };
      if (maxAgeMs < 0)
        return {
          success: false,
          error: "maxAgeMs debe ser >= 0",
          prunedCount: 0,
        };

      const store = loadStore();
      const allBlocks = store.blocks;
      const tenantBlocks = allBlocks
        .filter((b) => b.tenantId === tenantId)
        .sort((a, b) => a.index - b.index);

      const cutoff = Date.now() - maxAgeMs;
      const blocksToKeep = tenantBlocks.filter((b) => new Date(b.timestamp).getTime() > cutoff);
      const prunedCount = tenantBlocks.length - blocksToKeep.length;

      if (prunedCount === 0) return { success: true, prunedCount: 0 };

      // Rewrite chain hashes
      let prevHash = store.genesisPreviousHash;
      for (let i = 0; i < blocksToKeep.length; i++) {
        const block = blocksToKeep[i];
        block.index = i;
        block.previousHash = prevHash;

        const base: Omit<BlockPIBlock, "blockHash"> = {
          index: block.index,
          timestamp: block.timestamp,
          tenantId: block.tenantId,
          userId: block.userId,
          operation: block.operation,
          category: block.category,
          costDecimal: block.costDecimal,
          tokensConsumed: block.tokensConsumed,
          previousHash: block.previousHash,
          pqcSignature: null,
          signatureAlgorithm: getSigningAlgorithm(),
          status: block.status,
          nonce: block.nonce,
        };
        block.blockHash = computeBlockHash(base);
        block.pqcSignature = signBlockHash(block.blockHash);
        prevHash = block.blockHash;
      }

      store.blocks = allBlocks.filter((b) => b.tenantId !== tenantId).concat(blocksToKeep);
      saveStore(store);
      return { success: true, prunedCount };
    },

    pruneInactive(inactiveDays: number): {
      success: boolean;
      prunedTenants: string[];
      error?: string;
    } {
      const store = loadStore();
      const now = Date.now();
      const inactiveMs = inactiveDays * 24 * 60 * 60 * 1000;

      // Group by tenant
      const tenantLastActivity = new Map<string, number>();
      for (const block of store.blocks) {
        const time = new Date(block.timestamp).getTime();
        const current = tenantLastActivity.get(block.tenantId) ?? 0;
        if (time > current) {
          tenantLastActivity.set(block.tenantId, time);
        }
      }

      const tenantsToPrune: string[] = [];
      for (const [tenantId, lastActivity] of tenantLastActivity.entries()) {
        if (now - lastActivity > inactiveMs) {
          tenantsToPrune.push(tenantId);
        }
      }

      if (tenantsToPrune.length > 0) {
        store.blocks = store.blocks.filter((b) => !tenantsToPrune.includes(b.tenantId));
        saveStore(store);
      }

      return { success: true, prunedTenants: tenantsToPrune };
    },

    /** Marca un bloque como refundido con un bloque de anulación encadenado. */
    refund(index: number, tenantId: string): { success: boolean; error?: string } {
      const store = loadStore();
      const target = findTenantBlock(store.blocks, tenantId, index);
      if (!target) return { success: false, error: "Bloque no encontrado." };
      if (target.status === "refunded") return { success: false, error: "Ya refundido." };
      // §6.7: idempotencia de refund — nunca dos anulaciones del mismo bloque.
      const alreadyRefunded = store.blocks.some(
        (b) => b.tenantId === tenantId && b.operation === `refund_of_${target.index}`,
      );
      if (alreadyRefunded) return { success: false, error: "Ya refundido." };
      if (isSimulatedAlgorithm())
        return { success: false, error: "Algoritmo simulado no permitido." };

      const tenantBlocks = store.blocks.filter((b) => b.tenantId === tenantId);
      const prev = tenantBlocks[tenantBlocks.length - 1];
      const previousHash = prev?.blockHash ?? store.genesisPreviousHash;
      const nonce = crypto.randomUUID();
      const base: Omit<BlockPIBlock, "blockHash"> = {
        index: tenantBlocks.length,
        timestamp: new Date().toISOString(),
        tenantId,
        userId: target.userId,
        operation: `refund_of_${target.index}`,
        category: target.category,
        costDecimal: target.costDecimal,
        tokensConsumed: 0,
        previousHash,
        pqcSignature: null,
        signatureAlgorithm: getSigningAlgorithm(),
        status: "refunded",
        nonce,
      };
      const blockHash = computeBlockHash(base);
      const pqcSignature = signBlockHash(blockHash);
      const block: BlockPIBlock = { ...base, blockHash, pqcSignature };
      store.blocks.push(block);
      saveStore(store);
      return { success: true };
    },

    /** Verifica la integridad de toda la cadena. */
    verifyIntegrity(tenantId?: string): {
      success: boolean;
      error?: string;
      corruptedIndex?: number;
    } {
      const store = loadStore();
      const tenantIds = tenantId
        ? [tenantId]
        : Array.from(new Set(store.blocks.map((b) => b.tenantId)));

      for (const tId of tenantIds) {
        const tenantBlocks = store.blocks
          .filter((b) => b.tenantId === tId)
          .sort((a, b) => a.index - b.index);
        let prev = store.genesisPreviousHash;

        for (let i = 0; i < tenantBlocks.length; i++) {
          const block = tenantBlocks[i];
          if (!block)
            return {
              success: false,
              error: "Bloque ausente.",
              corruptedIndex: i,
            };
          if (block.index !== i)
            return {
              success: false,
              error: "Índice incorrecto.",
              corruptedIndex: i,
            };
          if (block.previousHash !== prev) {
            return {
              success: false,
              error: "Cadena rota.",
              corruptedIndex: block.index,
            };
          }
          // §6.1: recomputa con el MISMO payload canónico que append().
          if (computeBlockHash(block) !== block.blockHash) {
            return {
              success: false,
              error: "Bloque alterado.",
              corruptedIndex: block.index,
            };
          }
          // §6.5: verifica la firma real (rechaza sin firma o firma inválida).
          if (!verifyBlockSignature(block.blockHash, block.pqcSignature)) {
            return {
              success: false,
              error: "Firma inválida o ausente.",
              corruptedIndex: block.index,
            };
          }
          prev = block.blockHash;
        }
      }
      return { success: true };
    },
  };
}

export type BookpiRepository = ReturnType<typeof createBookpiJsonRepository>;
export const BOOKPI_REPOSITORY = {
  create: createBookpiJsonRepository,
};
