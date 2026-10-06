/**
 * AUTORIZACIÓN MCP — cadena de autoridad (src/lib/mcp-server/policy.ts)
 * -----------------------------------------------------------------
 * El servidor MCP es solo un TRANSPORTE: no decide permisos por sí mismo.
 * Toda `tools/call` atraviesa, en orden y fail-closed:
 *
 *  1. identity     → identidad/tenant/rol del principal (sin autenticar: deny).
 *  2. unknown-tool → whitelist Zero Trust (registro + `engine.checkTool`).
 *  3. permissions  → `missingToolPermissions` (RBAC) para el rol del actor.
 *  4. policy       → `evaluatePolicy` (ARGUS: frontera territorial, riesgo,
 *                    umbral de aprobación, consentimiento/human-in-the-loop).
 *  5. execution    → capability token de uso único + `engine.execute` (ORION,
 *                    que vuelve a verificar whitelist, token y sandbox).
 *  6. output       → redacción de secretos + gate de seguridad de salida.
 *
 * Contrato de denegaciones (decisión de diseño del transporte):
 *  - herramienta desconocida / fuera de whitelist → error JSON-RPC -32602;
 *  - toda otra denegación (identity, permissions, policy, execution, output)
 *    → resultado de herramienta MCP con `isError: true` y el motivo.
 */
import { randomUUID } from "node:crypto";
import type { Role } from "../rbac";
import { ROLES } from "../rbac";
import { issueCapabilityToken } from "../capability-token";
import type { OrionExecutionResult, OrionExecutionStatus, OrionToolCall } from "../orion-engine";
import type { OrionEngine } from "../orion-engine";
import type { SovereignSandboxService } from "../sovereign-sandbox";
import { evaluatePolicy } from "../policy-engine";
import { missingToolPermissions, type RegisteredTool, type ToolRegistry } from "../tool-registry";
import { redactSecrets } from "../secret-redactor";
import { evaluateOutputSecurity, OUTPUT_GATE_REFUSAL } from "../output-security-gate";
import type { ToolRisk } from "../tool-registry";

/** Efectos colaterales derivados de los permisos requeridos por herramienta. */
export type McpSideEffects = "none" | "read" | "write" | "financial";

/** Etapas de denegación auditables del transporte MCP. */
export type McpDenialStage =
  "identity" | "unknown-tool" | "permissions" | "policy" | "execution" | "output";

/**
 * Contrato de herramienta expuesto/derivado para MCP (alineado con
 * AGENTS.md §6.3 `ToolContract`).
 */
export interface McpToolContract {
  toolName: string;
  riskLevel: ToolRisk;
  requiredScopes: string[];
  timeoutMs: number;
  maxRetries: number;
  sideEffects: McpSideEffects;
  requiresHumanApproval: boolean;
}

/** Identidad del cliente MCP inyectada por el operador del servidor. */
export interface McpCallerContext {
  actorId: string;
  tenantId: string;
  role: Role;
  authenticated: boolean;
}

/** Contexto por defecto: anónimo → toda ejecución queda denegada. */
export const ANONYMOUS_MCP_CONTEXT: McpCallerContext = Object.freeze({
  actorId: "",
  tenantId: "",
  role: "Guest" as Role,
  authenticated: false,
});

export interface McpAuthorizationInput {
  context: McpCallerContext;
  toolName: string;
  registry: ToolRegistry;
  engine: Pick<OrionEngine, "checkTool">;
  /** Herramientas con aprobación humana/consentimiento ya otorgado. */
  approvals?: ReadonlySet<string>;
  /** true (default): activa la verificación de frontera territorial de ARGUS. */
  territorialBoundaryEnforced?: boolean;
}

export interface McpAuthorizedCall {
  allowed: true;
  context: McpCallerContext;
  tool: RegisteredTool;
  contract: McpToolContract;
  capabilityToken: string;
}

export interface McpDeniedCall {
  allowed: false;
  stage: McpDenialStage;
  reason: string;
  toolName: string;
}

export type McpAuthorizationResult = McpAuthorizedCall | McpDeniedCall;

function deny(stage: McpDenialStage, reason: string, toolName: string): McpDeniedCall {
  return { allowed: false, stage, reason, toolName };
}

/** Deriva los efectos colaterales a partir de los permisos requeridos. */
export function deriveMcpSideEffects(permissions: readonly string[]): McpSideEffects {
  if (permissions.length === 0) return "none";
  if (permissions.some((permission) => permission.startsWith("ledger:"))) return "financial";
  if (permissions.every((permission) => permission.endsWith(":read"))) return "read";
  return "write";
}

/** Umbral de aprobación: efectos mutaciones → "low", lecturas → "medium". */
export function mcpApprovalThreshold(contract: McpToolContract): ToolRisk {
  return contract.sideEffects === "write" || contract.sideEffects === "financial"
    ? "low"
    : "medium";
}

/** Construye el contrato MCP (§6.3) a partir de los metadatos del registro. */
export function buildMcpToolContract(tool: RegisteredTool): McpToolContract {
  return {
    toolName: tool.name,
    riskLevel: tool.risk,
    requiredScopes: [...tool.requiredPermissions],
    timeoutMs: tool.maxTimeMs,
    maxRetries: tool.maxRetries,
    sideEffects: deriveMcpSideEffects(tool.requiredPermissions),
    requiresHumanApproval: tool.requiresApproval,
  };
}

/**
 * Autoriza una llamada MCP (etapas 1–4) y, si todo permite avanzar, emite el
 * capability token de uso único que ORION consumirá al ejecutar.
 */
export function authorizeMcpToolCall(input: McpAuthorizationInput): McpAuthorizationResult {
  const { context, toolName } = input;
  if (
    !context.authenticated ||
    context.actorId.length === 0 ||
    context.tenantId.length === 0 ||
    !ROLES.includes(context.role)
  ) {
    return deny(
      "identity",
      "Identidad MCP no autenticada o incompleta: se requiere actorId, tenantId y rol válidos.",
      toolName,
    );
  }

  const tool = input.registry.lookup(toolName);
  if (!tool) {
    return deny(
      "unknown-tool",
      `Herramienta '${toolName}' no está registrada en la whitelist Zero Trust.`,
      toolName,
    );
  }
  const check = input.engine.checkTool(toolName);
  if (!check.allowed) return deny("unknown-tool", check.reason, toolName);

  const missing = missingToolPermissions(tool, context.role);
  if (missing.length > 0) {
    return deny(
      "permissions",
      `Rol '${context.role}' no posee los permisos requeridos: ${missing.join(", ")}.`,
      toolName,
    );
  }

  const contract = buildMcpToolContract(tool);
  const evaluation = evaluatePolicy({
    tool,
    territorialBoundaryEnforced: input.territorialBoundaryEnforced ?? true,
    humanInTheLoop: true,
    approvalThreshold: mcpApprovalThreshold(contract),
    consentRequired: tool.requiresApproval,
    consentGranted: input.approvals?.has(tool.name) ?? false,
  });
  if (evaluation.decision !== "allowed") {
    return deny("policy", evaluation.reason, toolName);
  }

  return {
    allowed: true,
    context,
    tool,
    contract,
    capabilityToken: issueCapabilityToken({
      tool: tool.name,
      actorId: context.actorId,
      tenantId: context.tenantId,
      ttlMs: contract.timeoutMs,
    }),
  };
}

export interface McpOutputSanitization {
  allowed: boolean;
  text: string;
  findings: string[];
}

/**
 * Sanitiza la salida de una herramienta: redacción determinista de secretos
 * primero y gate de seguridad de salida (ARGUS) después. Si el gate deniega,
 * se emite la negativa canónica y nunca el texto original.
 */
export function sanitizeMcpToolOutput(rawOutput: string): McpOutputSanitization {
  const redacted = redactSecrets(rawOutput ?? "");
  const gate = evaluateOutputSecurity(redacted);
  if (gate.verdict === "deny") {
    return {
      allowed: false,
      text: OUTPUT_GATE_REFUSAL,
      findings: gate.findings.map((finding) => finding.code),
    };
  }
  return { allowed: true, text: redacted, findings: gate.findings.map((f) => f.code) };
}

export interface McpToolExecutionInput {
  authorization: McpAuthorizedCall;
  args: Record<string, unknown>;
  engine: Pick<OrionEngine, "execute">;
  sandbox?: SovereignSandboxService;
  traceId?: string;
  correlationId?: string;
}

export interface McpToolExecutionOutcome {
  isError: boolean;
  text: string;
  stage?: McpDenialStage;
  status?: OrionExecutionStatus;
}

/**
 * Ejecuta una llamada ya autorizada (etapas 5–6): capability token de uso
 * único → ORION → sanitización de salida. Cualquier fallo inesperado se
 * convierte en denegación (fail-closed) y nunca propaga stack traces.
 */
export async function executeMcpToolCall(
  input: McpToolExecutionInput,
): Promise<McpToolExecutionOutcome> {
  const { authorization } = input;
  const traceId = input.traceId ?? `mcp_${randomUUID()}`;
  const correlationId = input.correlationId ?? traceId;
  const call: OrionToolCall = {
    toolName: authorization.tool.name,
    args: input.args,
    traceId,
    correlationId,
    actorIp: "mcp-stdio",
    actorId: authorization.context.actorId,
    tenantId: authorization.context.tenantId,
    capabilityToken: authorization.capabilityToken,
  };

  let result: OrionExecutionResult;
  try {
    result = await input.engine.execute(call, input.sandbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      stage: "execution",
      text: redactSecrets(`Ejecución rechazada por fallo interno: ${message}`),
      status: "error",
    };
  }

  if (result.status !== "executed") {
    const reason =
      result.error?.trim() ||
      `Ejecución de '${call.toolName}' no completada (estado: ${result.status}).`;
    return {
      isError: true,
      stage: "execution",
      text: redactSecrets(reason),
      status: result.status,
    };
  }

  const sanitized = sanitizeMcpToolOutput(result.output);
  if (!sanitized.allowed) {
    return {
      isError: true,
      stage: "output",
      text: sanitized.text,
      status: result.status,
    };
  }
  return { isError: false, text: sanitized.text, status: result.status };
}
