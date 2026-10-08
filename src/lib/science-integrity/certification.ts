/**
 * Science Integrity — Emisión, verificación y revocación de VC/IGDS (B5)
 * ---------------------------------------------------------------------
 * Credencial verificable (JSON-LD constreñido) firmada con el sello IGDS REAL de
 * Isabella: contenido → digest → manifiesto → firma Ed25519 → entrada Genesis.
 *
 * Fail-closed: sin firma disponible el sello aborta; si el perfil `public-verifiable`
 * se solicita sin TSA, la emisión falla (el motor de sellado nunca degrada en silencio).
 * Revocación = entrada Genesis nueva firmada (nunca se borra historia).
 */
import { randomUUID } from "node:crypto";
import { canonicalize } from "../igds/canonical";
import type { GenesisRegistry } from "../igds/registry";
import { sealDocument, shortSealId } from "../igds/seal";
import { manifestFinalDigest } from "../igds/manifest";
import { verifySealPackage } from "../igds/verify";
import {
  createRevocationPayload,
  revocationDigest,
} from "../igds/revocation";
import type { RevocationReason } from "../igds/types";
import { signDigest, type SealSigner, type SignatureEnvelope } from "../igds/keys";
import type { SealProfile } from "../igds/profiles";
import type { TsaClient } from "../igds/tsa";
import type { GenesisEntry, IgdsSealPackage } from "../igds/types";
import { ScienceIntegrityLedger } from "./ledger";
import type { ScienceLedgerBlock } from "./contracts";

export const VC_SCHEMA = "isabella.vc.science-integrity.v1";

export interface CertificateClaim {
  schema: typeof VC_SCHEMA;
  cert_id: string;
  doc_id: string;
  issuer: string;
  level: number;
  issued_at: string;
  aggregate_score: number | null;
  review_id: string | null;
  merkle_root: string | null;
}

export interface CertificateInput {
  certId?: string;
  docId: string;
  issuer: string;
  level: number;
  aggregateScore?: number;
  reviewId?: string;
  merkleRoot?: string;
}

export interface CertificateStore {
  save(certId: string, pkg: IgdsSealPackage): Promise<void> | void;
  get(certId: string): Promise<IgdsSealPackage | null> | IgdsSealPackage | null;
}

export class InMemoryCertificateStore implements CertificateStore {
  private readonly packages = new Map<string, IgdsSealPackage>();

  async save(certId: string, pkg: IgdsSealPackage): Promise<void> {
    this.packages.set(certId, pkg);
  }

  async get(certId: string): Promise<IgdsSealPackage | null> {
    return this.packages.get(certId) ?? null;
  }
}

export interface CertificationDeps {
  ledger: ScienceIntegrityLedger;
  signer: SealSigner;
  registry: GenesisRegistry;
  certificateStore: CertificateStore;
  tsa?: TsaClient;
}

export interface IssuedCertificate {
  certificate: CertificateClaim;
  seal: {
    sealId: string;
    profile: SealProfile;
    genesisSequence: number;
    manifestDigest: string;
    signingAuthority: "ed25519-software";
  };
  sealPackage: IgdsSealPackage;
  ledgerEvent: ScienceLedgerBlock;
}

export function resolveSealProfile(tsa: TsaClient | undefined): SealProfile {
  // public-verifiable exige RFC 3161; sin TSA se usa restricted (verificación offline).
  return tsa ? "public-verifiable" : "restricted";
}

export async function issueCertificate(
  input: CertificateInput,
  dependencies: CertificationDeps,
): Promise<{ ok: true; value: IssuedCertificate } | { ok: false; reason: string }> {
  if (!input.docId.trim() || !input.issuer.trim()) return { ok: false, reason: "invalid_identity" };
  if (!Number.isInteger(input.level) || input.level < 0 || input.level > 4) {
    return { ok: false, reason: `invalid_level:${input.level}` };
  }

  const certId = input.certId ?? `cert_${randomUUID()}`;
  const issuedAt = new Date().toISOString();
  const profile = resolveSealProfile(dependencies.tsa);

  const certificate: CertificateClaim = {
    schema: VC_SCHEMA,
    cert_id: certId,
    doc_id: input.docId,
    issuer: input.issuer,
    level: input.level,
    issued_at: issuedAt,
    aggregate_score: input.aggregateScore !== undefined ? Number(input.aggregateScore) : null,
    review_id: input.reviewId ?? null,
    merkle_root: input.merkleRoot ?? null,
  };

  const content = canonicalize(certificate);
  const sealPackage = await sealDocument(
    {
      documentId: certId,
      content,
      profile,
      document: {
        title: `VC Integridad Científica ${input.docId}`,
        mime_type: "application/json",
        language: "es-MX",
        byte_size: Buffer.byteLength(content, "utf8"),
      },
      generation: {
        system: "Isabella",
        skill: "science-integrity-certification",
        declaration: {
          ai_generated: false,
          ai_assisted: false,
          human_modified: false,
          human_reviewed: true,
        },
      },
      actions: [
        { action: "created", when: issuedAt },
        { action: "approved", when: issuedAt },
        { action: "sealed", when: issuedAt },
      ],
    },
    {
      signer: dependencies.signer,
      registry: dependencies.registry,
      tsa: dependencies.tsa,
    },
  );

  const manifestDigest = `sha256:${manifestFinalDigest(sealPackage.manifest, "sha256")}`;
  await dependencies.certificateStore.save(certId, sealPackage);

  const ledgerEvent = await dependencies.ledger.appendEvent({
    eventType: "certification_event",
    docId: input.docId,
    signerId: input.issuer,
    payload: {
      cert_id: certId,
      vc_hash: manifestDigest,
      issuer: input.issuer,
      level: input.level,
      ledger_tx: sealPackage.entry.sequence,
      seal_id: sealPackage.seal.seal_id,
      seal_profile: profile,
    },
  });

  return {
    ok: true,
    value: {
      certificate,
      seal: {
        sealId: sealPackage.seal.seal_id,
        profile,
        genesisSequence: sealPackage.entry.sequence,
        manifestDigest,
        signingAuthority: "ed25519-software",
      },
      sealPackage,
      ledgerEvent,
    },
  };
}

export async function verifyCertificate(
  certId: string,
  dependencies: Pick<CertificationDeps, "certificateStore" | "registry">,
  options: { content?: unknown } = {},
): Promise<
  | { ok: true; value: { certId: string; valid: boolean; status: string; revoked: false } }
  | { ok: true; value: { certId: string; valid: boolean; status: "revoked"; revoked: { revocationId: string; reason: string; effectiveAt: string } } }
  | { ok: false; reason: string }
> {
  const sealPackage = await dependencies.certificateStore.get(certId);
  if (!sealPackage) return { ok: false, reason: "CERT_NOT_FOUND" };

  let revocation: {
    revocationId: string;
    reason: string;
    effectiveAt: string;
  } | null = null;
  if (dependencies.registry) {
    const entries = await dependencies.registry.list();
    const entry = entries.find(
      (item) => item.type === "revocation" && item.revocation?.target_id === certId,
    );
    if (entry?.revocation) {
      const effectiveAt = entry.revocation.effective_at ?? entry.created_at;
      if (new Date(effectiveAt).getTime() <= Date.now()) {
        revocation = {
          revocationId: entry.revocation.revocation_id,
          reason: entry.revocation.reason,
          effectiveAt,
        };
      }
    }
  }

  const report = await verifySealPackage(sealPackage, { content: options.content });
  const sealStatus = report.document_status;
  const valid = sealStatus === "valid" || sealStatus === "valid_at_signing_time";
  if (revocation) {
    return {
      ok: true,
      value: { certId, valid: false, status: "revoked", revoked: revocation },
    };
  }
  return {
    ok: true,
    value: { certId, valid, status: sealStatus, revoked: false },
  };
}

export const REVOCABLE_REASONS: readonly RevocationReason[] = [
  "document_withdrawn",
  "policy_violation",
  "operator_request",
];

export interface RevokeCertificateInput {
  certId: string;
  reason?: RevocationReason;
  issuedBy: string;
}

export async function revokeCertificate(
  input: RevokeCertificateInput,
  dependencies: Omit<CertificationDeps, "certificateStore">,
): Promise<{ ok: true; value: { entry: GenesisEntry; ledgerEvent: ScienceLedgerBlock; revokedAt: string } } | { ok: false; reason: string }> {
  if (!input.certId.trim() || !input.issuedBy.trim()) return { ok: false, reason: "invalid_revocation_identity" };
  const reason: RevocationReason = input.reason ?? "document_withdrawn";
  if (!REVOCABLE_REASONS.includes(reason)) return { ok: false, reason: `invalid_reason:${reason}` };

  const revocation = createRevocationPayload({
    revocationId: `rev_${randomUUID()}`,
    targetType: "certificate",
    targetId: input.certId,
    reason,
    scope: "target_only",
    issuedBy: input.issuedBy,
  });
  const digest = revocationDigest(revocation);
  const signature = signDigest(dependencies.signer, digest);

  const entry = await dependencies.registry.appendRevocation({
    revocation,
    signature,
  });

  const ledgerEvent = await dependencies.ledger.appendEvent({
    eventType: "revocation_event",
    docId: input.certId,
    signerId: input.issuedBy,
    payload: {
      cert_id: input.certId,
      reason,
      ledger_tx: entry.sequence,
      revocation_id: revocation.revocation_id,
    },
  });

  return {
    ok: true,
    value: { entry, ledgerEvent, revokedAt: revocation.effective_at },
  };
}

export { shortSealId };
export type { SignatureEnvelope };