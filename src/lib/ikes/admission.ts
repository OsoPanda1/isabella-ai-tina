import type { AdmissionInput, AdmissionResult, KnowledgeClaim, KnowledgeQuery } from "./contracts";

function independentSources(input: AdmissionInput): number {
  return new Set(
    input.sources
      .filter((source) => source.verified)
      .map((source) => source.publisher ?? source.author ?? source.id),
  ).size;
}

export function evaluateAdmission(input: AdmissionInput): AdmissionResult {
  const verified = input.sources.filter((source) => source.verified);
  const independent = independentSources(input);
  const humanRequired =
    input.risk === "HIGH" || input.risk === "CRITICAL" || input.claim.temporalStatus === "disputed";
  if (!input.claim.statement.trim() || !input.claim.entityId || verified.length === 0) {
    return {
      status: "PENDING",
      confidenceScore: 0.2,
      reason: "claim_or_verified_source_missing",
      requiresHumanReview: humanRequired,
    };
  }
  if (humanRequired && !input.humanApproved) {
    return {
      status: "CORROBORATED",
      confidenceScore: Math.min(0.85, 0.55 + independent * 0.1),
      reason: "human_review_required",
      requiresHumanReview: true,
    };
  }
  if (independent < 2 && !input.humanApproved) {
    return {
      status: "PENDING",
      confidenceScore: 0.55,
      reason: "independent_corroboration_missing",
      requiresHumanReview: false,
    };
  }
  return {
    status:
      input.claim.temporalStatus === "disputed"
        ? "DISPUTED"
        : input.humanApproved
          ? "VALIDATED"
          : "CORROBORATED",
    confidenceScore: Math.min(0.99, 0.65 + independent * 0.1 + (input.humanApproved ? 0.15 : 0)),
    reason: input.humanApproved ? "human_approved" : "independent_sources_corroborated",
    requiresHumanReview: false,
  };
}

export function filterKnowledgeClaims(
  claims: readonly KnowledgeClaim[],
  query: KnowledgeQuery,
): KnowledgeClaim[] {
  const asOf = query.asOf ? Date.parse(query.asOf) : Date.now();
  return claims.filter((claim) => {
    if (query.entityId && claim.entityId !== query.entityId) return false;
    if (query.status && claim.status !== query.status) return false;
    if (query.temporalStatus && claim.temporalStatus !== query.temporalStatus) return false;
    if (query.minConfidence !== undefined && claim.confidenceScore < query.minConfidence)
      return false;
    if (claim.validFrom && Date.parse(claim.validFrom) > asOf) return false;
    if (claim.validUntil && Date.parse(claim.validUntil) < asOf) return false;
    return true;
  });
}
