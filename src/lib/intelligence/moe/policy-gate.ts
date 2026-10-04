import type { GovernanceDecision, IntelligenceRisk } from "../contracts";
import type { RoutingRequest } from "./contracts";

const riskScore: Record<IntelligenceRisk, number> = { LOW: 0, MEDIUM: 35, HIGH: 70, CRITICAL: 95 };

/** CROWN/ARGUS boundary for routing. It authorizes selection only, never side effects. */
export function evaluateMoERouting(
  request: RoutingRequest,
  governance: GovernanceDecision,
): GovernanceDecision {
  if (!request.tenantId || !request.actorId || !request.requestId) {
    return {
      decision: "DENY",
      riskScore: 100,
      policyIds: ["moe-identity-v1"],
      reasons: ["identity-required"],
    };
  }
  if (governance.decision !== "ALLOW") return governance;
  if (request.risk === "CRITICAL") {
    return {
      decision: "REVIEW",
      riskScore: riskScore.CRITICAL,
      policyIds: ["argus-review-v1"],
      reasons: ["critical-risk-requires-human-review"],
    };
  }
  return {
    decision: "ALLOW",
    riskScore: riskScore[request.risk],
    policyIds: ["crown-moe-routing-v1"],
    reasons: [],
  };
}
