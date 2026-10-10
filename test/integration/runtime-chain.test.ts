import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * RUNTIME INTEGRATION (test/integration/runtime-chain.test.ts)
 * -----------------------------------------------------------------
 * Cadena REAL sin red ni DB externa (memoria file-backed aislada en tmp;
 * auditoría en memoria con cadena por tenant):
 *
 *   auth(PDP) → CROWN → AEGIS → memory → inference-policy → audit
 *   + execution authority (toolExecuted: true con evidencia)
 *
 * Cada etapa usa el módulo productivo, no dobles.
 */

function isolatedRepos() {
  const dir = mkdtempSync(join(tmpdir(), "isabella-chain-"));
  return {
    memPath: join(dir, "mem.json"),
    auditPath: join(dir, "audit.json"),
  };
}

const OPERATOR_IDENTITY = {
  authenticated: true,
  actorId: "op_integration",
  roles: ["Operator"],
  permissions: ["tool:execute", "memory:read:own", "system:telemetry"],
  dataScopes: ["turn", "session"] as Array<"turn" | "session" | "project" | "territorial">,
  authenticationMethod: "integration-test",
};

const EVIDENCE = {
  level: "weak" as const,
  verified: false,
  sources: ["user_input"],
  limitations: ["Sin verificación externa."],
};

describe("cadena runtime auth → CROWN → AEGIS → memory → audit", () => {
  let memPath: string;
  let auditPath: string;

  beforeEach(() => {
    const repos = isolatedRepos();
    memPath = repos.memPath;
    auditPath = repos.auditPath;
  });

  it("PDP autoriza a Operator en tool:execute", async () => {
    const { evaluateAuthorization } = await import("@/lib/authorization");
    const decision = await evaluateAuthorization({
      tenant_id: "tenant_chain",
      subject_id: "op_integration",
      action: "execute",
      resource: "tool:memory.retrieve",
      role: "Operator",
      authenticated: true,
      context: {
        ip_address: "127.0.0.1",
        user_agent: "integration",
        timestamp: new Date(),
      },
    });
    expect(decision.allow).toBe(true);
  });

  it("AEGIS permite entrada benigna de la cadena", async () => {
    const { analyzeAegisSemantic } = await import("@/lib/aegis-semantic");
    const analysis = analyzeAegisSemantic("¿Cuál es el saldo de mi tenant?", {});
    expect(analysis.verdict).toBe("allow");
  });

  it("pipeline completo ejecuta herramienta de memoria y audita", async () => {
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const { createSovereignPipeline } = await import("@/lib/sovereign-pipeline");

    const memoryRepository = createMemoryRepository(memPath);
    const auditRepository = createAuditRepository(auditPath);

    const seed = await memoryRepository.add({
      tenantId: "tenant_chain",
      content: "Saldo inicial verificado del tenant.",
      source: "system",
      scope: "turn",
      sensitivity: "internal",
      purpose: "integration-seed",
      consentRequired: false,
      consentGranted: true,
    });
    expect(seed.success).toBe(true);

    const pipeline = createSovereignPipeline({
      memoryRepository,
      auditRepository,
    });
    const result = await pipeline.execute({
      requestId: "req_chain_1",
      traceId: "trace_chain_1",
      actorId: "op_integration",
      actorIp: "127.0.0.1",
      tenantId: "tenant_chain",
      input: "¿Cuál es el saldo de mi tenant?",
      identity: OPERATOR_IDENTITY,
      evidence: EVIDENCE,
      timestamp: new Date().toISOString(),
      memoryScope: "turn",
      toolRequest: "memory.retrieve",
      toolInput: { tenantId: "tenant_chain", scope: "turn" },
      toolRole: "Operator",
      toolAuthenticated: true,
    });

    expect(result.denied).toBe(false);
    expect(result.toolExecuted).toBe(true);
    expect(result.auditRecorded).toBe(true);
    expect(result.memoryRecords).toBeGreaterThanOrEqual(1);

    const chain = await auditRepository.verifyChain("tenant_chain");
    expect(chain.valid).toBe(true);
    expect(chain.recordCount).toBeGreaterThan(0);
    expect(memoryRepository.verifyIntegrity().success).toBe(true);
  });

  it("Guest no ejecuta herramientas (deny con evidencia)", async () => {
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const { createSovereignPipeline } = await import("@/lib/sovereign-pipeline");

    const pipeline = createSovereignPipeline({
      memoryRepository: createMemoryRepository(memPath),
      auditRepository: createAuditRepository(auditPath),
    });
    const result = await pipeline.execute({
      requestId: "req_chain_2",
      traceId: "trace_chain_2",
      actorId: "guest_anon",
      actorIp: "127.0.0.1",
      tenantId: "tenant_chain",
      input: "Ejecuta la herramienta de memoria.",
      identity: {
        ...OPERATOR_IDENTITY,
        authenticated: false,
        roles: ["Guest"],
        permissions: [],
      },
      evidence: EVIDENCE,
      timestamp: new Date().toISOString(),
      memoryScope: "turn",
      toolRequest: "memory.retrieve",
      toolInput: { tenantId: "tenant_chain" },
      toolRole: "Guest",
      toolAuthenticated: false,
    });

    expect(result.denied).toBe(true);
    expect(result.toolExecuted).toBe(false);
    expect(result.denialReason).toBeDefined();
  });

  it("approval de un solo uso habilita herramienta crítica y se agota", async () => {
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const { createExecutionAuthority } = await import("@/lib/execution-authority");

    const authority = createExecutionAuthority({
      memoryRepository: createMemoryRepository(memPath),
      auditRepository: createAuditRepository(auditPath),
    });
    // compute.sandbox es critical + requiresApproval y no tiene ejecutor aquí.
    const noApproval = await authority.execute({
      tool: "compute.sandbox",
      input: {},
      actorId: "op_integration",
      tenantId: "tenant_chain",
      role: "SovereignOwner",
      authenticated: true,
      traceId: "trace_apr_1",
      ip: "127.0.0.1",
    });
    // SovereignOwner tiene tool:execute vía herencia pero falta approval.
    expect(noApproval.executed).toBe(false);
    expect(noApproval).toHaveProperty("stage", "approval");

    const grant = authority.approvals.grant(
      "trace_apr_1",
      "compute.sandbox",
      "op_integration",
      "tenant_chain",
    );
    const withApproval = await authority.execute({
      tool: "compute.sandbox",
      input: {},
      actorId: "op_integration",
      tenantId: "tenant_chain",
      role: "SovereignOwner",
      authenticated: true,
      traceId: "trace_apr_1",
      ip: "127.0.0.1",
    });
    // Con approval consumido pero sin ejecutor: falla en execution (honesto).
    expect(withApproval.executed).toBe(false);
    expect(withApproval).toHaveProperty("stage", "execution");
    expect(grant.consumed).toBe(true);
  });
});
