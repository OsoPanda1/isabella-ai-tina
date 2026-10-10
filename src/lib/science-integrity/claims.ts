/**
 * Science Integrity — Verificador de afirmaciones nlp_claims (B1)
 * -----------------------------------------------------------------
 * Verifica cada afirmación declarada contra la evidencia disponible usando el
 * motor REAL de Isabella: `claim-radar.evaluateClaim` (contratos `claim-radar/contracts.ts`).
 *
 * Recuperación NO es prueba (invariante de claim-radar): sin adaptadores MCP
 * disponibles, el resultado es `unavailable/insufficient`, nunca inventado.
 */
import { evaluateClaim } from "../claim-radar/claim-radar";
import type { Claim, EvidenceStatus } from "../claim-radar/contracts";
import type { ScientificClaim, ScientificDocument } from "./contracts";
import { createLogger } from "../logger";

const log = createLogger("science-integrity.claims");

export const CLAIMS_EVALUATOR_VERSION = "isabella.claim-radar.v2";

export interface ClaimVerificationSummary {
  checked: number;
  supports: number;
  contradicts: number;
  contextualizes: number;
  insufficient: number;
  unavailable: number;
}

export interface ClaimVerificationResult {
  docId: string;
  verifiedClaims: ReadonlyArray<{ claimId: string; status: EvidenceStatus; confidence: number; assertion: string }>;
  summary: ClaimVerificationSummary;
  /** Fracción de afirmaciones sostenidas por evidencia compatible. */
  groundingScore: number;
  evaluatorVersion: string;
}

export interface ClaimVerificationOptions {
  adapterIds?: string[];
  maxResults?: number;
  timeoutMs?: number;
  concurrency?: number;
}

function claimDomainMap(domain: string): Parameters<typeof evaluateClaim>[0]["domain"] {
  switch (domain) {
    case "medical":
      return "medical";
    case "legal":
      return "legal";
    case "financial":
      return "financial";
    case "territorial":
      return "territorial";
    case "technical":
      return "technical";
    case "cultural":
      return "cultural";
    default:
      return "academic";
  }
}

function sourceDoiOf(claim: ScientificClaim): string | undefined {
  const doi = claim.citedSources.find((source) => source.sourceType === "doi");
  return doi?.value;
}

async function evaluateWithBatch(
  claims: readonly ScientificClaim[],
  doc: ScientificDocument,
  options: Required<ClaimVerificationOptions>,
): Promise<Claim[]> {
  const results: Claim[] = [];
  for (let index = 0; index < claims.length; index += options.concurrency) {
    const batch = claims.slice(index, index + options.concurrency);
    const settled = await Promise.all(
      batch.map(async (claim) => {
        try {
          return await evaluateClaim({
            assertion: claim.assertion,
            domain: claimDomainMap(doc.domains[0]!),
            source: doc.title,
            sourceDoi: sourceDoiOf(claim),
            sourceOrcid: doc.authors.find((author) => author.orcid)?.orcid,
            adapterIds: options.adapterIds,
            maxResults: options.maxResults,
            timeoutMs: options.timeoutMs,
          });
        } catch (error) {
          log.warn("claim_evaluation_failed", {
            assertionId: claim.assertionId,
            error: error instanceof Error ? error.message : "unknown",
          });
          return {
            claimId: claim.assertionId,
            assertion: claim.assertion,
            domain: claimDomainMap(doc.domains[0]!),
            source: doc.title,
            evidenceLevel: "unavailable",
            confidence: 0,
            supportingResults: [],
            contradictoryResults: [],
            evaluatedAt: new Date().toISOString(),
            ttlHours: 720,
            reasonCode: "EVALUATOR_ERROR",
          } satisfies Claim;
        }
      }),
    );
    results.push(...settled);
  }
  return results;
}

export async function verifyNlpClaims(
  doc: ScientificDocument,
  options: ClaimVerificationOptions = {},
): Promise<ClaimVerificationResult> {
  const opts: Required<ClaimVerificationOptions> = {
    adapterIds: options.adapterIds ?? [],
    maxResults: options.maxResults ?? 5,
    timeoutMs: options.timeoutMs ?? 5000,
    concurrency: options.concurrency ?? 6,
  };

  const claims = await evaluateWithBatch(doc.claims, doc, opts);
  const summary: ClaimVerificationSummary = {
    checked: claims.length,
    supports: claims.filter((claim) => claim.evidenceLevel === "supports").length,
    contradicts: claims.filter((claim) => claim.evidenceLevel === "contradicts").length,
    contextualizes: claims.filter((claim) => claim.evidenceLevel === "contextualizes").length,
    insufficient: claims.filter((claim) => claim.evidenceLevel === "insufficient").length,
    unavailable: claims.filter((claim) => claim.evidenceLevel === "unavailable").length,
  };
  const groundingScore = summary.checked > 0 ? summary.supports / summary.checked : 0;

  return {
    docId: doc.docId,
    verifiedClaims: claims.map((claim) => ({
      claimId: claim.claimId,
      status: claim.evidenceLevel,
      confidence: claim.confidence,
      assertion: claim.assertion,
    })),
    summary,
    groundingScore,
    evaluatorVersion: CLAIMS_EVALUATOR_VERSION,
  };
}