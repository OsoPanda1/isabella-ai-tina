/**
 * MOTOR DE POLÍTICA — ARGUS (src/lib/policy-engine.ts)
 * -----------------------------------------------------------------
 * Evalúa riesgo, reglas y restricciones sobre una acción (fail-closed).
 *
 * ARGUS is deliberately narrower than identity authorization:
 *  - authorization.ts answers "¿quién puede actuar?"
 *  - this module answers "¿esta acción puede ejecutarse ahora?"
 *  - execution-authority.ts consumes the decision and performs the action.
 *
 * Critical invariant:
 * `requires_approval` is a real intermediate state. A missing approval MUST
 * NOT be converted into a hard policy denial before the approval subsystem
 * has had a chance to satisfy it. The execution authority remains fail-closed
 * and refuses execution when the required approval is absent.
 */

import type { RegisteredTool, ToolRisk } from "./tool-registry";

export type PolicyDecision = "allowed" | "requires_approval" | "denied";

export interface PolicyEvaluationRequest {
  tool: RegisteredTool;
  /** Frontera territorial activa: true means this action would cross the boundary. */
  territorialBoundaryEnforced: boolean;
  /** ¿Existe una autoridad humana disponible para escalar la acción? */
  humanInTheLoop: boolean;
  /** Límite de riesgo que puede ejecutarse sin aprobación adicional. */
  approvalThreshold: ToolRisk;
  /** ¿La herramienta declara consentimiento/aprobación explícitos? */
  consentRequired: boolean;
  /** ¿Existe una aprobación/consentimiento válido para esta ejecución? */
  consentGranted: boolean;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  reason: string;
  riskAssessed: ToolRisk;
  escalationRequired: boolean;
  territorialBoundaryViolation: boolean;
  approvalRequired: boolean;
}

const RISK_ORDER: readonly ToolRisk[] = ["low", "medium", "high", "critical"];

function riskExceeds(tool: ToolRisk, threshold: ToolRisk): boolean {
  const toolIndex = RISK_ORDER.indexOf(tool);
  const thresholdIndex = RISK_ORDER.indexOf(threshold);
  return toolIndex < 0 || thresholdIndex < 0 || toolIndex > thresholdIndex;
}

function result(
  decision: PolicyDecision,
  reason: string,
  riskAssessed: ToolRisk,
  approvalRequired: boolean,
  territorialBoundaryViolation = false,
): PolicyEvaluationResult {
  return {
    decision,
    reason,
    riskAssessed,
    escalationRequired: decision === "requires_approval",
    territorialBoundaryViolation,
    approvalRequired,
  };
}

/**
 * Evalúa una acción contra la política ARGUS.
 *
 * Orden deliberado de evaluación:
 * 1. integridad de metadatos;
 * 2. frontera territorial;
 * 3. riesgo/umbral;
 * 4. consentimiento/aprobación;
 * 5. ejecución permitida.
 *
 * Las violaciones de frontera y metadatos siempre son hard-deny.
 * La ausencia de una aprobación requerida es `requires_approval` cuando
 * existe un humano que puede aprobar; execution-authority vuelve a verificar
 * y niega si finalmente no existe una aprobación válida.
 */
export function evaluatePolicy(request: PolicyEvaluationRequest): PolicyEvaluationResult {
  const { tool, territorialBoundaryEnforced } = request;

  if (!tool.name || !tool.risk || !tool.category || !tool.auditEvent) {
    return result(
      "denied",
      "Herramienta sin metadatos de política completos.",
      tool.risk ?? "critical",
      false,
    );
  }

  if (territorialBoundaryEnforced && tool.territorialBoundary) {
    return result(
      "denied",
      `Frontera territorial violada: la herramienta '${tool.name}' no puede ejecutarse en este contexto.`,
      tool.risk,
      false,
      true,
    );
  }

  const riskRequiresApproval = riskExceeds(tool.risk, request.approvalThreshold);
  const approvalRequired = request.consentRequired || tool.requiresApproval || riskRequiresApproval;

  if (approvalRequired) {
    if (request.consentGranted) {
      return result(
        "allowed",
        `Aprobación válida satisface la política para '${tool.name}' (riesgo ${tool.risk}).`,
        tool.risk,
        true,
      );
    }

    if (!request.humanInTheLoop) {
      return result(
        "denied",
        `Riesgo ${tool.risk} o la herramienta '${tool.name}' requiere aprobación humana, pero no hay humano disponible.`,
        tool.risk,
        true,
      );
    }

    return result(
      "requires_approval",
      `La acción '${tool.name}' requiere aprobación humana antes de ejecutarse.`,
      tool.risk,
      true,
    );
  }

  return result(
    "allowed",
    `Acción '${tool.name}' permitida bajo política (riesgo ${tool.risk}).`,
    tool.risk,
    false,
  );
}

export const POLICY_ENGINE = {
  evaluate: evaluatePolicy,
};
