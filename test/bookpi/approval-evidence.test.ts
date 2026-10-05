import { describe, it, expect, beforeAll, vi } from "vitest";

/**
 * APPROVALS DURABLES (test/bookpi/approval-evidence.test.ts)
 * -----------------------------------------------------------------
 * Consumo atómico concurrente: N consumidores simultáneos → exactamente
 * 1 gana (SKIP LOCKED). Gateado por DB (TEST_DATABASE_URL/DATABASE_URL).
 */

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(DB_URL);

beforeAll(async () => {
  if (!HAS_DB) return;
  vi.stubEnv("DATABASE_URL", DB_URL as string);
  vi.stubEnv("ISABELLA_RUNTIME_MODE", "development");
  const { resetConfigCache } = await import("@/lib/config");
  resetConfigCache();
});

describe.skipIf(!HAS_DB)("approval store Postgres (real)", () => {
  it("5 consumos concurrentes → exactamente 1 ganador", async () => {
    const { grantApprovalAsync, consumeApprovalAsync } =
      await import("@/lib/repositories/approval-repository");
    const trace = `trace_apr_${Date.now()}`;
    await grantApprovalAsync(trace, "compute.sandbox", "op1", "tenant_apr");
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        consumeApprovalAsync(trace, "compute.sandbox", "op1", "tenant_apr"),
      ),
    );
    const winners = results.filter((result) => result !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.consumed).toBe(true);
  });

  it("grant duplicado retorna el existente (idempotente)", async () => {
    const { grantApprovalAsync } = await import("@/lib/repositories/approval-repository");
    const trace = `trace_dup_${Date.now()}`;
    const first = await grantApprovalAsync(trace, "memory.retrieve", "op1", "tenant_apr");
    const second = await grantApprovalAsync(trace, "memory.retrieve", "op1", "tenant_apr");
    expect(second.approvalId).toBe(first.approvalId);
  });

  it("execution authority usa el store durable cuando se provee", async () => {
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const { createPostgresApprovalStore } = await import("@/lib/repositories/approval-repository");
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "isabella-apr-"));

    const authority = createExecutionAuthority({
      memoryRepository: createMemoryRepository(join(dir, "mem.json")),
      auditRepository: createAuditRepository(join(dir, "audit.json")),
      approvalStore: createPostgresApprovalStore(),
    });
    const trace = `trace_exec_${Date.now()}`;
    const { grantApprovalAsync } = await import("@/lib/repositories/approval-repository");
    await grantApprovalAsync(trace, "memory.retrieve", "op1", "tenant_apr");

    const outcome = await authority.execute({
      tool: "memory.retrieve",
      input: { tenantId: "tenant_apr", scope: "turn" },
      actorId: "op1",
      tenantId: "tenant_apr",
      role: "Operator",
      authenticated: true,
      traceId: trace,
      ip: "127.0.0.1",
    });
    expect(outcome.executed).toBe(true);
  });
});
