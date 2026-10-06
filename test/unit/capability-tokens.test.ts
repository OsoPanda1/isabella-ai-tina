import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * CAPABILITY TOKENS (test/unit/capability-tokens.test.ts)
 * -----------------------------------------------------------------
 * Acciones firmadas: emisión, binding actor/tenant/tool/trace,
 * expiración, manipulación y uso como approval en Execution Authority.
 */

const SECRET = "test-jwt-secret-min-32-chars-0123456789abcdef";

beforeEach(async () => {
  vi.stubEnv("AUTH_JWT_SECRET", SECRET);
  const { resetConfigCache } = await import("@/lib/config");
  resetConfigCache();
});

describe("emisión y verificación", () => {
  it("token válido pasa con claims ligados", async () => {
    const { issueCapabilityToken, verifyCapabilityToken } = await import("@/lib/capability-tokens");
    const token = issueCapabilityToken({
      actorId: "op1",
      tenantId: "t1",
      tool: "memory.retrieve",
      traceId: "tr_1",
    });
    const verification = verifyCapabilityToken(token, {
      actorId: "op1",
      tenantId: "t1",
      tool: "memory.retrieve",
      traceId: "tr_1",
    });
    expect(verification.valid).toBe(true);
    expect(verification.claims?.jti.startsWith("cap_")).toBe(true);
  });

  it("rechaza binding cruzado (otra tool, otro trace)", async () => {
    const { issueCapabilityToken, verifyCapabilityToken } = await import("@/lib/capability-tokens");
    const token = issueCapabilityToken({
      actorId: "op1",
      tenantId: "t1",
      tool: "memory.retrieve",
      traceId: "tr_1",
    });
    expect(
      verifyCapabilityToken(token, {
        actorId: "op1",
        tenantId: "t1",
        tool: "memory.record",
        traceId: "tr_1",
      }).valid,
    ).toBe(false);
    expect(
      verifyCapabilityToken(token, {
        actorId: "op1",
        tenantId: "t1",
        tool: "memory.retrieve",
        traceId: "tr_2",
      }).valid,
    ).toBe(false);
  });

  it("rechaza token manipulado y expirado", async () => {
    const { issueCapabilityToken, verifyCapabilityToken } = await import("@/lib/capability-tokens");
    const token = issueCapabilityToken({
      actorId: "op1",
      tenantId: "t1",
      tool: "memory.retrieve",
      traceId: "tr_1",
      ttlMs: 1,
    });
    const [prefix, payload] = token.split(".");
    const tampered = `${prefix}.${payload}AA.invalidmac`;
    expect(
      verifyCapabilityToken(tampered, {
        actorId: "op1",
        tenantId: "t1",
        tool: "memory.retrieve",
        traceId: "tr_1",
      }).valid,
    ).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      verifyCapabilityToken(token, {
        actorId: "op1",
        tenantId: "t1",
        tool: "memory.retrieve",
        traceId: "tr_1",
      }).valid,
    ).toBe(false);
  });
});

describe("capability como approval en Execution Authority", () => {
  it("token válido autoriza compute.sandbox (critical) y audita el jti", async () => {
    const { issueCapabilityToken } = await import("@/lib/capability-tokens");
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "isabella-cap-"));

    const token = issueCapabilityToken({
      actorId: "op1",
      tenantId: "t_cap",
      tool: "compute.sandbox",
      traceId: "tr_cap_1",
    });
    const authority = createExecutionAuthority({
      memoryRepository: createMemoryRepository(join(dir, "mem.json")),
      auditRepository: createAuditRepository(join(dir, "audit.json")),
    });
    const outcome = await authority.execute({
      tool: "compute.sandbox",
      input: { code: "40 + 2", language: "javascript" },
      actorId: "op1",
      tenantId: "t_cap",
      role: "SovereignOwner",
      authenticated: true,
      traceId: "tr_cap_1",
      ip: "127.0.0.1",
      capabilityToken: token,
    });
    expect(outcome.executed).toBe(true);
    if (outcome.executed) {
      expect(outcome.approvalId).not.toBeNull();
      expect(String(outcome.approvalId).startsWith("cap_")).toBe(true);
      expect(outcome.result).toMatchObject({ output: "42" });
    }
  });

  it("token de otra traza no autoriza (se ignora)", async () => {
    const { issueCapabilityToken } = await import("@/lib/capability-tokens");
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "isabella-cap2-"));
    const token = issueCapabilityToken({
      actorId: "op1",
      tenantId: "t_cap",
      tool: "memory.retrieve",
      traceId: "tr_other",
    });
    const authority = createExecutionAuthority({
      memoryRepository: createMemoryRepository(join(dir, "mem.json")),
      auditRepository: createAuditRepository(join(dir, "audit.json")),
    });
    const outcome = await authority.execute({
      tool: "memory.retrieve",
      input: { tenantId: "t_cap" },
      actorId: "op1",
      tenantId: "t_cap",
      role: "Operator",
      authenticated: true,
      traceId: "tr_cap_2",
      ip: "127.0.0.1",
      capabilityToken: token,
    });
    // memory.retrieve es medium (sin approval requerido): ejecuta igual;
    // el token inválido simplemente no aporta approval.
    expect(outcome.executed).toBe(true);
  });
});
