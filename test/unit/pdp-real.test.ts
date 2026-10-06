import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * PDP REAL + SELLO DE AUDITORÍA (test/unit/pdp-real.test.ts)
 * -----------------------------------------------------------------
 * Cubre la cadena de autoridad: RBAC (matriz) + ABAC (deny-overrides) +
 * anomalía, y el sello HMAC-SHA3-512 verificable. Ningún test acepta
 * simulaciones: cada allow/deny proviene del motor real.
 */

const SECRET = "test-audit-secret-min-32-chars-0123456789";

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: "tenant-test",
    subject_id: "user-test",
    action: "execute",
    resource: "tool",
    role: "Operator",
    authenticated: true,
    context: {
      ip_address: "127.0.0.1",
      user_agent: "vitest",
      timestamp: new Date(),
    },
    ...overrides,
  };
}

describe("PDP real (authorization.ts)", () => {
  it("permite a Operator en tool:execute con decisión firmada", async () => {
    const { evaluateAuthorization } = await import("@/lib/authorization");
    const decision = await evaluateAuthorization(baseCtx());
    expect(decision.allow).toBe(true);
    expect(decision.signature.length).toBeGreaterThan(32);
    // La política versionada evolucionó (v4.0.0-real → v4.1.0-native-context);
    // el contrato es que exista una versión semántica explícita, no un literal.
    expect(decision.policy_version).toMatch(/^v\d+\.\d+\.\d+/);
    expect(decision.obligations).toContain("pqc_signature_required");
  });

  it("niega a Guest en tool:execute (sin permiso en catálogo)", async () => {
    const { evaluateAuthorization } = await import("@/lib/authorization");
    const decision = await evaluateAuthorization(baseCtx({ role: "Guest" }));
    expect(decision.allow).toBe(false);
    expect(decision.obligations.some((o) => o.startsWith("deny:rbac-deny"))).toBe(true);
  });

  it("niega rol desconocido (fail-closed)", async () => {
    const { evaluateAuthorization } = await import("@/lib/authorization");
    const decision = await evaluateAuthorization(baseCtx({ role: "SuperAdmin" }));
    expect(decision.allow).toBe(false);
  });

  it("niega operación desconocida (fail-closed)", async () => {
    const { evaluateAuthorization } = await import("@/lib/authorization");
    const decision = await evaluateAuthorization(
      baseCtx({ resource: "teleport", action: "banish" }),
    );
    expect(decision.allow).toBe(false);
    expect(decision.obligations.some((o) => o.includes("unknown-operation"))).toBe(true);
  });

  it("niega por anomalía de comportamiento", async () => {
    const { evaluateAuthorization } = await import("@/lib/authorization");
    const decision = await evaluateAuthorization(
      baseCtx({
        context: {
          ip_address: "127.0.0.1",
          user_agent: "vitest",
          timestamp: new Date(),
          behavior_score: 95,
        },
      }),
    );
    expect(decision.allow).toBe(false);
  });

  it("niega skill a Guest (skills requieren tool:execute)", async () => {
    const { evaluateAuthorization } = await import("@/lib/authorization");
    const decision = await evaluateAuthorization(
      baseCtx({
        resource: "skill:atlas",
        action: "skill.execute",
        role: "Guest",
      }),
    );
    expect(decision.allow).toBe(false);
  });

  it("permite skill a Operator", async () => {
    const { evaluateAuthorization } = await import("@/lib/authorization");
    const decision = await evaluateAuthorization(
      baseCtx({
        resource: "skill:atlas",
        action: "skill.execute",
        role: "Operator",
      }),
    );
    expect(decision.allow).toBe(true);
  });
});

describe("ABAC fail-closed (abac.ts)", () => {
  it("retorna notApplied cuando ninguna política aplica (nunca allow implícito)", async () => {
    const { evaluateAbac } = await import("@/lib/abac");
    const result = evaluateAbac({
      role: "Operator",
      subjectTenant: "t1",
      resource: "tool",
      action: "execute",
      resourceTenant: "t1",
      resourceOwner: "",
      subject: "u1",
      risk: 0.1,
      authenticated: true,
      timezone: "UTC",
    });
    expect(result.decision).toBe("notApplied");
  });

  it("deniega cross-tenant para roles sin alcance global", async () => {
    const { evaluateAbac } = await import("@/lib/abac");
    const result = evaluateAbac({
      role: "Operator",
      subjectTenant: "t1",
      resource: "tool",
      action: "execute",
      resourceTenant: "t2",
      resourceOwner: "",
      subject: "u1",
      risk: 0.1,
      authenticated: true,
      timezone: "UTC",
    });
    expect(result.decision).toBe("deny");
  });
});

describe("Sello de auditoría real (sovereign-audit.ts)", () => {
  beforeEach(async () => {
    vi.stubEnv("AEGIS_AUDIT_SECRET", SECRET);
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
  });

  it("firma y verifica (roundtrip real)", async () => {
    const { SovereignAudit } = await import("@/lib/sovereign-audit");
    const hash = SovereignAudit.hashData("payload-canonico");
    const seal = await SovereignAudit.signAuditSeal(hash);
    expect(seal.startsWith("audit-seal-v1:")).toBe(true);
    expect(await SovereignAudit.verifyAuditSeal(hash, seal)).toBe(true);
  });

  it("rechaza sello manipulado y prefijo ajeno", async () => {
    const { SovereignAudit } = await import("@/lib/sovereign-audit");
    const hash = SovereignAudit.hashData("payload-canonico");
    const seal = await SovereignAudit.signAuditSeal(hash);
    const tampered = seal.slice(0, -2) + (seal.endsWith("AA") ? "BB" : "AA");
    expect(await SovereignAudit.verifyAuditSeal(hash, tampered)).toBe(false);
    expect(await SovereignAudit.verifyAuditSeal(hash, "mldsa-sig-v1:falso")).toBe(false);
    expect(await SovereignAudit.verifyAuditSeal("otro-hash", seal)).toBe(false);
  });
});
