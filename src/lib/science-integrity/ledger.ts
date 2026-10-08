/**
 * Science Integrity — Ledger de eventos encadenados (src/lib/science-integrity/ledger.ts)
 * --------------------------------------------------------------------------------------
 * Log append-only con hash chaining (SHA-256 + JCS RFC 8785), alineado con el Evidence
 * Ledger de Isabella (`docs/architecture/ADR-012-evidence-ledger.md`) y con la fórmula
 * de hash de IGDS Genesis (`computeEntryHash`). Un solo ledger: el Hypercore es rail de
 * ejecución, no fuente única de verdad (§5 de 10-integracion).
 *
 * La implementación de referencia es en memoria (como `approval-repository`); producción
 * debe persistir en PostgreSQL con el mismo contrato de hashes.
 */
import { randomUUID } from "node:crypto";
import { canonicalize } from "../igds/canonical";
import { digestHex } from "../igds/digests";
import {
  type ScienceEventType,
  type ScienceLedgerBlock,
} from "./contracts";

export const SCIENCE_GENESIS_PREVIOUS_HASH = "0".repeat(64);

export interface ScienceIntegrityStore {
  append(block: ScienceLedgerBlock): Promise<void>;
  list(): Promise<readonly ScienceLedgerBlock[]>;
  head(): Promise<ScienceLedgerBlock | null>;
}

export class InMemoryScienceIntegrityStore implements ScienceIntegrityStore {
  private readonly blocks: ScienceLedgerBlock[] = [];

  async append(block: ScienceLedgerBlock): Promise<void> {
    this.blocks.push(block);
  }

  async list(): Promise<readonly ScienceLedgerBlock[]> {
    return [...this.blocks];
  }

  async head(): Promise<ScienceLedgerBlock | null> {
    return this.blocks.length > 0 ? this.blocks[this.blocks.length - 1]! : null;
  }
}

export function canonicalBlockPayload(
  block: Omit<ScienceLedgerBlock, "currentHash">,
): Record<string, unknown> {
  return {
    seq: block.seq,
    eventType: block.eventType,
    docId: block.docId,
    payload: block.payload,
    payloadHash: block.payloadHash,
    previousHash: block.previousHash,
    createdAt: block.createdAt,
    signerId: block.signerId,
  };
}

export function computeScienceBlockHash(
  block: Omit<ScienceLedgerBlock, "currentHash">,
): string {
  return digestHex("sha256", canonicalize(canonicalBlockPayload(block)));
}

export interface AppendEventInput {
  eventType: ScienceEventType;
  docId: string;
  payload?: Record<string, unknown>;
  signerId?: string;
  createdAt?: string;
  eventId?: string;
}

export class ScienceIntegrityLedger {
  constructor(private readonly store: ScienceIntegrityStore) {}

  async appendEvent(input: AppendEventInput): Promise<ScienceLedgerBlock> {
    const previous = await this.store.head();
    const eventId = input.eventId ?? `evt_${randomUUID()}`;
    const payload: Record<string, unknown> = { ...(input.payload ?? {}), eventId };
    const prepared: ScienceLedgerBlock = {
      seq: previous ? previous.seq + 1 : 0,
      eventType: input.eventType,
      docId: input.docId,
      payload,
      payloadHash: digestHex("sha256", canonicalize(payload)),
      previousHash: previous ? previous.currentHash : SCIENCE_GENESIS_PREVIOUS_HASH,
      currentHash: "",
      createdAt: input.createdAt ?? new Date().toISOString(),
      signerId: input.signerId ?? "science-integrity-ledger",
    };
    const currentHash = computeScienceBlockHash(prepared);
    const block: ScienceLedgerBlock = { ...prepared, currentHash };
    await this.store.append(block);
    return block;
  }

  async history(docId?: string): Promise<readonly ScienceLedgerBlock[]> {
    const blocks = await this.store.list();
    if (!docId) return blocks;
    return blocks.filter((block) => block.docId === docId);
  }

  async verifyChain(): Promise<{
    valid: boolean;
    checked: number;
    total: number;
    corruptSequence?: number;
    reason?: string;
  }> {
    const blocks = await this.store.list();
    let previousHash = SCIENCE_GENESIS_PREVIOUS_HASH;
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      if (block.seq !== index) {
        return { valid: false, checked: index, total: blocks.length, corruptSequence: block.seq, reason: "SEQ_DISCONTINUOUS" };
      }
      if (block.previousHash !== previousHash) {
        return { valid: false, checked: index, total: blocks.length, corruptSequence: block.seq, reason: "CHAIN_BROKEN" };
      }
      const { currentHash: _current, ...rest } = block;
      const recomputed = computeScienceBlockHash(rest);
      if (recomputed !== block.currentHash) {
        return { valid: false, checked: index, total: blocks.length, corruptSequence: block.seq, reason: "BLOCK_TAMPERED" };
      }
      previousHash = block.currentHash;
    }
    return { valid: true, checked: blocks.length, total: blocks.length };
  }
}

export function tailEventOf(block: ScienceLedgerBlock): ScienceEventType {
  return block.eventType;
}