/**
 * Client-safe DTOs mirroring the server registry types.
 *
 * Types-only re-exports (no runtime `.server` code reaches the browser).
 * These interfaces are what crosses the TanStack RPC boundary and are
 * verified by the contract tests in `tests/contract/registry.test.ts`.
 */
import type { DocumentRecord, DocumentState, DocumentVersion } from "./document-registry.server";
import type { AtlasEvent, AtlasEventType } from "./events-catalog";
import type { JsonObject } from "./atlas-json";

export type { DocumentState, DocumentVersion };

export type DocumentRecordDTO = DocumentRecord;

export interface CreateDocumentResult {
  document: DocumentRecordDTO;
  hash: string;
  anchor_id: string | null;
}

export interface AnchorSignatureDTO {
  federation_id: string;
  hash: string;
  signature: string;
  timestamp: string;
}

export interface AnchorRecordDTO {
  anchor_id: string;
  document_uid: string;
  merkle_root: string;
  signatures: AnchorSignatureDTO[];
  quorum: { achieved: number; required: number };
  status: "consistent" | "divergent";
  created_at: string;
}

export interface DlqRowDTO {
  event_id: string;
  topic: AtlasEventType;
  reason: string;
  payload: AtlasEvent;
  parked_at: string;
}

export interface PolicyDecisionDTO {
  allow: boolean;
  reason: string;
  policy_id: string;
  evaluated_at: string;
  input: {
    action: string;
    provider?: string;
    document?: {
      uid: string;
      state: DocumentState;
      federation_id: string;
      risk_level?: "low" | "medium" | "high" | "critical";
    };
    actor: {
      id: string;
      roles: string[];
      scopes?: string[];
      tenant?: string;
      ip?: string;
    };
    required_scope?: string;
  };
}

export interface EventCatalogEntryDTO {
  type: AtlasEventType;
  domain: string;
  description: string;
}

export interface BookkeepingDTO {
  outbox_size: number;
  outbox_pending: number;
  outbox_published: number;
  dlq_size: number;
  processed_size: number;
  handlers_registered: Array<{ type: AtlasEventType; count: number }>;
}

export interface RegistryStatsDTO {
  total: number;
  by_federation: Record<string, number>;
  by_state: Record<string, number>;
}

export interface AnchorStatsDTO {
  total: number;
  consistent: number;
  divergent: number;
  last_root: string | null;
}

export interface RegistrySnapshotDTO {
  documents: DocumentRecordDTO[];
  stats: RegistryStatsDTO;
  anchors: AnchorRecordDTO[];
  anchor_stats: AnchorStatsDTO;
  events: AtlasEvent[];
  dlq: DlqRowDTO[];
  bookkeeping: BookkeepingDTO;
  decisions: PolicyDecisionDTO[];
  catalog: ReadonlyArray<EventCatalogEntryDTO>;
}

export interface ReplayResultDTO {
  replayed: number;
}

// Helper for `metadata` fields that must remain JSON-serializable.
export type MetadataDTO = JsonObject;
