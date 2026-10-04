/**
 * OPA-style policy engine (server-only).
 *
 * Implements decisions in pure TypeScript mirroring the Rego policy in
 * the Manual de Ingeniería (atlas.publication, atlas.authz). Every
 * decision is recorded via atlas-kernel for audit; denials emit a
 * security.policy_violated event through the hardened EventBus.
 */

import { publish } from "./eventbus.server";
import { recordAudit, metrics } from "./atlas-kernel.server";

export interface PolicyInput {
  action: string;
  provider?: string;
  document?: {
    uid: string;
    state: "draft" | "validated" | "published" | "archived";
    federation_id: string;
    risk_level?: "low" | "medium" | "high" | "critical";
  };
  actor: {
    id: string;
    roles: string[];
    scopes?: string[];
    tenant?: string;
    ip?: string;
  };
  required_scope?: string;
}

export interface PolicyDecision {
  allow: boolean;
  reason: string;
  policy_id: string;
  evaluated_at: string;
}

const DECISIONS: Array<PolicyDecision & { input: PolicyInput }> = [];
const MAX_DECISIONS = 500;

function decide(input: PolicyInput): PolicyDecision {
  const evaluated_at = new Date().toISOString();

  // Scope check (atlas.authz)
  if (input.required_scope) {
    if (!input.actor.scopes?.includes(input.required_scope)) {
      return {
        allow: false,
        reason: `missing required scope: ${input.required_scope}`,
        policy_id: "atlas.authz.scope",
        evaluated_at,
      };
    }
  }

  // Publication policy
  if (input.action === "publish" && input.document) {
    const d = input.document;
    if (d.state !== "validated" && d.state !== "published") {
      return {
        allow: false,
        reason: `document state ${d.state} not eligible for publication`,
        policy_id: "atlas.publication.state",
        evaluated_at,
      };
    }
    if (
      d.federation_id === "F5" &&
      d.risk_level === "high" &&
      !input.actor.roles.includes("security_admin")
    ) {
      return {
        allow: false,
        reason: "high risk document in restricted federation",
        policy_id: "atlas.publication.high_risk",
        evaluated_at,
      };
    }
    if (input.provider === "zenodo" && d.federation_id === "F5") {
      return {
        allow: false,
        reason: "F5 (security) is not allowed to publish to public DOI providers",
        policy_id: "atlas.publication.zenodo_f5",
        evaluated_at,
      };
    }
  }

  // State transition policy
  if (input.action === "transition" && input.document) {
    if (input.document.state === "archived" && !input.actor.roles.includes("governance_admin")) {
      return {
        allow: false,
        reason: "only governance_admin can revive archived docs",
        policy_id: "atlas.transition.archived",
        evaluated_at,
      };
    }
  }

  return {
    allow: true,
    reason: "policy_allowed",
    policy_id: "atlas.default.allow",
    evaluated_at,
  };
}

export async function evaluate(input: PolicyInput): Promise<PolicyDecision> {
  const d = decide(input);
  DECISIONS.push({ ...d, input });
  if (DECISIONS.length > MAX_DECISIONS) DECISIONS.splice(0, DECISIONS.length - MAX_DECISIONS);

  metrics
    .counter("atlas_policy_decisions_total")
    .inc({ policy: d.policy_id, allow: d.allow ? "1" : "0" });

  recordAudit({
    actor: input.actor.id,
    action: `policy.${input.action}`,
    policy: d.policy_id,
    payload: { allow: d.allow, reason: d.reason },
  });

  if (!d.allow) {
    await publish({
      type: "security.policy_violated",
      actor_id: input.actor.id,
      federation_id: input.document?.federation_id,
      payload: {
        policy_id: d.policy_id,
        actor_id: input.actor.id,
        resource_type: input.document ? "document" : "action",
        resource_id: input.document?.uid ?? input.action,
        risk_level: input.document?.risk_level ?? "low",
        details: { reason: d.reason, action: input.action, provider: input.provider },
      },
    });
  }

  return d;
}

export function recentDecisions(limit = 50) {
  return DECISIONS.slice(-limit).reverse();
}
