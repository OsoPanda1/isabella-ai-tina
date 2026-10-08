/**
 * Science Integrity — B0: ingestión JSON-LD + ledger encadenado (tests)
 * --------------------------------------------------------------------
 * Contratos de ingreso, digests, Merkle RFC 6962 e integridad append-only.
 */
import { describe, expect, it } from "vitest";
import { canonicalize } from "@/lib/igds/canonical";
import { digestHex } from "@/lib/igds/digests";
import {
  computeScienceBlockHash,
  InMemoryScienceIntegrityStore,
  ScienceIntegrityLedger,
  SCIENCE_GENESIS_PREVIOUS_HASH,
} from "@/lib/science-integrity/ledger";
import {
  ingestScientificDocument,
  scientificFingerprint,
} from "@/lib/science-integrity/ingest";
import { parseScientificDocument } from "@/lib/science-integrity/contracts";

const ORCID = "0009-0008-5050-1539";

function buildDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "isabella.scientific-document.v1",
    docId: "doc-2026-0001",
    title: "Integridad hídrica y memoria territorial de Real del Monte",
    authors: [{ name: "Anubis Villaseñor", orcid: ORCID }],
    domains: ["territorial"],
    abstract:
      "La gestión hídrica del distrito minero de Real del Monte acopla memoria territorial, " +
      "procedencia documental y observación auditada; este trabajo publica los datos abiertos " +
      "con control de integridad hash y sello de procedencia.",
    claims: [
      {
        assertionId: "123e4567-e89b-12d3-a456-426614174000",
        assertion:
          "Los acervos hídricos de Real del Monte conservan procedencia verificable mediante sellado hash.",
        citedSources: [
          { sourceType: "doi", value: "10.5281/zenodo.20606361" },
          { sourceType: "url", value: "https://doi.org/10.5281/zenodo.20606361" },
        ],
      },
    ],
    artifacts: [
      { artifactId: "a1", name: "datos.csv", mimeType: "text/csv", content: "x,y\n1,2\n3,4" },
      { artifactId: "a2", name: "metodo.md", mimeType: "text/markdown", content: "Método abierto" },
    ],
    createdAt: "2026-10-01T10:00:00Z",
    tenantId: "nodo_cero_real_del_monte",
    ...overrides,
  };
}

describe("Science Integrity — ledger encadenado", () => {
  it("acumula bloques con hash chaining y verifica cadena válida", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const first = await ledger.appendEvent({
      eventType: "ingest_event",
      docId: "doc-a",
      payload: { doc_id: "doc-a" },
    });
    const second = await ledger.appendEvent({
      eventType: "pipeline_run",
      docId: "doc-a",
      payload: { pipeline_id: "pl_1" },
    });

    expect(first.seq).toBe(0);
    expect(first.previousHash).toBe(SCIENCE_GENESIS_PREVIOUS_HASH);
    expect(second.seq).toBe(1);
    expect(second.previousHash).toBe(first.currentHash);
    expect(first.currentHash).toHaveLength(64);
    expect(second.payloadHash).toBe(digestHex("sha256", canonicalize(second.payload)));

    const integrity = await ledger.verifyChain();
    expect(integrity).toEqual({ valid: true, checked: 2, total: 2 });

    const history = await ledger.history("doc-a");
    expect(history).toHaveLength(2);
    expect(await ledger.history("doc-other")).toHaveLength(0);
  });

  it("detecta manipulación de un bloque (BLOCK_TAMPERED)", async () => {
    const store = new InMemoryScienceIntegrityStore();
    const payload = { eventId: "evt_tamper" };
    const prepared = {
      seq: 0,
      eventType: "verification_event" as const,
      docId: "doc-b",
      payload,
      payloadHash: digestHex("sha256", canonicalize(payload)),
      previousHash: SCIENCE_GENESIS_PREVIOUS_HASH,
      createdAt: "2026-10-01T10:00:00Z",
      signerId: "tamper-test",
    };
    const currentHash = computeScienceBlockHash(prepared);
    // El bloque almacenado dice un payloadHash distinto al que firmó su currentHash.
    await store.append({
      ...prepared,
      currentHash,
      payloadHash: digestHex("sha256", canonicalize({ hacked: true })),
    });

    const ledger = new ScienceIntegrityLedger(store);
    const integrity = await ledger.verifyChain();
    expect(integrity.valid).toBe(false);
    expect(integrity.reason).toBe("BLOCK_TAMPERED");
  });

  it("detecta cadena rota (CHAIN_BROKEN)", async () => {
    const store = new InMemoryScienceIntegrityStore();
    const payload = { eventId: "evt_chain" };
    const createdAt = "2026-10-01T10:00:00Z";

    const ledger = new ScienceIntegrityLedger(store);
    await ledger.appendEvent({
      eventType: "ingest_event",
      docId: "doc-c",
      payload,
      createdAt,
    });
    // Bloque 2 que apunta a un previousHash falso (cadena rota).
    await store.append({
      seq: 1,
      eventType: "verification_event",
      docId: "doc-c",
      payload: { eventId: "evt_c2" },
      payloadHash: "0".repeat(64),
      previousHash: "1".repeat(64),
      currentHash: computeScienceBlockHash({
        seq: 1,
        eventType: "verification_event",
        docId: "doc-c",
        payload: { eventId: "evt_c2" },
        payloadHash: "0".repeat(64),
        previousHash: "1".repeat(64),
        createdAt,
        signerId: "tamper-test",
      }),
      createdAt,
      signerId: "tamper-test",
    });

    const integrity = await ledger.verifyChain();
    expect(integrity.valid).toBe(false);
    expect(integrity.reason).toBe("CHAIN_BROKEN");
  });
});

describe("Science Integrity — ingestión B0", () => {
  it("ingiere documento válido: digests + Merkle RFC 6962 + 2 eventos de ledger", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const result = await ingestScientificDocument(buildDocument(), { ledger });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe("isabella.scientific-document.v1");
    expect(result.value.artifacts).toHaveLength(2);
    expect(result.value.artifacts[0]!.contentHash).toHaveLength(64);
    expect(result.value.merkleRoot).toHaveLength(64);
    expect(result.value.ledgerEvent.eventType).toBe("ingest_event");
    expect(result.value.ledgerEvent.payload.merkle_root).toBe(result.value.merkleRoot);

    const events = await ledger.history("doc-2026-0001");
    expect(events.map((event) => event.eventType)).toEqual([
      "ingest_event",
      "verification_event",
    ]);
    const integrity = await ledger.verifyChain();
    expect(integrity.valid).toBe(true);
  });

  it("es determinista: mismo documento → misma raíz Merkle y fingerprint", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const first = await ingestScientificDocument(buildDocument(), { ledger });
    const second = await ingestScientificDocument(buildDocument(), { ledger });
    expect(first.ok && second.ok).toBe(true);
    if (!(first.ok && second.ok)) return;
    expect(second.value.merkleRoot).toBe(first.value.merkleRoot);
    expect(second.value.artifacts).toEqual(first.value.artifacts);

    const parsed = parseScientificDocument(buildDocument());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(scientificFingerprint(parsed.value)).toBe(scientificFingerprint(parsed.value));
  });

  it("rechaza documento inválido sin tocar el ledger (fail-closed)", async () => {
    const store = new InMemoryScienceIntegrityStore();
    const ledger = new ScienceIntegrityLedger(store);
    const result = await ingestScientificDocument(
      buildDocument({ schema: "isabella.wrong.v1", claims: [] }),
      { ledger },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.startsWith("invalid_scientific_document")).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });

  it("rechaza ORCID malformado del autor", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const result = await ingestScientificDocument(
      buildDocument({ authors: [{ name: "Test", orcid: "12345" }] }),
      { ledger },
    );
    expect(result.ok).toBe(false);
  });
});