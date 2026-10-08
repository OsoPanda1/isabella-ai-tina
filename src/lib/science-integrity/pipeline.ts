/**
 * Science Integrity — Pipeline de verificación (B3)
 * -----------------------------------------------------------------
 * Orquesta ingestión → nlp_claims (claim-radar) → señales ML nativas → NCUA ERI →
 * agregación con las reglas de decisión del manual (§4.2) → eventos de ledger.
 *
 * Regla de honestidad: señales externas (`similarityIndex`, `refResolutionRate`,
 * `reproScore`, `statisticsPassRate`) sin proveedor disponible se tratan como 0
 * (unavailable). Con las métricas externas ausentes, el agregado no alcanza los
 * umbrales y el resultado es Rechazado por señales insuficientes (fail-closed).
 */
import { randomUUID } from "node:crypto";
import { NCUAAcademicPipeline } from "../ncua/academic-pipeline";
import { createLogger } from "../logger";
import { verifyNlpClaims, type ClaimVerificationResult } from "./claims";
import { evaluateNativeMlSignals } from "./classifiers";
import { ingestScientificDocument, type IngestResult } from "./ingest";
import { ScienceIntegrityLedger } from "./ledger";
import {
  parseScientificDocument,
  AGGREGATE_AUTO_VERIFIED,
  AGGREGATE_HUMAN_REVIEW,
  DECISION_WAIGHTS,
  REF_RESOLUTION_CRITICAL,
  SIMILARITY_CRITICAL,
  type PipelinePath,
  type PipelineStatus,
  type ScienceLedgerBlock,
  type ScientificDocument,
} from "./contracts";
import type { ClaimVerificationOptions } from "./claims";

const log = createLogger("science-integrity.pipeline");

export const SCIENCE_PIPELINE_VERSION = "isabella.science-integrity.pipeline.v1";

export const EXTERNAL_SIGNALS = [
  "similarityIndex",
  "refResolutionRate",
  "reproScore",
  "statisticsPassRate",
] as const;
export type ExternalSignalName = (typeof EXTERNAL_SIGNALS)[number];

export interface ExternalVerificationSignals {
  /** API externa de similitud, [0,1]. Ausente = señal no disponible. */
  similarityIndex?: number;
  /** Resolución de referencias (DOI/Crossref/URLs), [0,1]. */
  refResolutionRate?: number;
  /** Puntaje de reproducibilidad en sandbox, [0,1]. */
  reproScore?: number;
  /** Pase de verificación de tablas/estadísticas, [0,1]. */
  statisticsPassRate?: number;
}

export interface ScienceIntegrityRuntime {
  ledger: ScienceIntegrityLedger;
  ncua?: NCUAAcademicPipeline;
}

export interface ScienceIntegrityPipelineReport {
  schema: "isabella.science-integrity.pipeline.v1";
  docId: string;
  pipelineId: string;
  version: string;
  status: PipelineStatus;
  path: PipelinePath;
  aggregateScore: number;
  provisionalLevel: number;
  components: {
    doc: ScientificDocument;
    ingest: IngestResult;
    claims: ClaimVerificationResult;
    ml: {
      textRiskScore: number;
      plagiarismSuspicion: number;
      citationCoverage: number;
      driftTriggered: boolean;
      fairnessPassed: boolean;
    };
    eri: { eri: number; compliant: boolean; evidenceLabel: string; halted: boolean };
  };
  decision: { reason: string; criticalFlags: string[]; missingSignals: ExternalSignalName[] };
  ledger: { ingestEvent: ScienceLedgerBlock; verificationEvent: ScienceLedgerBlock; pipelineRunEvent: ScienceLedgerBlock };
}

export interface ScienceIntegrityPipelineInput {
  document: unknown;
  verification?: ExternalVerificationSignals;
  claims?: ClaimVerificationOptions;
}

export async function runScienceIntegrityPipeline(
  input: ScienceIntegrityPipelineInput,
  runtime: ScienceIntegrityRuntime,
): Promise<{ ok: true; value: ScienceIntegrityPipelineReport } | { ok: false; reason: string }> {
  const parsed = parseScientificDocument(input.document);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const doc = parsed.value;

  const ingestion = await ingestScientificDocument(doc, { ledger: runtime.ledger });
  if (!ingestion.ok) return { ok: false, reason: ingestion.reason };
  const ingestResult = ingestion.value;

  const claims = await verifyNlpClaims(doc, input.claims ?? {});
  const ml = evaluateNativeMlSignals({
    abstract: doc.abstract,
    claims: doc.claims,
    artifactContents: doc.artifacts.map((artifact) => artifact.content),
    domains: doc.domains,
  });

  const ncua = runtime.ncua ?? new NCUAAcademicPipeline();
  const ncuaResult = ncua.execute(doc.abstract, doc.tenantId);
  const eri = {
    eri: ncuaResult.epistemicRobustnessIndex,
    compliant: ncuaResult.status !== "SOVCON_HALT",
    evidenceLabel: ncuaResult.evidence.label,
    halted: ncuaResult.status === "SOVCON_HALT" || ncuaResult.status === "FAIL_CLOSED",
  };

  const external = input.verification ?? {};
  const availableExternal = EXTERNAL_SIGNALS.filter(
    (name) => external[name] !== undefined,
  ) as ExternalSignalName[];
  const missingSignals = EXTERNAL_SIGNALS.filter(
    (name) => availableExternal.includes(name) === false,
  ) as ExternalSignalName[];

  const similarityIndex = external.similarityIndex ?? ml.plagiarismSuspicion;
  const refResolutionRate = external.refResolutionRate ?? 0;
  const reproScore = external.reproScore ?? 0;
  const statisticsPassRate = external.statisticsPassRate ?? 0;
  const nlpClaimsSupport = claims.groundingScore;

  const aggregateScore =
    DECISION_WAIGHTS.similarity * (1 - similarityIndex) +
    DECISION_WAIGHTS.refResolution * refResolutionRate +
    DECISION_WAIGHTS.repro * reproScore +
    DECISION_WAIGHTS.statistics * statisticsPassRate +
    DECISION_WAIGHTS.nlpClaims * nlpClaimsSupport;

  const criticalFlags: string[] = [];
  // Las banderas críticas operan SOLO sobre señales disponibles: una señal ausente
  // no es una violación crítica, es una señal faltante (reportada y fail-closed).
  if (availableExternal.includes("similarityIndex") && similarityIndex > SIMILARITY_CRITICAL) {
    criticalFlags.push(`SIMILARITY_INDEX=${similarityIndex.toFixed(3)}`);
  }
  if (availableExternal.includes("refResolutionRate") && refResolutionRate < REF_RESOLUTION_CRITICAL) {
    criticalFlags.push(`REF_RESOLUTION_RATE=${refResolutionRate.toFixed(3)}`);
  }

  let status: PipelineStatus;
  let path: PipelinePath;
  let provisionalLevel: number;
  let reason: string;

  if (eri.halted) {
    status = "REJECTED_EVIDENCE";
    path = "REJECTED";
    provisionalLevel = 0;
    reason = "NCUA ERI por debajo del umbral (SOVCON_HALT): sin suficiente robustez epistémica.";
  } else if (criticalFlags.length > 0) {
    status = "REJECTED_EVIDENCE";
    path = "REJECTED";
    provisionalLevel = 0;
    reason = `Bandera crítica activa: ${criticalFlags.join(" | ")}.`;
  } else if (aggregateScore < AGGREGATE_HUMAN_REVIEW) {
    status = missingSignals.length > 0 ? "REJECTED_INSUFFICIENT_SIGNALS" : "PENDING_HUMAN_REVIEW";
    path = "REJECTED";
    provisionalLevel = 0;
    reason = missingSignals.length > 0
      ? `Agregado ${aggregateScore.toFixed(3)} < ${AGGREGATE_HUMAN_REVIEW}; faltan señales externas: ${missingSignals.join(", ")}.`
      : `Agregado ${aggregateScore.toFixed(3)} por debajo del umbral de revisión humana.`;
  } else if (aggregateScore >= AGGREGATE_AUTO_VERIFIED) {
    status = "VERIFIED_PENDING_CERTIFICATION";
    path = "AUTO_VERIFIED";
    provisionalLevel = 2;
    reason = `Agregado ${aggregateScore.toFixed(3)} >= ${AGGREGATE_AUTO_VERIFIED}: sello de Nivel 2 provisional habilitado (verificación humana obligatoria previa a certificación).`;
  } else {
    status = "PENDING_HUMAN_REVIEW";
    path = "HUMAN_REVIEW";
    provisionalLevel = 3;
    reason = `Agregado ${aggregateScore.toFixed(3)} en [${AGGREGATE_HUMAN_REVIEW}, ${AGGREGATE_AUTO_VERIFIED}): revisión humana en cola por área temática.`;
  }

  const pipelineId = `pl_${randomUUID()}`;
  const verificationEvent = await runtime.ledger.appendEvent({
    eventType: "verification_event",
    docId: doc.docId,
    signerId: doc.tenantId,
    payload: {
      doc_id: doc.docId,
      verifier: "science-integrity-pipeline",
      score: Number(aggregateScore.toFixed(4)),
      result: status,
      evidence_hashes: [ingestResult.ledgerEvent.currentHash],
      verifiers: [
        { verifier: "nlp_claims", score: Number(nlpClaimsSupport.toFixed(4)) },
        { verifier: "native_ml", score: Number((1 - ml.textRisk.riskScore).toFixed(4)) },
        { verifier: "ncua_eri", score: Number((eri.eri / 100).toFixed(4)) },
        { verifier: "similarity", score: Number((1 - similarityIndex).toFixed(4)) },
      ],
    },
  });

  const pipelineRunEvent = await runtime.ledger.appendEvent({
    eventType: "pipeline_run",
    docId: doc.docId,
    signerId: doc.tenantId,
    payload: {
      doc_id: doc.docId,
      pipeline_id: pipelineId,
      version: SCIENCE_PIPELINE_VERSION,
      aggregate_score: Number(aggregateScore.toFixed(4)),
      status,
      path,
      provisional_level: provisionalLevel,
    },
  });

  log.info("science_pipeline_completed", {
    docId: doc.docId,
    pipelineId,
    aggregate: Number(aggregateScore.toFixed(3)),
    status,
    path,
  });

  return {
    ok: true,
    value: {
      schema: SCIENCE_PIPELINE_VERSION,
      docId: doc.docId,
      pipelineId,
      version: SCIENCE_PIPELINE_VERSION,
      status,
      path,
      aggregateScore: Number(aggregateScore.toFixed(4)),
      provisionalLevel,
      components: {
        doc,
        ingest: ingestResult,
        claims,
        ml: {
          textRiskScore: Number(ml.textRisk.riskScore.toFixed(4)),
          plagiarismSuspicion: Number(ml.plagiarismSuspicion.toFixed(4)),
          citationCoverage: Number(ml.citationCoverage.toFixed(4)),
          driftTriggered: ml.drift.triggered,
          fairnessPassed: ml.fairness.passed,
        },
        eri,
      },
      decision: { reason, criticalFlags, missingSignals },
      ledger: { ingestEvent: ingestResult.ledgerEvent, verificationEvent, pipelineRunEvent },
    },
  };
}