/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — BETA / POLICY (CROWN)
 * CROWN decide: ALLOW, DENY, REVIEW, DEFER
 * ================================================================
 */

import { randomUUID } from "node:crypto";

import type {
  CrownDecision,
  CrownDecisionResult,
  DataClassification,
  RiskLevel,
} from "../contracts";

export interface PolicyContext {
  identity: {
    actorId: string;
    tenantId: string;
    roles: string[];
    scopes: string[];
    assuranceLevel: string;
  };
  risk: {
    level: RiskLevel;
    requiresApproval: boolean;
  };
  classification: DataClassification;
  intent: string;
  requestedCapabilities: string[];
}

interface PolicyRule {
  id: string;
  name: string;
  condition: (ctx: PolicyContext) => boolean;
  action: CrownDecisionResult;
  reason: string;
}

export class PolicyEngine {
  private policies: PolicyRule[] = [
    {
      id: "crown_zero_trust",
      name: "Zero Trust Tool Execution",
      condition: (ctx) => ctx.requestedCapabilities.length > 0,
      action: "review",
      reason: "Tool execution requires review",
    },
    {
      id: "territorial_boundary",
      name: "Territorial Data Boundary",
      condition: (ctx) => ctx.classification === "critical" || ctx.classification === "restricted",
      action: "review",
      reason: "Sensitive data requires boundary check",
    },
    {
      id: "high_risk_escalation",
      name: "High Risk Escalation",
      condition: (ctx) => ctx.risk.level === "R4_critical" || ctx.risk.level === "R3_high",
      action: "review",
      reason: "High risk requires human approval",
    },
    {
      id: "insufficient_scope",
      name: "Insufficient Scope",
      condition: (ctx) => ctx.identity.scopes.length === 0,
      action: "deny",
      reason: "No scopes granted",
    },
    {
      id: "governance_protection",
      name: "Governance Protection",
      condition: (ctx) => ctx.intent === "governance" && ctx.identity.assuranceLevel === "none",
      action: "deny",
      reason: "Governance operations require authentication",
    },
  ];

  /**
   * Evaluate all policies and produce a CROWN decision.
   */
  evaluate(context: PolicyContext): CrownDecision {
    const results: Array<{
      policyId: string;
      action: CrownDecisionResult;
      reason: string;
    }> = [];
    let finalAction: CrownDecisionResult = "allow";
    const scopeDenials: string[] = [];

    for (const policy of this.policies) {
      if (policy.condition(context)) {
        results.push({
          policyId: policy.id,
          action: policy.action,
          reason: policy.reason,
        });

        if (policy.action === "deny") {
          finalAction = "deny";
        } else if (policy.action === "review" && finalAction !== "deny") {
          finalAction = "review";
        } else if (policy.action === "defer" && finalAction === "allow") {
          finalAction = "defer";
        }
      }
    }

    for (const cap of context.requestedCapabilities) {
      if (!context.identity.scopes.includes(cap) && !context.identity.scopes.includes("*")) {
        scopeDenials.push(cap);
      }
    }

    return {
      decisionId: randomUUID(),
      result: finalAction,
      riskLevel: context.risk.level,
      classification: context.classification,
      policyIds: results.map((r) => r.policyId),
      reason:
        results.length > 0 ? results.map((r) => r.reason).join("; ") : "No policies triggered",
      scopeDenials,
      reviewRequired: finalAction === "review",
      reversible: finalAction !== "deny",
      evaluatedAt: new Date().toISOString(),
    };
  }
}

export const policyEngine = new PolicyEngine();
