import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * BILLING GUARD (test/security/billing-guard.test.ts)
 * -----------------------------------------------------------------
 * Mínimo privilegio económico: scopes dedicados por operación y
 * step-up firmado (binding tenant/usuario/operación, TTL corto).
 */

const SECRET = "test-jwt-secret-min-32-chars-0123456789abcdef";

beforeEach(async () => {
  vi.stubEnv("AUTH_JWT_SECRET", SECRET);
  const { resetConfigCache } = await import("@/lib/config");
  resetConfigCache();
});

describe("billing scopes", () => {
  it("deniega operaciones sin el scope dedicado a roles no privilegiados", async () => {
    const { authorizeBillingOperation } = await import("@/lib/billing-guard");
    const result = authorizeBillingOperation({
      operation: "checkout",
      tenantId: "t1",
      userId: "u1",
      role: "Operator",
      scope: "isabella:chat",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("BILLING_SCOPE_REQUIRED");
  });

  it("concede scopes de billing a roles soberanos sin duplicar", async () => {
    const { deriveBillingScopes } = await import("@/lib/billing-guard");
    const scopes = deriveBillingScopes("SovereignOwner", "isabella:chat billing:checkout");
    expect(scopes.filter((s) => s === "billing:checkout")).toHaveLength(1);
    expect(scopes).toContain("billing:refund");
  });

  it("autoriza checkout a un rol no privilegiado con scope explícito", async () => {
    const { authorizeBillingOperation } = await import("@/lib/billing-guard");
    const result = authorizeBillingOperation({
      operation: "checkout",
      tenantId: "t1",
      userId: "u1",
      role: "Operator",
      scope: "billing:checkout",
    });
    expect(result.ok).toBe(true);
  });
});

describe("step-up firmado", () => {
  it("exige step-up para refund incluso al rol soberano", async () => {
    const { authorizeBillingOperation } = await import("@/lib/billing-guard");
    const result = authorizeBillingOperation({
      operation: "refund",
      tenantId: "t1",
      userId: "u1",
      role: "SovereignOwner",
      scope: "isabella:chat",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("STEP_UP_REQUIRED");
  });

  it("acepta step-up válido ligado a la misma operación", async () => {
    const { authorizeBillingOperation, issueBillingStepUp } = await import("@/lib/billing-guard");
    const token = issueBillingStepUp({ tenantId: "t1", userId: "u1", operation: "refund" });
    const result = authorizeBillingOperation({
      operation: "refund",
      tenantId: "t1",
      userId: "u1",
      role: "SovereignOwner",
      scope: "isabella:chat",
      stepUpToken: token,
    });
    expect(result.ok).toBe(true);
  });

  it("rechaza step-up de otra operación, otro usuario o expirado", async () => {
    const { verifyBillingStepUp, issueBillingStepUp } = await import("@/lib/billing-guard");
    const now = Date.now();
    const token = issueBillingStepUp({
      tenantId: "t1",
      userId: "u1",
      operation: "refund",
      now,
      ttlMs: 60_000,
    });
    expect(
      verifyBillingStepUp(token, { tenantId: "t1", userId: "u1", operation: "topup" }, now),
    ).toBe(false);
    expect(
      verifyBillingStepUp(token, { tenantId: "t1", userId: "u2", operation: "refund" }, now),
    ).toBe(false);
    expect(
      verifyBillingStepUp(
        token,
        { tenantId: "t1", userId: "u1", operation: "refund" },
        now + 120_000,
      ),
    ).toBe(false);
  });

  it("rechaza firmas manipuladas", async () => {
    const { verifyBillingStepUp, issueBillingStepUp } = await import("@/lib/billing-guard");
    const token = issueBillingStepUp({ tenantId: "t1", userId: "u1", operation: "topup" });
    const tampered = `${token.slice(0, -2)}xy`;
    expect(
      verifyBillingStepUp(tampered, { tenantId: "t1", userId: "u1", operation: "topup" }),
    ).toBe(false);
  });
});

describe("request hash", () => {
  it("es estable y distingue requests distintos", async () => {
    const { billingRequestHash } = await import("@/lib/billing-guard");
    expect(billingRequestHash({ planId: "pro" })).toBe(billingRequestHash({ planId: "pro" }));
    expect(billingRequestHash({ planId: "pro" })).not.toBe(
      billingRequestHash({ planId: "enterprise" }),
    );
  });
});
