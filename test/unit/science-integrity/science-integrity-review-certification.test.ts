/**
 * Science Integrity — B4 revisión humana firmada + B5 certificación VC/IGDS
 * -------------------------------------------------------------------------
 * Firma Ed25519 REAL sobre la decisión del revisor y sello IGDS restringido
 * (offline) cuando no hay TSA externa; verificación pública consulta el registro
 * Genesis de revocaciones antes de declarar un certificado válido.
 */
import { describe, expect, it } from "vitest";
import {
  createEd25519Signer,
  generateEd25519KeyPair,
  verifySignatureEnvelope,
} from "@/lib/igds/keys";
import { createGenesisRegistry } from "@/lib/igds/registry";
import {
  InMemoryScienceIntegrityStore,
  ScienceIntegrityLedger,
} from "@/lib/science-integrity/ledger";
import { submitHumanReview, REVIEW_DECISIONS } from "@/lib/science-integrity/review";
import {
  InMemoryCertificateStore,
  issueCertificate,
  revokeCertificate,
  verifyCertificate,
  VC_SCHEMA,
  REVOCABLE_REASONS,
} from "@/lib/science-integrity/certification";

const ORCID = "0009-0008-5050-1539";

const signer = (() => {
  const { privateKeyPem } = generateEd25519KeyPair();
  return createEd25519Signer({ privateKeyPem, keyId: "test-science-signer-1" });
})();

function freshDeps() {
  return {
    ledger: new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore()),
    signer,
    registry: createGenesisRegistry(),
    certificateStore: new InMemoryCertificateStore(),
  };
}

describe("Science Integrity B4 — revisión humana firmada", () => {
  it("firma Ed25519 real y encadena review_event", async () => {
    const { ledger, signer: depsSigner } = freshDeps();
    const result = await submitHumanReview(
      {
        docId: "doc-pipe-0001",
        reviewerOrcid: ORCID,
        decision: "approved",
        comments: "Evidencia suficiente; se recomienda sello de Nivel 2 provisional.",
      },
      { ledger, signer: depsSigner },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.signingAuthority).toBe("ed25519-software");
    expect(result.value.signature.algorithm).toBe("Ed25519");
    expect(verifySignatureEnvelope(result.value.signature, result.value.signedPayloadDigest)).toBe(
      true,
    );

    const events = await ledger.history("doc-pipe-0001");
    expect(events.at(-1)!.eventType).toBe("review_event");
    expect(events.at(-1)!.signerId).toBe(ORCID);
  });

  it("rechaza ORCID malformado (fail-closed)", async () => {
    const { ledger, signer: depsSigner } = freshDeps();
    const result = await submitHumanReview(
      { docId: "doc-x", reviewerOrcid: "no-es-orcid", decision: "approved" },
      { ledger, signer: depsSigner },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_reviewer_orcid");
  });

  it("rechaza decisión fuera del contrato", async () => {
    const { ledger, signer: depsSigner } = freshDeps();
    const result = await submitHumanReview(
      { docId: "doc-x", reviewerOrcid: ORCID, decision: "bogus" as "approved" },
      { ledger, signer: depsSigner },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_decision");
  });

  it("expone las decisiones válidas del contrato", () => {
    expect(REVIEW_DECISIONS).toEqual(["approved", "needs_changes", "rejected"]);
  });
});

describe("Science Integrity B5 — certificación VC/IGDS", () => {
  it("emite sello restricted sin TSA, lo verifica y registra certification_event", async () => {
    const deps = freshDeps();
    const issued = await issueCertificate(
      {
        docId: "doc-pipe-0001",
        issuer: "isabella-integrity",
        level: 2,
        aggregateScore: 0.8825,
        reviewId: "rev-1",
      },
      deps,
    );

    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const cert = issued.value;
    expect(cert.certificate.schema).toBe(VC_SCHEMA);
    expect(cert.certificate.level).toBe(2);
    expect(cert.seal.profile).toBe("restricted");
    expect(cert.seal.sealId).toHaveLength(12);
    expect(cert.seal.signingAuthority).toBe("ed25519-software");
    expect(cert.sealPackage.entry.type).toBe("seal");
    expect(cert.sealPackage.entry.sequence).toBe(0);
    expect(cert.ledgerEvent.eventType).toBe("certification_event");

    const verified = await verifyCertificate(cert.certificate.cert_id, {
      certificateStore: deps.certificateStore,
      registry: deps.registry,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.valid).toBe(true);
    expect(verified.value.status).toBe("valid");
    expect(verified.value.revoked).toBe(false);
  });

  it("no encuentra certificado inexistente (CERT_NOT_FOUND)", async () => {
    const { certificateStore, registry } = freshDeps();
    const verified = await verifyCertificate("cert_ghost", { certificateStore, registry });
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.reason).toBe("CERT_NOT_FOUND");
  });

  it("rechaza nivel fuera de 0..4", async () => {
    const deps = freshDeps();
    const issued = await issueCertificate(
      { docId: "doc-x", issuer: "i", level: 7 },
      deps,
    );
    expect(issued.ok).toBe(false);
    if (issued.ok) return;
    expect(issued.reason).toContain("invalid_level");
  });

  it("revoca en Genesis (append-only) y la verificación pública reporta revocado", async () => {
    const deps = freshDeps();
    const issued = await issueCertificate(
      { docId: "doc-pipe-0001", issuer: "isabella-integrity", level: 2 },
      deps,
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const revoked = await revokeCertificate(
      { certId: issued.value.certificate.cert_id, reason: "policy_violation", issuedBy: "governance" },
      deps,
    );
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value.entry.type).toBe("revocation");
    expect(revoked.value.entry.sequence).toBe(1);
    expect(revoked.value.ledgerEvent.eventType).toBe("revocation_event");

    const verified = await verifyCertificate(issued.value.certificate.cert_id, {
      certificateStore: deps.certificateStore,
      registry: deps.registry,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.valid).toBe(false);
    expect(verified.value.status).toBe("revoked");
    if (verified.value.revoked === false) return;
    expect(verified.value.revoked.reason).toBe("policy_violation");

    const chain = await deps.registry.list();
    expect(chain).toHaveLength(2);
    expect(chain[1]!.previous_entry_hash).toBe(chain[0]!.entry_hash);
  });

  it("expone las razones de revocación del contrato", () => {
    expect(REVOCABLE_REASONS).toContain("document_withdrawn");
    expect(REVOCABLE_REASONS).toContain("policy_violation");
    expect(REVOCABLE_REASONS).toContain("operator_request");
  });
});