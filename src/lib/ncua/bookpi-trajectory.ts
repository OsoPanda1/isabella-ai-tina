/**
 * NCUA v2.0 — BookPI Ledger Auditor.
 *
 * Registro append-only de contabilidad inmutable con cadena SHA3-512, sello
 * HMAC-SHA3-512 (soberano, usando `AEGIS_AUDIT_SECRET` por defecto o una
 * clave inyectada) y raíz Merkle por bloque. La verificación de integridad
 * recalcular la cadena completa y rechaza manipulación en tiempo constante.
 */

import * as crypto from "node:crypto";
import { SovereignAudit } from "../sovereign-audit";
import type { ContinuousConceptVector } from "./concept-engine";
import type { QUPQuantumStateSignature } from "./quantum-align";

export const BOOKPI_NCUA_GENESIS =
  "0000000000000000000000000000000000000000000000000000000000000000";
export const BOOKPI_NCUA_SIGNATURE_PREFIX = "ncua-bookpi-v1:";

export interface BookPILedgerEntry {
  entryId: string;
  previousHash: string;
  currentHash: string;
  timestamp: string;
  tenantId: string;
  patchCount: number;
  conceptTrajectoryHash: string;
  quantumSeal: string;
  hmacSignature: string;
  merkleRoot: string;
}

export interface LedgerIntegrityReport {
  valid: boolean;
  checkedEntries: number;
  firstBrokenIndex: number | null;
  reason: string | null;
}

export interface BookpiLedgerOptions {
  initialHash?: string;
  hmacKey?: string;
}

export class BookPILedgerAuditor {
  private readonly genesis: string;
  private lastHash: string;
  private readonly hmacKey: string | null;
  private readonly entries: BookPILedgerEntry[] = [];

  constructor(options: BookpiLedgerOptions = {}) {
    this.genesis = options.initialHash ?? BOOKPI_NCUA_GENESIS;
    this.lastHash = this.genesis;
    this.hmacKey = options.hmacKey ?? null;
  }

  private resolveKey(): string | null {
    return this.hmacKey;
  }

  private requireKey(): string {
    const key = this.resolveKey();
    if (!key) {
      throw new Error(
        "[BookPILedgerAuditor] AEGIS_AUDIT_SECRET ausente: sello NCUA denegado (fail-closed).",
      );
    }
    return key;
  }

  private hmacSign(key: string, payloadHash: string, prefix: string): string {
    const mac = crypto.createHmac("sha3-512", key).update(payloadHash, "utf8").digest("base64url");
    return `${prefix}${mac}`;
  }

  private hmacVerify(key: string, payloadHash: string, signature: string, prefix: string): boolean {
    if (!signature.startsWith(prefix)) return false;
    const expected = crypto.createHmac("sha3-512", key).update(payloadHash, "utf8").digest();
    const presented = Buffer.from(signature.slice(prefix.length), "base64url");
    if (presented.length !== expected.length) return false;
    return crypto.timingSafeEqual(presented, expected);
  }

  private merkleRootFor(hashes: string[]): string {
    return SovereignAudit.buildMerkleTree(hashes).root;
  }

  public get size(): number {
    return this.entries.length;
  }

  public get tail(): string {
    return this.lastHash;
  }

  public get ledgerEntries(): readonly BookPILedgerEntry[] {
    return this.entries;
  }

  public recordNCUATransaction(
    tenantId: string,
    patchCount: number,
    concept: ContinuousConceptVector,
    quantumSig: QUPQuantumStateSignature,
  ): BookPILedgerEntry {
    const key = this.requireKey();
    const entryIndex = this.entries.length + 1;
    const entryHash = crypto.createHash("sha256").update(this.lastHash).digest("hex").slice(0, 6);
    const entryId = `bpi_${entryIndex.toString(16)}_${entryHash}`;
    const timestamp = new Date().toISOString();
    const payload = `${this.lastHash}|${entryId}|${tenantId}|${patchCount}|${concept.conceptId}|${quantumSig.merkleSeal}|${timestamp}`;
    const currentHash = crypto.createHash("sha3-512").update(payload).digest("hex");
    const merkleRoot = this.merkleRootFor([
      ...this.entries.map((entry) => entry.currentHash),
      currentHash,
    ]);
    const hmacSignature = this.hmacSign(key, currentHash, BOOKPI_NCUA_SIGNATURE_PREFIX);
    const entry: BookPILedgerEntry = {
      entryId,
      previousHash: this.lastHash,
      currentHash,
      timestamp,
      tenantId,
      patchCount,
      conceptTrajectoryHash: concept.conceptId,
      quantumSeal: quantumSig.merkleSeal,
      hmacSignature,
      merkleRoot,
    };
    this.entries.push(entry);
    this.lastHash = currentHash;
    return entry;
  }

  public verifyIntegrity(): LedgerIntegrityReport {
    if (this.entries.length === 0) {
      return { valid: true, checkedEntries: 0, firstBrokenIndex: null, reason: null };
    }
    const key = this.resolveKey();
    if (!key) {
      return {
        valid: false,
        checkedEntries: this.entries.length,
        firstBrokenIndex: 0,
        reason: "Sin clave de firma HMAC-SHA3-512 para verificación.",
      };
    }
    let previous = this.genesis;
    for (let index = 0; index < this.entries.length; index++) {
      const entry = this.entries[index];
      if (entry.previousHash !== previous) {
        return {
          valid: false,
          checkedEntries: index,
          firstBrokenIndex: index,
          reason: `Cadena rota en bloque ${index}: previousHash no coincide con el hash del bloque anterior.`,
        };
      }
      const payload = `${entry.previousHash}|${entry.entryId}|${entry.tenantId}|${entry.patchCount}|${entry.conceptTrajectoryHash}|${entry.quantumSeal}|${entry.timestamp}`;
      const expectedHash = crypto.createHash("sha3-512").update(payload).digest("hex");
      if (expectedHash !== entry.currentHash) {
        return {
          valid: false,
          checkedEntries: index,
          firstBrokenIndex: index,
          reason: `Cadena rota en bloque ${index}: currentHash no coincide con la recomputación.`,
        };
      }
      if (
        !this.hmacVerify(key, entry.currentHash, entry.hmacSignature, BOOKPI_NCUA_SIGNATURE_PREFIX)
      ) {
        return {
          valid: false,
          checkedEntries: index,
          firstBrokenIndex: index,
          reason: `Cadena rota en bloque ${index}: firma HMAC-SHA3-512 inválida.`,
        };
      }
      previous = entry.currentHash;
    }
    return {
      valid: true,
      checkedEntries: this.entries.length,
      firstBrokenIndex: null,
      reason: null,
    };
  }
}
