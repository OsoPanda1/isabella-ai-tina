/**
 * Science Integrity — Superficie HTTP (src/lib/science-integrity/routes.ts)
 * ------------------------------------------------------------------------
 * API del puente Fase B sobre los servicios nativos reales:
 *   POST /api/v1/science-integrity/verify        → pipeline completo (ingest→claims→ML→NCUA→score)
 *   POST /api/v1/science-integrity/hypercore-verify → rail Hypercore gobernado (mandatoryGate)
 *   POST /api/v1/science-integrity/reviews       → revisión humana firmada (B4)
 *   POST /api/v1/science-integrity/certificates  → emisión VC/IGDS (B5)
 *   GET  /api/v1/science-integrity/certificates/:certId → verificación pública
 *   POST /api/v1/science-integrity/certificates/:certId/revoke → revocación (B5)
 *
 * Fail-closed: cualquier error de servicios internos responde 503; el principal
 * autenticado siempre es la única fuente de tenant (AGENTS.md §5).
 */
import { Router } from "express";
import { authenticate } from "../auth.server";
import { rateLimit, quotaGate } from "../../middleware/rateLimit";
import { runScienceIntegrityPipeline } from "./pipeline";
import { runScienceHypercoreVerify } from "./hypercore";
import { submitHumanReview, REVIEW_DECISIONS, type ReviewDecision } from "./review";
import { issueCertificate, revokeCertificate, verifyCertificate, REVOCABLE_REASONS } from "./certification";
import { defaultScienceIntegrityServices } from "./runtime";

export const scienceIntegrityRouter = Router();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function paramString(value: string | string[]): string {
  return typeof value === "string" ? value : value[0] ?? "";
}

scienceIntegrityRouter.get("/api/v1/science-integrity", (_req, res) => {
  res.json({
    ok: true,
    subsystem: "Isabella Verificación y Certificación de Integridad Científica (Fase B)",
    schema: "isabella.science-integrity.v1",
    components: {
      ingest: "src/lib/science-integrity/ingest.ts",
      claims: "src/lib/claim-radar (nlp_claims)",
      ml: "src/lib/native-ml (governed-ml gates)",
      eri: "src/lib/ncua/academic-pipeline",
      hypercore: "src/lib/acceleration/hypercore (rail gobernado)",
      igds: "src/lib/igds (sello VC)",
      ledger: "src/lib/science-integrity/ledger.ts (append-only encadenado)",
    },
    endpoints: {
      verify: "POST /api/v1/science-integrity/verify",
      hypercoreVerify: "POST /api/v1/science-integrity/hypercore-verify",
      reviews: "POST /api/v1/science-integrity/reviews",
      certificates: "POST /api/v1/science-integrity/certificates",
      verifyCertificate: "GET /api/v1/science-integrity/certificates/:certId",
      revokeCertificate: "POST /api/v1/science-integrity/certificates/:certId/revoke",
    },
    honesty:
      "Estado TESTED (tests automatizados). Sin TSA externa el sello usa perfil restricted (verificación offline); sin señales externas el agregado no certifica (fail-closed).",
    timestamp: new Date().toISOString(),
  });
});

scienceIntegrityRouter.post(
  "/api/v1/science-integrity/verify",
  rateLimit,
  authenticate,
  quotaGate("chat"),
  async (req, res) => {
    const { ledger, ncua } = defaultScienceIntegrityServices;
    const incoming = asRecord(req.body);
    const document = asRecord(incoming.document);
    // Las señales de verificación externas son server-side (conectores), NUNCA del
    // cliente; sin ellas el agregado no certifica (fail-closed).
    const result = await runScienceIntegrityPipeline(
      { document: { ...document, tenantId: req.principal?.tenantId ?? document.tenantId } },
      { ledger, ncua },
    );
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.reason });
    }
    return res.status(200).json({ ok: true, report: result.value });
  },
);

scienceIntegrityRouter.post(
  "/api/v1/science-integrity/hypercore-verify",
  rateLimit,
  authenticate,
  quotaGate("chat"),
  async (req, res) => {
    if (!req.principal?.tenantId) {
      return res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
    }
    const incoming = asRecord(req.body);
    const result = await runScienceHypercoreVerify(
      { ...incoming, tenantId: req.principal.tenantId, userId: req.principal.sub },
      { ledger: defaultScienceIntegrityServices.ledger, ncua: defaultScienceIntegrityServices.ncua },
    );
    const status = result.ok
      ? 200
      : result.reason?.startsWith("invalid_") || result.reason === "body_must_be_object"
        ? 400
        : result.reason === "deadline_exceeded" || result.reason === "deadline_during_verification"
          ? 504
          : 422;
    return res.status(status).json(result);
  },
);

scienceIntegrityRouter.post(
  "/api/v1/science-integrity/reviews",
  rateLimit,
  authenticate,
  quotaGate("chat"),
  async (req, res) => {
    const incoming = asRecord(req.body);
    const decision = typeof incoming.decision === "string" ? incoming.decision : "";
    if (!(REVIEW_DECISIONS as readonly string[]).includes(decision)) {
      return res.status(400).json({ ok: false, error: "invalid_decision" });
    }
    const result = await submitHumanReview(
      {
        reviewId: typeof incoming.reviewId === "string" ? incoming.reviewId : undefined,
        docId: typeof incoming.docId === "string" ? incoming.docId : "",
        reviewerOrcid: typeof incoming.reviewerOrcid === "string" ? incoming.reviewerOrcid : "",
        decision: decision as ReviewDecision,
        comments: typeof incoming.comments === "string" ? incoming.comments : undefined,
      },
      { ledger: defaultScienceIntegrityServices.ledger, signer: defaultScienceIntegrityServices.signer },
    );
    if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
    return res.status(201).json({ ok: true, review: result.value });
  },
);

scienceIntegrityRouter.post(
  "/api/v1/science-integrity/certificates",
  rateLimit,
  authenticate,
  quotaGate("chat"),
  async (req, res) => {
    const incoming = asRecord(req.body);
    const issuer = req.principal?.sub ?? req.principal?.tenantId ?? "isabella";
    const result = await issueCertificate(
      {
        docId: typeof incoming.docId === "string" ? incoming.docId : "",
        issuer,
        level: typeof incoming.level === "number" ? incoming.level : 0,
        certId: typeof incoming.certId === "string" ? incoming.certId : undefined,
        reviewId: typeof incoming.reviewId === "string" ? incoming.reviewId : undefined,
        aggregateScore: typeof incoming.aggregateScore === "number" ? incoming.aggregateScore : undefined,
        merkleRoot: typeof incoming.merkleRoot === "string" ? incoming.merkleRoot : undefined,
      },
      {
        ledger: defaultScienceIntegrityServices.ledger,
        signer: defaultScienceIntegrityServices.signer,
        registry: defaultScienceIntegrityServices.registry,
        certificateStore: defaultScienceIntegrityServices.certificateStore,
        tsa: defaultScienceIntegrityServices.tsa ?? undefined,
      },
    );
    if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
    return res.status(201).json({ ok: true, certificate: result.value });
  },
);

scienceIntegrityRouter.get(
  "/api/v1/science-integrity/certificates/:certId",
  rateLimit,
  authenticate,
  async (req, res) => {
    const result = await verifyCertificate(paramString(req.params.certId), {
      certificateStore: defaultScienceIntegrityServices.certificateStore,
      registry: defaultScienceIntegrityServices.registry,
    });
    if (!result.ok) return res.status(404).json({ ok: false, error: result.reason });
    return res.status(200).json({ ok: true, ...result.value });
  },
);

scienceIntegrityRouter.post(
  "/api/v1/science-integrity/certificates/:certId/revoke",
  rateLimit,
  authenticate,
  quotaGate("chat"),
  async (req, res) => {
    const incoming = asRecord(req.body);
    const reason = typeof incoming.reason === "string" ? incoming.reason : "document_withdrawn";
    if (!(REVOCABLE_REASONS as readonly string[]).includes(reason)) {
      return res.status(400).json({ ok: false, error: "invalid_reason" });
    }
    const result = await revokeCertificate(
      {
        certId: paramString(req.params.certId),
        reason: reason as (typeof REVOCABLE_REASONS)[number],
        issuedBy: req.principal?.sub ?? req.principal?.tenantId ?? "isabella",
      },
      {
        ledger: defaultScienceIntegrityServices.ledger,
        signer: defaultScienceIntegrityServices.signer,
        registry: defaultScienceIntegrityServices.registry,
      },
    );
    if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
    return res.status(200).json({ ok: true, revocation: result.value });
  },
);