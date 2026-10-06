import type { IntelligenceRisk } from "@/lib/intelligence/contracts";

export type AdmissionStatus =
  "PENDING" | "CORROBORATED" | "VALIDATED" | "DISPUTED" | "DEPRECATED" | "REJECTED";

export type KnowledgeType =
  "FACT" | "CONCEPT" | "RULE" | "RELATION" | "PROCEDURE" | "SPECIFICATION";

export type TemporalStatus =
  "historical" | "current" | "superseded" | "corrected" | "disputed" | "deprecated";

export type EvolutionDecision =
  | "EXACT_DUPLICATE"
  | "VERIFIED_DUPLICATE"
  | "LOGICAL_DUPLICATE"
  | "UPDATE"
  | "ENRICHMENT"
  | "CORRECTION"
  | "NEW_EVIDENCE"
  | "NEW_KNOWLEDGE"
  | "DISPUTED";

export interface SourceRecord {
  readonly id: string;
  readonly type: "DOI" | "ORCID" | "OPEN_DATA" | "STANDARD" | "OFFICIAL_DOC" | "DOCUMENT" | "OTHER";
  readonly url?: string;
  readonly publisher?: string;
  readonly author?: string;
  readonly license?: string;
  readonly verified: boolean;
}

export interface DocumentIdentity {
  readonly id: string;
  readonly title: string;
  readonly domain: string;
  readonly topic: string;
  readonly source?: SourceRecord;
  readonly publicationDate?: string;
  readonly retrievalDate: string;
  readonly hash: { readonly sha256: string };
  readonly structuralFingerprint: string;
  readonly semanticFingerprint: string;
  readonly entityId?: string;
  readonly version?: string;
}

export interface KnowledgeClaim {
  readonly id: string;
  readonly entityId: string;
  readonly statement: string;
  readonly type: KnowledgeType;
  readonly status: AdmissionStatus;
  readonly temporalStatus: TemporalStatus;
  readonly validFrom?: string;
  readonly validUntil?: string | null;
  readonly sourceDocumentIds: readonly string[];
  readonly evidenceLevel: "primary" | "secondary" | "tertiary";
  readonly confidenceScore: number;
  readonly supersedes?: readonly string[];
  readonly supersededBy?: readonly string[];
}

export interface KnowledgeEntity {
  readonly id: string;
  readonly title: string;
  readonly domain: string;
  readonly topic: string;
  readonly documentIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly currentVersion: string;
}

export interface IngestedDocument {
  readonly id: string;
  readonly title: string;
  readonly domain: string;
  readonly topic: string;
  readonly content: string;
  readonly source?: SourceRecord;
  readonly publicationDate?: string;
  readonly version?: string;
}

export interface IdentityResult {
  readonly document: DocumentIdentity;
  readonly entityId: string;
  readonly decision: EvolutionDecision;
  readonly matchedDocumentId?: string;
}

export interface AdmissionInput {
  readonly claim: Omit<KnowledgeClaim, "status" | "confidenceScore">;
  readonly sources: readonly SourceRecord[];
  readonly risk?: IntelligenceRisk;
  readonly humanApproved?: boolean;
}

export interface AdmissionResult {
  readonly status: AdmissionStatus;
  readonly confidenceScore: number;
  readonly reason: string;
  readonly requiresHumanReview: boolean;
}

export interface KnowledgeQuery {
  readonly entityId?: string;
  readonly status?: AdmissionStatus;
  readonly temporalStatus?: TemporalStatus;
  readonly asOf?: string;
  readonly minConfidence?: number;
}
