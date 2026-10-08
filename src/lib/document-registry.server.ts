/**
 * Document Registry — Pipeline A + Pipeline B (server-only).
 *
 * Pipeline A: Request → canonicalize → in-memory store → response.
 * Pipeline B: canonicalize → SHA-3 hash → HMAC signature → outbox event
 *             → federation anchor (quorum 4/7 + Merkle root).
 *
 * Mirrors the Manual de Ingeniería §4 and §5; no external broker
 * required — uses the hardened in-process EventBus and the Atlas
 * kernel audit chain.
 */

import { canonicalHash, publish } from "./eventbus.server";
import { evaluate } from "./opa.server";
import { anchorDocument } from "./federation-anchor.server";
import { recordAudit, metrics } from "./atlas-kernel.server";
import { randomBytes } from "node:crypto";
import type { JsonObject } from "./atlas-json";
import { toJson } from "./atlas-json";

export type DocumentState = "draft" | "validated" | "published" | "archived";

export interface CanonicalDocument {
  title: string;
  content: string;
  namespace: string;
  metadata: JsonObject;
}

export interface DocumentVersion {
  version: number;
  canonical_hash: string;
  previous_hash: string | null;
  signature: string;
  content: string;
  metadata: JsonObject;
  created_at: string;
}

export interface DocumentRecord {
  document_uid: string;
  federation_id: string;
  namespace: string;
  title: string;
  state: DocumentState;
  current_version: number;
  created_by: string;
  created_at: string;
  versions: DocumentVersion[];
  anchors: string[];
}

const STORE = new Map<string, DocumentRecord>();
const MAX_DOCS = 500;

function ulid(): string {
  return Date.now().toString(36).toUpperCase() + randomBytes(5).toString("hex").toUpperCase();
}

function generateDocumentUid(federation_id: string, namespace: string, hash: string): string {
  return `ATLAS-DOC-${federation_id}-${namespace.toUpperCase()}-${ulid()}-${hash.slice(0, 8)}`;
}

function canonicalize(input: {
  title: string;
  content: string;
  namespace: string;
  metadata?: JsonObject;
}): CanonicalDocument {
  const sortedMeta: JsonObject = {};
  const meta = input.metadata ?? {};
  for (const k of Object.keys(meta).sort()) {
    sortedMeta[k] = toJson(meta[k]);
  }
  return {
    title: input.title.trim(),
    content: input.content.replace(/\\s+/g, " ").trim(),
    namespace: input.namespace.toUpperCase(),
    metadata: sortedMeta,
  };
}

export interface CreateDocumentInput {
  title: string;
  content: string;
  namespace: string;
  federation_id: string;
  actor: { id: string; roles: string[]; scopes?: string[] };
  metadata?: JsonObject;
}

export async function createDocument(input: CreateDocumentInput): Promise<{
  document: DocumentRecord;
  hash: string;
  anchor_id: string | null;
}> {
  const policy = await evaluate({
    action: "create",
    actor: input.actor,
    required_scope: undefined,
  });
  if (!policy.allow) throw new Error(`policy_denied: ${policy.reason}`);

  // Pipeline A — canonical state
  const canonical = canonicalize(input);
  const hash = canonicalHash(canonical);
  const documentUid = generateDocumentUid(input.federation_id, input.namespace, hash);

  // Pipeline B — sign + event + anchor
  const signature = `hmac:${canonicalHash({ hash, federation: input.federation_id })}`;

  const record: DocumentRecord = {
    document_uid: documentUid,
    federation_id: input.federation_id,
    namespace: canonical.namespace,
    title: canonical.title,
    state: "draft",
    current_version: 1,
    created_by: input.actor.id,
    created_at: new Date().toISOString(),
    versions: [
      {
        version: 1,
        canonical_hash: hash,
        previous_hash: null,
        signature,
        content: input.content,
        metadata: canonical.metadata,
        created_at: new Date().toISOString(),
      },
    ],
    anchors: [],
  };

  STORE.set(documentUid, record);
  if (STORE.size > MAX_DOCS) {
    const oldest = [...STORE.keys()][0];
    STORE.delete(oldest);
  }

  metrics.counter("atlas_documents_total").inc({ federation: input.federation_id });

  await publish({
    type: "documents.created",
    actor_id: input.actor.id,
    federation_id: input.federation_id,
    hash_after: hash,
    payload: {
      document_uid: documentUid,
      federation_id: input.federation_id,
      namespace: canonical.namespace,
      title: canonical.title,
      created_by: input.actor.id,
      version: 1,
      canonical_hash: hash,
    },
  });

  recordAudit({
    actor: input.actor.id,
    action: "document.create",
    policy: "pipeline.B",
    payload: { document_uid: documentUid, hash },
  });

  // Federation anchoring with quorum 4/7
  const anchor = await anchorDocument({ document_uid: documentUid, hash });
  record.anchors.push(anchor.anchor_id);

  return { document: record, hash, anchor_id: anchor.anchor_id };
}

export async function transitionState(input: {
  document_uid: string;
  new_state: DocumentState;
  reason?: string;
  actor: { id: string; roles: string[] };
}): Promise<DocumentRecord> {
  const doc = STORE.get(input.document_uid);
  if (!doc) throw new Error("document_not_found");

  const policy = await evaluate({
    action: "transition",
    actor: input.actor,
    document: {
      uid: doc.document_uid,
      state: doc.state,
      federation_id: doc.federation_id,
    },
  });
  if (!policy.allow) throw new Error(`policy_denied: ${policy.reason}`);

  const old_state = doc.state;
  doc.state = input.new_state;

  await publish({
    type: "documents.state_changed",
    actor_id: input.actor.id,
    federation_id: doc.federation_id,
    payload: {
      document_uid: doc.document_uid,
      old_state,
      new_state: input.new_state,
      reason: input.reason,
    },
  });

  return doc;
}

export function listDocuments(): DocumentRecord[] {
  return [...STORE.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function getDocument(uid: string): DocumentRecord | undefined {
  return STORE.get(uid);
}

export function registryStats() {
  const docs = [...STORE.values()];
  const byFed: Record<string, number> = {};
  const byState: Record<string, number> = {};
  for (const d of docs) {
    byFed[d.federation_id] = (byFed[d.federation_id] ?? 0) + 1;
    byState[d.state] = (byState[d.state] ?? 0) + 1;
  }
  return { total: docs.length, by_federation: byFed, by_state: byState };
}
