/**
 * PIPELINE SOBERANO (src/lib/sovereign-pipeline.ts)
 * -----------------------------------------------------------------
 * Orquestación canónica: Perceive → Remember → Policy → Decide → Act → Audit.
 * Real, sin mockdata:
 *  - Cada fase produce resultados tipados y verificables.
 *  - Fail-closed: si falta identidad, autorización o integridad,
 *    la pipeline degrada o deniega la acción.
 *  - Registra un DecisionRecord y un AuditBundle al finalizar.
 */

// Autoridad canónica runtime: CROWN v6 (compat adapter de crown.ts v2.0.0).
// Auditoría P1-03: el pipeline soberano no importa crown.ts directamente.
import * as CROWN from "./crown-runtime-authority";
import { evaluateConstitutionalGate } from "./constitutional-gate";
import { evaluatePolicy, type PolicyEvaluationResult } from "./policy-engine";
import { createToolRegistry } from "./tool-registry";
import { createExecutionAuthority, type ApprovalGrant } from "./execution-authority";
import { createMemoryEngine, type MemoryActorRole } from "./memory-engine";
import type { MemoryRepository } from "./repositories/memory-repository";
import type { AuditRepository } from "./repositories/audit-repository";
import type { DbPolicyStore } from "./repositories/policy-repository";
import type { LedgerStore } from "./governance/decision-ledger";
import { doublePipeline } from "./isabella/double-pipeline";

export interface ApprovalStore {
  has(traceId: string, tool: string, actorId: string, tenantId: string): Promise<boolean>;
  consume(
    traceId: string,
    tool: string,
    actorId: string,
    tenantId: string,
  ): Promise<ApprovalGrant | null>;
}

export interface PipelineInput {
  requestId: string;
  traceId: string;
  actorId: string;
  actorIp: string;
  tenantId: string;
  input: string;
  identity: CROWN.IdentityAssessment;
  evidence: CROWN.EvidenceAssessment;
  timestamp: string;
  memoryScope?: CROWN.MemoryScope;
  toolRequest?: string;
  toolInput?: unknown;
  toolRole?: string;
  toolAuthenticated?: boolean;
  approvals?: ApprovalGrant[];
}

export interface PipelineResult {
  decision: CROWN.RoutingDecision;
  constitutionalGate: ReturnType<typeof evaluateConstitutionalGate>["checks"];
  policyResult: PolicyEvaluationResult | null;
  memoryRecords: number;
  toolExecuted: boolean;
  auditRecorded: boolean;
  systemPrompt: string;
  denied: boolean;
  denialReason?: string;
}

async function hasMatchingApproval(
  input: PipelineInput,
  approvalStore?: ApprovalStore,
): Promise<boolean> {
  if (
    approvalStore &&
    input.toolRequest &&
    (await approvalStore.has(input.traceId, input.toolRequest, input.actorId, input.tenantId))
  ) {
    return true;
  }

  const now = Date.now();
  return (input.approvals ?? []).some(
    (approval) =>
      !approval.consumed &&
      approval.traceId === input.traceId &&
      approval.tool === input.toolRequest &&
      approval.actorId === input.actorId &&
      approval.tenantId === input.tenantId &&
      approval.expiresAt > now,
  );
}

export function createSovereignPipeline(opts?: {
  memoryRepository?: MemoryRepository;
  auditRepository?: AuditRepository;
  approvalStore?: ApprovalStore;
  killSwitchStore?: {
    isKilled(capability: string): Promise<boolean>;
  };
  /** Policy-as-code (`isabella_policies`); si no se inyecta, store por defecto. */
  dbPolicyStore?: DbPolicyStore;
  /** Ledger durable de decisiones (`isabella_decisions`), opcional. */
  decisionStore?: LedgerStore;
}) {
  const memoryEngine = createMemoryEngine(opts?.memoryRepository);
  const toolRegistry = createToolRegistry();

  return {
    async execute(input: PipelineInput): Promise<PipelineResult> {
      // Pista de enrutamiento tomada de telemetría MEDIDA (0 antes de la
      // primera ejecución), no de cifras fijas inventadas.
      const measuredSnapshot = doublePipeline.getSnapshot();
      const healthHint = {
        A: measuredSnapshot.healthA,
        B: measuredSnapshot.healthB,
        latencyA: measuredSnapshot.metricsA.p95,
        latencyB: measuredSnapshot.metricsB.p95,
      };
      const outcome = await doublePipeline.route(
        async () => {
          const context: CROWN.RequestContext = {
            requestId: input.requestId,
            input: input.input,
            timestamp: input.timestamp,
            source: "user",
            actorId: input.actorId,
            locale: "es-MX",
          };

          const intent = CROWN.assessIntent(input.input);
          const routing = CROWN.createRoutingDecision(context, {
            identity: input.identity,
            evidence: input.evidence,
          });

          const gate = evaluateConstitutionalGate(context, input.identity, input.evidence, intent);

          if (!gate.passed) {
            const auditEvent = await opts?.auditRepository?.append({
              tenant_id: input.tenantId,
              timestamp: new Date().toISOString(),
              trace_id: input.traceId,
              correlation_id: input.requestId,
              actor: input.actorId,
              actor_ip: input.actorIp,
              action: "constitutional_gate_denied",
              resource: "sovereign-pipeline",
              event: "constitutional_gate_denied",
              severity: "S1",
              result: "denied",
              details: { message: `Artículos denegados: ${gate.deniedArticles.join(", ")}` },
            });

            return {
              decision: routing,
              constitutionalGate: gate.checks,
              policyResult: null,
              memoryRecords: 0,
              toolExecuted: false,
              auditRecorded: Boolean(auditEvent),
              systemPrompt: CROWN.buildSystemPrompt({
                ...routing,
                policy: {
                  ...routing.policy,
                  status: "denied",
                  reasons: [`Puerta constitucional denegada: ${gate.deniedArticles.join(", ")}`],
                },
              }),
              denied: true,
              denialReason: `Puerta constitucional denegada: ${gate.deniedArticles.join(", ")}`,
            };
          }

          const allowedScopes = CROWN.resolveAllowedMemoryScopes(intent, input.identity);
          const roleNames = input.identity.roles.map((role) => role.toLowerCase());
          const actorRole: MemoryActorRole = roleNames.includes("sovereignowner")
            ? "SovereignOwner"
            : roleNames.includes("operator")
              ? "Operator"
              : roleNames.includes("auditor")
                ? "Auditor"
                : roleNames.includes("system")
                  ? "System"
                  : "Guest";

          const memoryResult = await memoryEngine.retrieve({
            tenantId: input.tenantId,
            actorId: input.actorId,
            role: actorRole,
            scope: input.memoryScope ?? "turn",
            authenticated: input.identity.authenticated,
            grantedScopes: allowedScopes as unknown as readonly CROWN.MemoryScope[],
          });

          let policyResult: PolicyEvaluationResult | null = null;
          if (input.toolRequest) {
            const toolMeta = toolRegistry.lookup(input.toolRequest);
            if (toolMeta) {
              const approvalGranted = await hasMatchingApproval(input, opts?.approvalStore);
              policyResult = evaluatePolicy({
                tool: toolMeta,
                territorialBoundaryEnforced: false,
                humanInTheLoop: input.identity.authenticated,
                approvalThreshold: "medium",
                consentRequired: toolMeta.requiresApproval,
                consentGranted: approvalGranted,
              });

              if (policyResult.decision === "denied") {
                const auditEvent = await opts?.auditRepository?.append({
                  tenant_id: input.tenantId,
                  timestamp: new Date().toISOString(),
                  trace_id: input.traceId,
                  correlation_id: input.requestId,
                  actor: input.actorId,
                  actor_ip: input.actorIp,
                  action: "policy_denied",
                  resource: "crown-policy",
                  event: "policy_denied",
                  severity: "S2",
                  result: "denied",
                  details: { message: policyResult.reason },
                });

                return {
                  decision: routing,
                  constitutionalGate: gate.checks,
                  policyResult,
                  memoryRecords: memoryResult.records.length,
                  toolExecuted: false,
                  auditRecorded: Boolean(auditEvent),
                  systemPrompt: CROWN.buildSystemPrompt(routing),
                  denied: true,
                  denialReason: policyResult.reason,
                };
              }
            }
          }

          let toolExecuted = false;
          if (input.toolRequest) {
            const authority = createExecutionAuthority({
              memoryRepository: opts?.memoryRepository,
              auditRepository: opts?.auditRepository,
              approvalStore: opts?.approvalStore,
              killSwitch: opts?.killSwitchStore,
              dbPolicyStore: opts?.dbPolicyStore,
              decisionStore: opts?.decisionStore,
            });
            const outcome = await authority.execute({
              tool: input.toolRequest,
              input: input.toolInput ?? {},
              actorId: input.actorId,
              tenantId: input.tenantId,
              role: input.toolRole ?? (actorRole as string),
              authenticated: input.toolAuthenticated ?? input.identity.authenticated,
              traceId: input.traceId,
              ip: input.actorIp,
              approvals: input.approvals,
            });
            toolExecuted = outcome.executed;
            if (!outcome.executed) {
              const auditDeny = await opts?.auditRepository?.append({
                tenant_id: input.tenantId,
                timestamp: new Date().toISOString(),
                trace_id: input.traceId,
                correlation_id: input.requestId,
                actor: input.actorId,
                actor_ip: input.actorIp,
                action: "tool_execution_denied",
                resource: input.toolRequest ?? "sovereign-pipeline",
                event: "tool_execution_denied",
                severity: "S2",
                result: "denied",
                details: { message: `${outcome.stage}: ${outcome.reason}` },
              });
              return {
                decision: routing,
                constitutionalGate: gate.checks,
                policyResult,
                memoryRecords: memoryResult.records.length,
                toolExecuted: false,
                auditRecorded: Boolean(auditDeny),
                systemPrompt: CROWN.buildSystemPrompt(routing),
                denied: true,
                denialReason: `Ejecución denegada (${outcome.stage}): ${outcome.reason}`,
              };
            }
          }

          const auditEvent = await opts?.auditRepository?.append({
            tenant_id: input.tenantId,
            timestamp: new Date().toISOString(),
            trace_id: input.traceId,
            correlation_id: input.requestId,
            actor: input.actorId,
            actor_ip: input.actorIp,
            action: "pipeline_completed",
            resource: input.toolRequest ?? "sovereign-pipeline",
            event: "pipeline_completed",
            severity: "S3",
            result: "success",
            details: {
              intent: intent.category,
              action: intent.action,
              risk: routing.policy.risk,
              memoryUsed: memoryResult.records.length,
              toolRequest: input.toolRequest ?? null,
              toolExecuted,
            },
          });

          return {
            decision: routing,
            constitutionalGate: gate.checks,
            policyResult,
            memoryRecords: memoryResult.records.length,
            toolExecuted,
            auditRecorded: Boolean(auditEvent),
            systemPrompt: CROWN.buildSystemPrompt(routing),
            denied: false,
          };
        },
        healthHint,
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          input: input.input,
        },
      );

      return outcome.result;
    },

    verifyAuditChain(tenantId?: string) {
      if (!tenantId) {
        return {
          success: false,
          error: "tenant_id requerido; la cadena de auditoría sólo verificable por tenant.",
        };
      }
      return (
        opts?.auditRepository?.verifyChain(tenantId) ?? {
          success: false,
          error: "Sin repositorio de auditoría; la cadena no puede verificarse.",
        }
      );
    },
  };
}

export type SovereignPipeline = ReturnType<typeof createSovereignPipeline>;
export const SOVEREIGN_PIPELINE = {
  create: createSovereignPipeline,
};
