import { createHash } from "node:crypto";
import type { DocumentIdentity, KnowledgeClaim, KnowledgeEntity } from "./contracts";

export interface IKESEvidenceManifest {
  readonly version: "ikes-evidence-v1";
  readonly generatedAt: string;
  readonly documents: readonly { id: string; sha256: string; entityId?: string }[];
  readonly claims: readonly { id: string; status: string; sourceDocumentIds: readonly string[] }[];
  readonly integrityHash: string;
}

export interface IKESVerification {
  readonly pass: boolean;
  readonly findings: readonly string[];
  readonly manifest: IKESEvidenceManifest;
}

export function createEvidenceManifest(
  documents: readonly DocumentIdentity[],
  claims: readonly KnowledgeClaim[],
): IKESEvidenceManifest {
  const payload = {
    version: "ikes-evidence-v1" as const,
    generatedAt: new Date().toISOString(),
    documents: documents.map(({ id, hash, entityId }) => ({ id, sha256: hash.sha256, entityId })),
    claims: claims.map(({ id, status, sourceDocumentIds }) => ({ id, status, sourceDocumentIds })),
  };
  return {
    ...payload,
    integrityHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}

export function verifyKnowledgeGraph(
  documents: readonly DocumentIdentity[],
  entities: readonly KnowledgeEntity[],
  claims: readonly KnowledgeClaim[],
): IKESVerification {
  const findings: string[] = [];
  const documentIds = new Set(documents.map((document) => document.id));
  const entityIds = new Set(entities.map((entity) => entity.id));
  const claimIds = new Set(claims.map((claim) => claim.id));
  const hashes = new Set<string>();
  for (const document of documents) {
    if (hashes.has(document.hash.sha256)) findings.push(`duplicate_physical_hash:${document.id}`);
    hashes.add(document.hash.sha256);
    if (document.entityId && !entityIds.has(document.entityId))
      findings.push(`missing_entity:${document.id}`);
  }
  for (const claim of claims) {
    if (!entityIds.has(claim.entityId)) findings.push(`claim_entity_missing:${claim.id}`);
    if (claim.sourceDocumentIds.some((id) => !documentIds.has(id)))
      findings.push(`claim_source_missing:${claim.id}`);
    if (claim.supersedes?.some((id) => !claimIds.has(id)))
      findings.push(`claim_supersedes_missing:${claim.id}`);
    if (
      claim.validFrom &&
      claim.validUntil &&
      Date.parse(claim.validFrom) > Date.parse(claim.validUntil)
    )
      findings.push(`claim_temporal_range_invalid:${claim.id}`);
  }
  for (const entity of entities) {
    if (entity.documentIds.some((id) => !documentIds.has(id)))
      findings.push(`entity_document_missing:${entity.id}`);
    if (entity.claimIds.some((id) => !claimIds.has(id)))
      findings.push(`entity_claim_missing:${entity.id}`);
  }
  return {
    pass: findings.length === 0,
    findings,
    manifest: createEvidenceManifest(documents, claims),
  };
}
