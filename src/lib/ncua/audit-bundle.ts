import { SovereignAudit } from "../sovereign-audit";
import {
  assertManifest,
  canonicalDocumentLine,
  type SovereignDatasetManifest,
  type SovereignDocument,
} from "./dataset-contract";

export type PolicyDecision = "allowed" | "requires_approval" | "denied";

export interface NcuAuditBundle {
  traceId: string;
  datasetVersion: string;
  policy: PolicyDecision;
  reason: string;
  merkleRoot: string;
  documentHashes: string[];
  createdAt: string;
}

export function evaluateDatasetPolicy(documents: readonly SovereignDocument[]): {
  decision: PolicyDecision;
  reason: string;
} {
  if (documents.length === 0) return { decision: "denied", reason: "Dataset vacío" };
  if (documents.some((document) => document.consent === "unknown")) {
    return { decision: "denied", reason: "Documento sin procedencia o consentimiento verificable" };
  }
  if (documents.some((document) => document.quality < 0.5)) {
    return {
      decision: "requires_approval",
      reason: "El dataset contiene documentos de baja calidad",
    };
  }
  return {
    decision: "allowed",
    reason: "Procedencia, consentimiento y calidad mínimos verificados",
  };
}

export function createNcuAuditBundle(
  traceId: string,
  manifest: SovereignDatasetManifest,
  documents: readonly SovereignDocument[],
): NcuAuditBundle {
  if (!traceId.trim()) throw new Error("traceId is required");
  assertManifest(manifest);
  if (manifest.documents !== documents.length) throw new Error("Manifest/document count mismatch");
  const policy = evaluateDatasetPolicy(documents);
  const canonicalLeaves = documents.map(canonicalDocumentLine);
  const tree = SovereignAudit.buildMerkleTree(canonicalLeaves);
  return {
    traceId,
    datasetVersion: manifest.version,
    policy: policy.decision,
    reason: policy.reason,
    merkleRoot: tree.root,
    documentHashes: tree.leaves,
    createdAt: new Date().toISOString(),
  };
}

export function verifyNcuAuditBundle(
  bundle: NcuAuditBundle,
  documents: readonly SovereignDocument[],
): boolean {
  if (!bundle.traceId || !bundle.merkleRoot || documents.length !== bundle.documentHashes.length)
    return false;
  try {
    const tree = SovereignAudit.buildMerkleTree(documents.map(canonicalDocumentLine));
    return (
      tree.root === bundle.merkleRoot &&
      tree.leaves.every((hash, index) => hash === bundle.documentHashes[index])
    );
  } catch {
    return false;
  }
}
