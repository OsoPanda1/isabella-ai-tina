import { createHash } from "node:crypto";
import type {
  DocumentIdentity,
  EvolutionDecision,
  IdentityResult,
  IngestedDocument,
  KnowledgeEntity,
} from "./contracts";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeKnowledgeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function createDocumentIdentity(input: IngestedDocument): DocumentIdentity {
  const content = normalizeKnowledgeText(input.content);
  const title = normalizeKnowledgeText(input.title);
  return {
    id: input.id,
    title: input.title,
    domain: input.domain,
    topic: input.topic,
    source: input.source,
    publicationDate: input.publicationDate,
    retrievalDate: new Date().toISOString(),
    hash: { sha256: digest(input.content) },
    structuralFingerprint: digest(
      `${title}|${input.domain}|${input.topic}|${content.split(" ").length}`,
    ),
    semanticFingerprint: digest(`${input.domain}|${input.topic}|${content.toLowerCase()}`),
    entityId: undefined,
    version: input.version,
  };
}

function entityKey(document: DocumentIdentity): string {
  return digest(
    `${normalizeKnowledgeText(document.title).toLowerCase()}|${document.domain}|${document.topic}`,
  ).slice(0, 20);
}

export function classifyDocument(
  document: DocumentIdentity,
  existing: readonly DocumentIdentity[],
): IdentityResult {
  const exact = existing.find((candidate) => candidate.hash.sha256 === document.hash.sha256);
  if (exact) {
    return {
      document: { ...document, entityId: exact.entityId },
      entityId: exact.entityId ?? entityKey(exact),
      decision: "EXACT_DUPLICATE",
      matchedDocumentId: exact.id,
    };
  }

  const sameEntity = existing.find(
    (candidate) =>
      candidate.domain === document.domain &&
      candidate.topic === document.topic &&
      normalizeKnowledgeText(candidate.title).toLowerCase() ===
        normalizeKnowledgeText(document.title).toLowerCase(),
  );
  if (!sameEntity) {
    return {
      document: { ...document, entityId: entityKey(document) },
      entityId: entityKey(document),
      decision: "NEW_KNOWLEDGE",
    };
  }

  const entityId = sameEntity.entityId ?? entityKey(sameEntity);
  const decision: EvolutionDecision =
    document.version && sameEntity.version && document.version !== sameEntity.version
      ? "UPDATE"
      : document.semanticFingerprint === sameEntity.semanticFingerprint
        ? "LOGICAL_DUPLICATE"
        : "ENRICHMENT";
  return {
    document: { ...document, entityId },
    entityId,
    decision,
    matchedDocumentId: sameEntity.id,
  };
}

export function upsertEntity(
  entity: KnowledgeEntity | undefined,
  identity: IdentityResult,
): KnowledgeEntity {
  const documentIds = new Set(entity?.documentIds ?? []);
  documentIds.add(identity.document.id);
  return {
    id: identity.entityId,
    title: identity.document.title,
    domain: identity.document.domain,
    topic: identity.document.topic,
    documentIds: [...documentIds],
    claimIds: entity?.claimIds ?? [],
    currentVersion: identity.document.version ?? entity?.currentVersion ?? "1.0.0",
  };
}
