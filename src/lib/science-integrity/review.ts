/**
 * Science Integrity — Revisión humana firmada (B4)
 * -----------------------------------------------------------------
 * Workflow humano: el revisor firma la decisión con su clave Ed25519 (firma REAL,
 * node:crypto), el payload se encadena en un `review_event` del ledger.
 *
 * Honestidad: la firma es Ed25519 por software; un HSM/KMS real es opcional y se
 * reporta en `signing_authority`. Un sello de Nivel 3/4 exige esta revisión humana.
 */
import { randomUUID } from "node:crypto";
import { canonicalize } from "../igds/canonical";
import { digestHex } from "../igds/digests";
import { signDigest, type SealSigner, type SignatureEnvelope } from "../igds/keys";
import { ScienceIntegrityLedger } from "./ledger";
import type { ScienceLedgerBlock } from "./contracts";

export const REVIEW_DECISIONS = ["approved", "needs_changes", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

// ORCID ISO 27729: 0000-0000-0000-000X (16 caracteres; el último puede ser X).
const ORCID_PATTERN = /^[0-9]{4}-?[0-9]{4}-?[0-9]{4}-?[0-9]{3}[0-9X]$/;

export interface HumanReviewInput {
  reviewId?: string;
  docId: string;
  reviewerOrcid: string;
  decision: ReviewDecision;
  comments?: string;
}

export interface HumanReviewDeps {
  ledger: ScienceIntegrityLedger;
  signer: SealSigner;
}

export interface HumanReviewReceipt {
  reviewId: string;
  docId: string;
  decision: ReviewDecision;
  signedAt: string;
  signingAuthority: "ed25519-software";
  signature: SignatureEnvelope;
  signedPayloadDigest: string;
  ledgerEvent: ScienceLedgerBlock;
}

export async function submitHumanReview(
  input: HumanReviewInput,
  dependencies: HumanReviewDeps,
): Promise<{ ok: true; value: HumanReviewReceipt } | { ok: false; reason: string }> {
  if (!input.docId.trim()) return { ok: false, reason: "invalid_doc_id" };
  if (!ORCID_PATTERN.test(input.reviewerOrcid)) return { ok: false, reason: "invalid_reviewer_orcid" };
  if (!REVIEW_DECISIONS.includes(input.decision)) return { ok: false, reason: "invalid_decision" };
  const comments = (input.comments ?? "").slice(0, 4000);

  const reviewId = input.reviewId ?? `rev_${randomUUID()}`;
  const signedAt = new Date().toISOString();
  const payload = {
    review_id: reviewId,
    doc_id: input.docId,
    reviewer_orcid: input.reviewerOrcid,
    decision: input.decision,
    comments,
    signed_at: signedAt,
  };
  const signedPayloadDigest = digestHex("sha256", canonicalize(payload));
  const signature = signDigest(dependencies.signer, signedPayloadDigest);

  const ledgerEvent = await dependencies.ledger.appendEvent({
    eventType: "review_event",
    docId: input.docId,
    signerId: input.reviewerOrcid,
    payload: {
      doc_id: input.docId,
      reviewer_orcid: input.reviewerOrcid,
      decision: input.decision,
      review_signature: {
        algorithm: signature.algorithm,
        key_id: signature.key_id,
        value: signature.value,
        signed_digest: signature.signed_digest,
      },
      signed_at: signedAt,
    },
  });

  return {
    ok: true,
    value: {
      reviewId,
      docId: input.docId,
      decision: input.decision,
      signedAt,
      signingAuthority: "ed25519-software",
      signature,
      signedPayloadDigest,
      ledgerEvent,
    },
  };
}