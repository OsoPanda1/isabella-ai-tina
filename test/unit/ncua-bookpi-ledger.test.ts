import { describe, expect, it } from "vitest";

import { BookPILedgerAuditor, BOOKPI_NCUA_GENESIS } from "@/lib/ncua/bookpi-trajectory";
import { QUPQuantumBridgeIntegrator } from "@/lib/ncua/quantum-align";
import type { ContinuousConceptVector } from "@/lib/ncua/concept-engine";

const TEST_HMAC_KEY = "ncua-test-hmac-key-for-unit-tests-only-12345678";

const dummyConcept: ContinuousConceptVector = {
  conceptId: "concept_ledger_test",
  latentDimensions: [0.3, 0.4, -0.2, 0.6, 0, 0.1, 0.8, -0.5],
  semanticEnergy: 0.42,
  epistemicConfidence: 96,
};

function dummyQuantumSig() {
  return new QUPQuantumBridgeIntegrator().executeQuantumStateAlignment(dummyConcept);
}

describe("ncua:bookpi-trajectory", () => {
  it("cadena genesis es 64 ceros hex", () => {
    expect(BOOKPI_NCUA_GENESIS).toHaveLength(64);
    expect(BOOKPI_NCUA_GENESIS).toBe("0".repeat(64));
  });

  it("primer registro usa genesis como previousHash", () => {
    const ledger = new BookPILedgerAuditor({ hmacKey: TEST_HMAC_KEY });
    const entry = ledger.recordNCUATransaction("tenant-a", 5, dummyConcept, dummyQuantumSig());
    expect(entry.previousHash).toBe(BOOKPI_NCUA_GENESIS);
    expect(entry.currentHash).toHaveLength(128);
    expect(entry.hmacSignature).toMatch(/^ncua-bookpi-v1:/);
    expect(entry.merkleRoot).toHaveLength(128);
  });

  it("encadenamiento: previousHash del segundo bloque es currentHash del primero", () => {
    const ledger = new BookPILedgerAuditor({ hmacKey: TEST_HMAC_KEY });
    const e1 = ledger.recordNCUATransaction("tenant-a", 3, dummyConcept, dummyQuantumSig());
    const e2 = ledger.recordNCUATransaction("tenant-a", 4, dummyConcept, dummyQuantumSig());
    expect(e2.previousHash).toBe(e1.currentHash);
    expect(ledger.size).toBe(2);
  });

  it("integridad válida con clave correcta", () => {
    const ledger = new BookPILedgerAuditor({ hmacKey: TEST_HMAC_KEY });
    ledger.recordNCUATransaction("tenant-a", 5, dummyConcept, dummyQuantumSig());
    ledger.recordNCUATransaction("tenant-a", 5, dummyConcept, dummyQuantumSig());
    ledger.recordNCUATransaction("tenant-a", 5, dummyConcept, dummyQuantumSig());
    const report = ledger.verifyIntegrity();
    expect(report.valid).toBe(true);
    expect(report.checkedEntries).toBe(3);
  });

  it("manipulación de currentHash se detecta", () => {
    const ledger = new BookPILedgerAuditor({ hmacKey: TEST_HMAC_KEY });
    ledger.recordNCUATransaction("tenant-a", 5, dummyConcept, dummyQuantumSig());
    ledger.recordNCUATransaction("tenant-a", 5, dummyConcept, dummyQuantumSig());
    // inject tamper via ledgerEntries getter
    const entries = (ledger as unknown as { ledgerEntries: Array<{ currentHash: string }> })
      .ledgerEntries;
    entries[0].currentHash = "tampered".padEnd(128, "0");
    const report = ledger.verifyIntegrity();
    expect(report.valid).toBe(false);
    expect(report.firstBrokenIndex).toBe(0);
  });

  it("clave incorrecta produce firma inválida", () => {
    const ledgerA = new BookPILedgerAuditor({ hmacKey: TEST_HMAC_KEY });
    ledgerA.recordNCUATransaction("tenant-a", 5, dummyConcept, dummyQuantumSig());
    // forge a ledger with wrong key trying to verify
    const ledgerB = new BookPILedgerAuditor({ hmacKey: "wrong-key-12345678901234567890123456" });
    const entry = ledgerA.ledgerEntries[0];
    const forgedEntry = { ...entry, hmacSignature: entry.hmacSignature }; // use same sig but different key context
    // verifyIntegrity on B uses B's key, so signatures from A will fail
    // We simulate by pushing forged entry into B
    (ledgerB as unknown as { ledgerEntries: Array<typeof entry> }).ledgerEntries.push(forgedEntry);
    (ledgerB as unknown as { lastHash: string }).lastHash = forgedEntry.currentHash;
    const report = ledgerB.verifyIntegrity();
    expect(report.valid).toBe(false);
    expect(report.reason).toContain("firma HMAC-SHA3-512 inválida");
  });

  it("sin clave hmacKey falla al registrar (fail-closed)", () => {
    const ledger = new BookPILedgerAuditor({});
    expect(() => {
      ledger.recordNCUATransaction("tenant-a", 5, dummyConcept, dummyQuantumSig());
    }).toThrow(/fail-closed/);
  });

  it("ledger vacío reporta integridad válida", () => {
    const ledger = new BookPILedgerAuditor({ hmacKey: TEST_HMAC_KEY });
    const report = ledger.verifyIntegrity();
    expect(report.valid).toBe(true);
    expect(report.checkedEntries).toBe(0);
  });
});
