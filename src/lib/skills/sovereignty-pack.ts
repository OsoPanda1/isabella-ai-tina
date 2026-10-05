import { createAuditEvent, Evidence, IsabellaSkill, SkillResult, AuditEvent } from "./contracts";

// ============================================================================
// 18. THEMIS (Explainable Audit Engine)
// ============================================================================
export interface ThemisInput {
  decisionId: string;
  decision: string;
  evidence: Evidence[];
  events: AuditEvent[];
}

export interface ThemisOutput {
  decisionId: string;
  explanation: string;
  evidenceWeight: number;
  appliedEvents: string[];
  auditability: "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT";
}

export const THEMIS: IsabellaSkill<ThemisInput, ThemisOutput> = {
  id: "THEMIS",
  name: "Explainable Audit Engine",
  version: "v.GENESIS",
  federation: "SOVEREIGNTY",
  risk: "HIGH",
  description: "Genera expedientes explicables de decisiones, evidencia y rutas de auditoría.",
  canRun: (input) => Boolean(input.decisionId && input.decision),
  async run(input, context): Promise<SkillResult<ThemisOutput>> {
    const evidenceWeight = input.evidence.reduce((sum, item) => sum + (item.score ?? 0.5), 0);

    const auditability =
      input.evidence.length >= 2 && input.events.length >= 2
        ? "SUFFICIENT"
        : input.evidence.length > 0
          ? "PARTIAL"
          : "INSUFFICIENT";

    const explanation = `La decisión “${input.decision}” se reconstruyó con ${input.evidence.length} evidencias y ${input.events.length} eventos de auditoría.`;

    return {
      skillId: "THEMIS",
      status: auditability === "INSUFFICIENT" ? "PARTIAL" : "SUCCESS",
      summary: explanation,
      data: {
        decisionId: input.decisionId,
        explanation,
        evidenceWeight,
        appliedEvents: input.events.map((event) => event.type),
        auditability,
      },
      evidence: input.evidence,
      warnings:
        auditability === "INSUFFICIENT"
          ? ["No hay evidencia suficiente para defender esta decisión de forma auditable."]
          : [],
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "THEMIS",
          { decisionId: input.decisionId },
          context.actorId,
        ),
        createAuditEvent(
          "SKILL_COMPLETED",
          "THEMIS",
          { auditability, evidenceWeight },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 23. SENTINEL (Operational Abuse Protection)
// ============================================================================
export interface SentinelInput {
  actorId: string;
  requestsLastMinute: number;
  failedAttempts: number;
  previousBlocks: number;
}

export interface SentinelOutput {
  action: "ALLOW" | "THROTTLE" | "TEMPORARY_BLOCK";
  reason: string;
  retryAfterSeconds?: number;
}

export const SENTINEL: IsabellaSkill<SentinelInput, SentinelOutput> = {
  id: "SENTINEL",
  name: "Operational Abuse Protection",
  version: "v.GENESIS",
  federation: "SOVEREIGNTY",
  risk: "CRITICAL",
  description:
    "Detecta abuso de interacción y recomienda control de tasa o bloqueo temporal auditable.",
  canRun: (input) => Boolean(input.actorId),
  async run(input, context): Promise<SkillResult<SentinelOutput>> {
    const severe =
      input.requestsLastMinute > 120 || input.failedAttempts > 15 || input.previousBlocks >= 3;
    const moderate =
      input.requestsLastMinute > 45 || input.failedAttempts > 5 || input.previousBlocks >= 1;

    const output: SentinelOutput = severe
      ? {
          action: "TEMPORARY_BLOCK",
          reason: "Patrón de abuso o evasión persistente detectado.",
          retryAfterSeconds: 900,
        }
      : moderate
        ? {
            action: "THROTTLE",
            reason: "Volumen o fallos inusuales; se limita la tasa de solicitudes.",
            retryAfterSeconds: 60,
          }
        : {
            action: "ALLOW",
            reason: "No se detectó un patrón de abuso.",
          };

    return {
      skillId: "SENTINEL",
      status: output.action === "TEMPORARY_BLOCK" ? "BLOCKED" : "SUCCESS",
      summary: `SENTINEL recomendó ${output.action}.`,
      data: output,
      evidence: [],
      warnings: output.action === "ALLOW" ? [] : [output.reason],
      requiresHumanReview: output.action === "TEMPORARY_BLOCK",
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "SENTINEL",
          {
            actorId: input.actorId,
            requestsLastMinute: input.requestsLastMinute,
          },
          context.actorId,
        ),
        createAuditEvent(
          output.action === "TEMPORARY_BLOCK" ? "SKILL_BLOCKED" : "SKILL_COMPLETED",
          "SENTINEL",
          { ...output },
          context.actorId,
        ),
      ],
    };
  },
};
