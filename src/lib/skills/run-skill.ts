import { randomUUID } from "node:crypto";
import { isabellaSkills, IsabellaSkillId } from "./registry";
import { evaluateAuthorization, type AuthorizationContext } from "../authorization";
import { createBookpiPostgresRepository } from "../repositories/bookpi-postgres-repository";
import { validateSkillInput, validateSkillOutput, StandardResponse } from "../api-contracts";

/**
 * Canonical hardened skill execution pipeline.
 * Every skill passes identity, schema, policy, execution and durable audit gates.
 */
export async function runIsabellaSkill(
  skillId: IsabellaSkillId,
  input: unknown,
  context: {
    requestId?: string;
    locale?: string;
    federation?: string;
    intent?: string;
    actorId?: string;
    tenantId?: string;
    role?: string;
    authenticated?: boolean;
    ipAddress?: string;
    userAgent?: string;
  } = {},
): Promise<StandardResponse> {
  const requestId = context.requestId || `req_${randomUUID()}`;
  const traceId = `trace_${randomUUID()}`;
  const apiVersion = "v3.0.0-hardened";
  const timestamp = new Date().toISOString();
  const subjectId = context.actorId;
  const tenantId = context.tenantId;
  const ipAddress = context.ipAddress || "unknown";
  const userAgent = context.userAgent || "Isabella-Agent-Stack/1.0";
  let decisionId: string | null = null;

  try {
    if (!subjectId || !tenantId || !context.role || context.authenticated === undefined) {
      throw new SecurityError(
        "IDENTITY_REQUIRED",
        "Ejecución denegada: identidad explícita requerida.",
      );
    }

    const validatedInput = validateSkillInput(skillId, input);
    const authContext: AuthorizationContext = {
      tenant_id: tenantId,
      subject_id: subjectId,
      action: "skill.execute",
      resource: `skill:${skillId.toLowerCase()}`,
      role: context.role,
      authenticated: context.authenticated,
      context: {
        ip_address: ipAddress,
        user_agent: userAgent,
        timestamp: new Date(),
      },
    };

    const decision = await evaluateAuthorization(authContext);
    decisionId = decision.decision_id;
    if (!decision.allow)
      throw new SecurityError("CROWN_POLICY_DENY", "Acceso denegado por política centralizada.");

    const skill = isabellaSkills[skillId];
    if (!skill) throw new SecurityError("TOOL_NOT_FOUND", `Skill '${skillId}' no registrado.`);

    const skillContext: import("./contracts").SkillContext = {
      actorId: subjectId,
      federation: (context.federation || skill.federation) as import("./contracts").FederationId,
      requestId,
      locale: context.locale || "es",
      intent: context.intent || "Unknown intent",
      evidence: [],
    };

    if (
      skill.canRun &&
      !(skill.canRun as (input: unknown, ctx: unknown) => boolean)(validatedInput, skillContext)
    ) {
      throw new SecurityError(
        "CROWN_OBLIGATION_FAILURE",
        "El input no satisface los prerrequisitos del skill.",
      );
    }

    const skillResult = await skill.run(validatedInput as never, skillContext);
    const validatedOutput = validateSkillOutput(skillId, skillResult);
    const bookpiRepo = createBookpiPostgresRepository();

    // Do not invent a monetary charge. A skill is billable only when its own
    // result explicitly declares a measured `billableCostUsd` value.
    const outputRecord = skillResult.data as Record<string, unknown> | null;
    const billableCostUsd =
      outputRecord &&
      typeof outputRecord.billableCostUsd === "number" &&
      Number.isFinite(outputRecord.billableCostUsd)
        ? Math.max(0, outputRecord.billableCostUsd)
        : 0;

    const blockRes = await bookpiRepo.append({
      tenantId,
      userId: subjectId,
      operation: `SKILL_EXECUTION: ${skillId} | Decision: ${decisionId} | Intent: ${context.intent || "N/A"}`,
      category: "skills",
      cost: billableCostUsd,
      tokens: 0,
      status: "settled",
    });

    if (!blockRes.success)
      throw new SecurityError("AUDIT_WRITE_FAILED", "Fallo al registrar evidencia en BookPI.");

    return {
      meta: {
        request_id: requestId,
        trace_id: traceId,
        decision_id: decisionId,
        api_version: apiVersion,
        tenant_id: tenantId,
        timestamp,
      },
      data: validatedOutput,
      error: null,
    };
  } catch (err: unknown) {
    const isSecurityError = err instanceof SecurityError;
    const errorCode = isSecurityError ? err.code : "SYSTEM_INTERNAL_ERROR";
    const publicMessage = isSecurityError
      ? err.message
      : "Error interno de procesamiento cognitivo.";
    console.error(`[Pipeline Error] [${traceId}]`, err);
    return {
      meta: {
        request_id: requestId,
        trace_id: traceId,
        decision_id: decisionId,
        api_version: apiVersion,
        tenant_id: tenantId,
        timestamp,
      },
      data: null,
      error: {
        code: errorCode,
        message: publicMessage,
        correlation_id: requestId,
        retryable: !isSecurityError,
      },
    };
  }
}

class SecurityError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "SecurityError";
  }
}
