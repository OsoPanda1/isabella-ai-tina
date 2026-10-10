/**
 * Science Integrity — Ingestión JSON-LD (B0) (src/lib/science-integrity/ingest.ts)
 * --------------------------------------------------------------------------------
 * Adapter de ingestión: valida el documento científico con zod, calcula digests
 * SHA-256 de abstract + artefactos, construye el árbol Merkle RFC 6962 y registra
 * el `ingest_event` en el ledger encadenado.
 *
 * Fail-closed: documento inválido → `{ ok: false }`, nunca se registra un evento
 * con contenido malformado.
 */
import { hashLeaf, merkleRoot } from "../igds/merkle";
import { canonicalize } from "../igds/canonical";
import { digestHex } from "../igds/digests";
import {
  parseScientificDocument,
  type ScientificDocument,
  type ScienceLedgerBlock,
} from "./contracts";
import { ScienceIntegrityLedger } from "./ledger";

export interface ArtifactDigest {
  artifactId: string;
  name: string;
  mimeType: string;
  contentHash: string;
  sizeBytes: number;
}

export interface IngestResult {
  docId: string;
  schemaVersion: "isabella.scientific-document.v1";
  artifacts: ArtifactDigest[];
  merkleRoot: string;
  ledgerEvent: ScienceLedgerBlock;
}

export interface IngestDependencies {
  ledger: ScienceIntegrityLedger;
}

export async function ingestScientificDocument(
  input: unknown,
  dependencies: IngestDependencies,
): Promise<{ ok: true; value: IngestResult } | { ok: false; reason: string }> {
  const parsed = parseScientificDocument(input);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const doc = parsed.value;
  const artifacts: ArtifactDigest[] = doc.artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    name: artifact.name,
    mimeType: artifact.mimeType,
    contentHash: digestHex("sha256", artifact.content),
    sizeBytes: Buffer.byteLength(artifact.content, "utf8"),
  }));

  const leaves: string[] = [hashLeaf(digestHex("sha256", doc.abstract)), ...artifacts.map((a) => hashLeaf(a.contentHash))];
  const root = merkleRoot(leaves);

  const ledgerEvent = await dependencies.ledger.appendEvent({
    eventType: "ingest_event",
    docId: doc.docId,
    signerId: doc.tenantId,
    payload: {
      doc_id: doc.docId,
      merkle_root: root,
      schema_version: doc.schema,
      tenant_id: doc.tenantId,
      artifact_count: artifacts.length,
      claim_count: doc.claims.length,
    },
  });

  await dependencies.ledger.appendEvent({
    eventType: "verification_event",
    docId: doc.docId,
    signerId: doc.tenantId,
    payload: {
      doc_id: doc.docId,
      verifier: "ingest",
      score: 1,
      result: "INTEGRITY_OK",
      evidence_hashes: [ledgerEvent.currentHash],
      canonical_fingerprint: digestHex("sha256", canonicalize(doc)),
    },
  });

  return {
    ok: true,
    value: { docId: doc.docId, schemaVersion: doc.schema, artifacts, merkleRoot: root, ledgerEvent },
  };
}

export function scientificFingerprint(doc: ScientificDocument): string {
  return digestHex("sha256", canonicalize(doc));
}