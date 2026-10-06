/**
 * EXECUTION AUTHORITY (src/lib/execution-authority.ts)
 * -----------------------------------------------------------------
 * Cadena real de ejecución de herramientas (cierra el `toolExecuted: false`
 * estructural del pipeline):
 *
 *   Decide → Authorization → Approval → Tool execution
 *          → Result validation → Audit
 *
 *  - Authorization: PDP real (`evaluateAuthorization`, RBAC+ABAC).
 *  - Approval: ledger de aprobaciones humanas de un solo uso con TTL.
 *    Herramientas con `requiresApproval` (o riesgo > umbral) exigen un
 *    approval consumido; sin él, deny explícito (nunca implícito).
 *  - Execution: despacho a ejecutores reales inyectados por herramienta.
 *    Sin ejecutor registrado → deny "no-executor" (fail-closed honesto).
 *  - Validation: validador por herramienta; lo no validable no se audita
 *    como éxito.
 *  - Audit: evento append-only con IDs de decisión/aprobación y hash del
 *    resultado. Sin repositorio, la ejecución se deniega (sin auditoría
 *    no hay ejecución).
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { evaluateAuthorization } from "./authorization";
import { evaluatePolicy } from "./policy-engine";
import { applyDbPolicyGate } from "./db-policy-gate";
import { createDbPolicyStore, type DbPolicyStore } from "./repositories/policy-repository";
import { recordDecision, type LedgerStore, type Risk } from "./governance/decision-ledger";
import { verifyCapabilityToken } from "./capability-tokens";
import { createToolRegistry, missingToolPermissions, type RegisteredTool } from "./tool-registry";
import type { MemoryRepository } from "./repositories/memory-repository";
import type { AuditRepository } from "./repositories/audit-repository";

export interface ApprovalGrant {
  approvalId: string;
  traceId: string;
  tool: string;
  actorId: string;
  tenantId: string;
  grantedAt: number;
  expiresAt: number;
  consumed: boolean;
}

export interface ExecutionRequest {
  tool: string;
  input: unknown;
  actorId: string;
  tenantId: string;
  role: string;
  authenticated: boolean;
  traceId: string;
  ip: string;
  approvals?: ApprovalGrant[];
  /** Capability token firmado (alternativa al approval del ledger). */
  capabilityToken?: string;
}

export type ExecutionOutcome =
  | {
      executed: true;
      result: unknown;
      resultHash: string;
      approvalId: string | null;
      auditId: string;
    }
  | {
      executed: false;
      reason: string;
      stage:
        | "decide"
        | "authorization"
        | "approval"
        | "db-policy"
        | "execution"
        | "validation"
        | "audit";
    };

export interface ToolExecutor {
  (
    input: unknown,
    ctx: { actorId: string; tenantId: string; traceId: string },
  ): Promise<unknown> | unknown;
}

const APPROVAL_TTL_MS = 5 * 60 * 1000;

export function createApprovalLedger() {
  const grants = new Map<string, ApprovalGrant>();

  return {
    grant(traceId: string, tool: string, actorId: string, tenantId: string): ApprovalGrant {
      const now = Date.now();
      const grant: ApprovalGrant = {
        approvalId: `apr_${randomUUID().replace(/-/g, "")}`,
        traceId,
        tool,
        actorId,
        tenantId,
        grantedAt: now,
        expiresAt: now + APPROVAL_TTL_MS,
        consumed: false,
      };
      grants.set(grant.approvalId, grant);
      return grant;
    },
    consume(
      traceId: string,
      tool: string,
      actorId: string,
      tenantId: string,
    ): ApprovalGrant | null {
      const now = Date.now();
      for (const grant of grants.values()) {
        if (
          !grant.consumed &&
          grant.traceId === traceId &&
          grant.tool === tool &&
          grant.actorId === actorId &&
          grant.tenantId === tenantId &&
          grant.expiresAt > now
        ) {
          grant.consumed = true;
          return grant;
        }
      }
      return null;
    },
    pending(): number {
      const now = Date.now();
      let count = 0;
      for (const grant of grants.values()) {
        if (!grant.consumed && grant.expiresAt > now) count += 1;
      }
      return count;
    },
    /** Inspección sin consumo: ¿existe approval vigente? */
    has(traceId: string, tool: string, actorId: string, tenantId: string): boolean {
      const now = Date.now();
      for (const grant of grants.values()) {
        if (
          !grant.consumed &&
          grant.traceId === traceId &&
          grant.tool === tool &&
          grant.actorId === actorId &&
          grant.tenantId === tenantId &&
          grant.expiresAt > now
        ) {
          return true;
        }
      }
      return false;
    },
  };
}

export type ApprovalLedger = ReturnType<typeof createApprovalLedger>;

function hashResult(result: unknown): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(result) ?? "null";
  } catch {
    rendered = "[unserializable]";
  }
  return createHash("sha256").update(rendered).digest("hex");
}

function validateResult(
  tool: RegisteredTool,
  result: unknown,
): { valid: boolean; reason?: string } {
  if (result === undefined) return { valid: false, reason: "Resultado indefinido." };
  try {
    JSON.stringify(result);
  } catch {
    return { valid: false, reason: "Resultado no serializable." };
  }
  if (tool.name === "memory.retrieve" && !Array.isArray(result)) {
    return {
      valid: false,
      reason: "memory.retrieve debe devolver un arreglo.",
    };
  }
  return { valid: true };
}

export function createExecutionAuthority(opts?: {
  memoryRepository?: MemoryRepository;
  auditRepository?: AuditRepository;
  ledgerAppend?: ToolExecutor;
  storageRead?: ToolExecutor;
  identityResolve?: ToolExecutor;
  sandboxRun?: ToolExecutor;
  approvalLedger?: ApprovalLedger;
  /**
   * Store durable de approvals (PostgreSQL). Si se provee, tiene
   * precedencia sobre el ledger en memoria (multi-instancia).
   */
  approvalStore?: {
    has(traceId: string, tool: string, actorId: string, tenantId: string): Promise<boolean>;
    consume(
      traceId: string,
      tool: string,
      actorId: string,
      tenantId: string,
    ): Promise<ApprovalGrant | null>;
  };
  /**
   * Kill switch (§7.1 Charter). Si `tool-execution` está engaged,
   * toda ejecución se deniega antes de autorizar.
   */
  killSwitch?: {
    isKilled(capability: string): Promise<boolean>;
  };
  /**
   * Policy-as-code: reglas versionadas en `isabella_policies`. Si no se
   * inyecta, se usa el store por defecto (PostgreSQL cuando hay DATABASE_URL;
   * "no configurado" en caso contrario).
   */
  dbPolicyStore?: DbPolicyStore;
  /**
   * Ledger durable de decisiones (`isabella_decisions`). Si se provee, cada
   * decisión de política se registra con cadena hash: deny/review best-effort,
   * allow estricto (sin persistencia no hay ejecución, §4.2).
   */
  decisionStore?: LedgerStore;
}) {
  const registry = createToolRegistry();
  const approvals = opts?.approvalLedger ?? createApprovalLedger();
  // Capa policy-as-code: store por defecto (se declara "no configurado" cuando
  // no hay DATABASE_URL; si la base falla, el gate la trata como indisponible).
  const dbPolicyStore = opts?.dbPolicyStore ?? createDbPolicyStore();

  function executors(memoryRepository?: MemoryRepository): Map<string, ToolExecutor> {
    const map = new Map<string, ToolExecutor>();
    if (memoryRepository) {
      map.set("memory.retrieve", (input) => {
        const params = (input ?? {}) as {
          scope?: "turn" | "session" | "project" | "territorial" | "historical";
        };
        return memoryRepository.list(
          (input as { tenantId?: string })?.tenantId ?? "",
          params.scope,
        );
      });
      map.set("memory.record", (input, ctx) => {
        const params = (input ?? {}) as {
          content?: string;
          scope?: "turn" | "session" | "project" | "territorial" | "historical";
          sensitivity?: "public" | "internal" | "personal" | "restricted";
          purpose?: string;
          consentGranted?: boolean;
          ownerId?: string;
        };
        return memoryRepository.add({
          tenantId: ctx.tenantId,
          content: params.content ?? "",
          source: "tool",
          scope: params.scope ?? "turn",
          sensitivity: params.sensitivity ?? "internal",
          purpose: params.purpose ?? "tool-execution",
          consentRequired: false,
          // Fail-closed: no se afirma consentimiento que nadie otorgo.
          consentGranted: params.consentGranted ?? false,
          ownerId: params.ownerId,
          provenance: [`execution:${ctx.traceId}`],
        });
      });
    }
    if (opts?.ledgerAppend) map.set("ledger.record", opts.ledgerAppend);
    if (opts?.storageRead) map.set("storage.read", opts.storageRead);
    if (opts?.identityResolve) map.set("identity.resolve", opts.identityResolve);
    // compute.sandbox: ejecutor inyectado primero; por defecto, VM local
    // (solo JavaScript puro sin I/O). Runtimes no-JS se deniegan en el
    // ejecutor (fail-closed honesto, sin contenedor OS real).
    map.set("compute.sandbox", async (input, ctx) => {
      if (opts?.sandboxRun) return opts.sandboxRun(input, ctx);
      const { runNodeVmTask } = await import("./sandbox/node-vm-executor");
      const params = (input ?? {}) as {
        code?: unknown;
        language?: string;
        timeoutMs?: number;
      };
      const result = await runNodeVmTask({
        code: String(params.code ?? ""),
        language: params.language,
        timeoutMs: params.timeoutMs,
      });
      return {
        output: result.output,
        memoryConsumedBytes: result.memoryConsumedBytes,
        gasTokensConsumed: result.gasTokensConsumed,
      };
    });
    return map;
  }

  return {
    approvals,
    registry,

    async execute(request: ExecutionRequest): Promise<ExecutionOutcome> {
      // ── KILL SWITCH: parada de emergencia antes de todo ───────
      if (opts?.killSwitch) {
        let killed: boolean;
        try {
          killed = await opts.killSwitch.isKilled("tool-execution");
        } catch {
          killed = true; // Sin estado legible: fail-closed.
        }
        if (killed) {
          return {
            executed: false,
            reason: "Kill switch activo en 'tool-execution' (emergencia).",
            stage: "decide",
          };
        }
      }

      // ── DECIDE: whitelist Zero Trust ──────────────────────────
      const check = registry.check(request.tool);
      if (!check.allowed) {
        return { executed: false, reason: check.reason, stage: "decide" };
      }
      const tool = registry.lookup(request.tool);
      if (!tool) {
        return {
          executed: false,
          reason: "Herramienta no registrada.",
          stage: "decide",
        };
      }

      // ── ISA-164: requiredPermissions declarados son OBLIGATORIOS ──
      const missingPermissions = missingToolPermissions(tool, request.role);
      if (missingPermissions.length > 0) {
        return {
          executed: false,
          reason: `Permisos requeridos ausentes para el rol '${request.role}': ${missingPermissions.join(", ")}.`,
          stage: "decide",
        };
      }

      // ── AUTHORIZATION: PDP real ───────────────────────────────
      const decision = await evaluateAuthorization({
        tenant_id: request.tenantId,
        subject_id: request.actorId,
        action: "execute",
        resource: `tool:${request.tool}`,
        role: request.role,
        authenticated: request.authenticated,
        context: {
          ip_address: request.ip,
          user_agent: "execution-authority",
          timestamp: new Date(),
        },
      });
      if (!decision.allow) {
        return {
          executed: false,
          reason: `PDP denegó: ${decision.obligations.find((o) => o.startsWith("deny:")) ?? "deny"}.`,
          stage: "authorization",
        };
      }

      // ── APPROVAL: política + approval de un solo uso ──────────
      // El consentimiento de la política DERIVA del approval humano vigente
      // (ledger, grants adjuntos o capability token firmado): consentRequired
      // nunca se satisface solo.
      const capability =
        request.capabilityToken !== undefined
          ? verifyCapabilityToken(request.capabilityToken, {
              actorId: request.actorId,
              tenantId: request.tenantId,
              tool: request.tool,
              traceId: request.traceId,
            })
          : null;
      const hasApproval =
        capability?.valid === true ||
        (opts?.approvalStore
          ? await opts.approvalStore.has(
              request.traceId,
              request.tool,
              request.actorId,
              request.tenantId,
            )
          : approvals.has(request.traceId, request.tool, request.actorId, request.tenantId)) ||
        (request.approvals ?? []).some(
          (candidate) =>
            !candidate.consumed &&
            candidate.traceId === request.traceId &&
            candidate.tool === request.tool &&
            candidate.actorId === request.actorId &&
            candidate.tenantId === request.tenantId &&
            candidate.expiresAt > Date.now(),
        );
      // territorialBoundaryEnforced = false: todos los ejecutores registrados
      // son locales (sin egress a terceros). Una herramienta con egress
      // externo debería pasar true explícito desde su llamador.
      const policy = evaluatePolicy({
        tool,
        territorialBoundaryEnforced: false,
        humanInTheLoop: request.authenticated,
        approvalThreshold: "medium",
        consentRequired: tool.requiresApproval,
        consentGranted: hasApproval,
      });
      let approvalId: string | null = null;

      // ── POLICY AS CODE: overlay de reglas versionadas (isabella_policies) ──
      // Integración de nodo-cero-isabella. La capa DB sólo puede endurecer la
      // decisión de ARGUS (monótona); si la fuente falla, el efecto es
      // fail-closed para herramientas sensibles (§4.2). Nunca inyecta un allow
      // que el motor de código no haya dado.
      const dbGate = await applyDbPolicyGate({
        store: dbPolicyStore,
        codeDecision: policy.decision,
        tool,
        authenticated: request.authenticated,
      });
      const effectiveDecision = dbGate.status;

      // ── DECISION LEDGER: persistencia durable de la decisión (isabella_decisions) ──
      // Integración de nodo-cero-isabella ("decisiones en tabla"). La cadena se
      // escribe ANTES del despacho para que una base ilegible bloquee la
      // ejecución (fail-closed, §4.2); las denegaciones se registran
      // best-effort porque el efecto ya es la denegación.
      const persistDecision = async (
        result: "ALLOW" | "DENY" | "REVIEW",
        detail: string,
        strict: boolean,
      ): Promise<string | null> => {
        if (!opts?.decisionStore) return null;
        try {
          await recordDecision(opts.decisionStore, {
            id: randomUUID(),
            tenantId: request.tenantId,
            actorId: request.actorId,
            authority: "execution-authority",
            capability: request.tool,
            policy: `argus:${policy.decision}|db:${dbGate.source}:${dbGate.status}`,
            risk: tool.risk.toUpperCase() as Risk,
            inputHash: createHash("sha3-512")
              .update(JSON.stringify(request.input ?? null) ?? "null")
              .digest("hex"),
            outputHash: createHash("sha3-512").update(detail).digest("hex"),
            result,
            timestamp: new Date().toISOString(),
            evidenceIds: [request.traceId, detail],
          });
          return null;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return strict ? message : null;
        }
      };

      if (policy.decision === "denied") {
        await persistDecision("DENY", policy.reason, false);
        return {
          executed: false,
          reason: `Política denegó: ${policy.reason}.`,
          stage: "approval",
        };
      }
      if (dbGate.status === "denied") {
        await persistDecision(
          "DENY",
          `politica_db:${dbGate.policyKey ?? "sin-key"}:${dbGate.reason}`,
          false,
        );
        return {
          executed: false,
          reason: `Política DB denegó (${dbGate.policyKey ?? "sin-key"}): ${dbGate.reason}.`,
          stage: "db-policy",
        };
      }

      if (effectiveDecision === "requires_approval" || tool.requiresApproval) {
        // El capability token es single-context (ligado a la traza): no se
        // consume, se audita su jti. Ledger/grants sí son de un solo uso.
        if (capability?.valid === true && capability.claims) {
          approvalId = capability.claims.jti;
        } else {
          const fromStore = opts?.approvalStore
            ? await opts.approvalStore.consume(
                request.traceId,
                request.tool,
                request.actorId,
                request.tenantId,
              )
            : null;
          const grant =
            fromStore ??
            approvals.consume(request.traceId, request.tool, request.actorId, request.tenantId) ??
            (request.approvals ?? []).find(
              (candidate) =>
                !candidate.consumed &&
                candidate.traceId === request.traceId &&
                candidate.tool === request.tool &&
                candidate.actorId === request.actorId &&
                candidate.tenantId === request.tenantId &&
                candidate.expiresAt > Date.now(),
            ) ??
            null;
          if (!grant) {
            await persistDecision("REVIEW", `aprobacion_humana_requerida:${request.tool}`, false);
            return {
              executed: false,
              reason: `Aprobación humana requerida para '${request.tool}' (un solo uso, TTL 5 min).`,
              stage: "approval",
            };
          }
          grant.consumed = true;
          approvalId = grant.approvalId;
        }
      }

      // ── EXECUTION: despacho a ejecutor real ───────────────────
      const executor = executors(opts?.memoryRepository).get(request.tool);
      if (!executor) {
        await persistDecision("DENY", `sin_ejecutor:${request.tool}`, false);
        return {
          executed: false,
          reason: `Sin ejecutor registrado para '${request.tool}' (fail-closed honesto).`,
          stage: "execution",
        };
      }
      // La decisión se persiste ANTES de tocar el ejecutor: si la cadena de
      // decisiones no puede escribirse, no se ejecuta (fail-closed, §4.2).
      const persistError = await persistDecision("ALLOW", `dispatch:${request.tool}`, true);
      if (persistError) {
        return {
          executed: false,
          reason: `No se pudo persistir la decisión en isabella_decisions: ${persistError}`,
          stage: "audit",
        };
      }
      let result: unknown;
      try {
        result = await executor(request.input, {
          actorId: request.actorId,
          tenantId: request.tenantId,
          traceId: request.traceId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        return {
          executed: false,
          reason: `Ejecutor falló: ${message}.`,
          stage: "execution",
        };
      }

      // ── VALIDATION ────────────────────────────────────────────
      const validation = validateResult(tool, result);
      if (!validation.valid) {
        return {
          executed: false,
          reason: `Resultado inválido: ${validation.reason}`,
          stage: "validation",
        };
      }

      // ── AUDIT: sin auditoría no hay ejecución ─────────────────
      if (!opts?.auditRepository) {
        return {
          executed: false,
          reason: "Sin repositorio de auditoría: ejecución denegada.",
          stage: "audit",
        };
      }
      const resultHash = hashResult(result);
      const event = await opts.auditRepository.append({
        tenant_id: request.tenantId,
        timestamp: new Date().toISOString(),
        trace_id: request.traceId,
        correlation_id: decision.decision_id,
        actor: request.actorId,
        actor_ip: request.ip,
        action: tool.auditEvent,
        resource: request.tool,
        event: tool.auditEvent,
        severity: tool.risk === "critical" || tool.risk === "high" ? "S2" : "S3",
        result: "success",
        details: {
          tool: request.tool,
          actor: request.actorId,
          tenant: request.tenantId,
          approvalId,
          resultHash,
        },
      });

      return {
        executed: true,
        result,
        resultHash,
        approvalId,
        auditId: event.id,
      };
    },
  };
}

export type ExecutionAuthority = ReturnType<typeof createExecutionAuthority>;
export const EXECUTION_AUTHORITY = {
  create: createExecutionAuthority,
  approvals: createApprovalLedger,
};
