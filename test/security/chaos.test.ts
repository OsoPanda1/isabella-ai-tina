import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * CHAOS / FAULT-INJECTION (test/security/chaos.test.ts)
 * -----------------------------------------------------------------
 * La resiliencia se prueba provocando fallos reales: DB inalcanzable,
 * secreto ausente, entradas basura. Ningún fallo externo debe lanzar
 * excepciones sin manejar ni fingir éxito.
 */

describe("fallos de infraestructura degradan con gracia", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
  });

  it("webhook claim con DB caída retorna error (no lanza)", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://127.0.0.1:1/chaos_nowhere");
    vi.stubEnv("ISABELLA_RUNTIME_MODE", "development");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const { claimWebhookEvent } = await import("@/lib/economic-events");
    const result = await claimWebhookEvent({
      provider: "stripe",
      providerEventId: "evt_chaos_1",
      eventType: "charge.succeeded",
    });
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toBeDefined();
    vi.unstubAllEnvs();
    resetConfigCache();
  }, 30000);

  it("sello sin secreto retorna false (no lanza, no verifica)", async () => {
    vi.stubEnv("AEGIS_AUDIT_SECRET", "");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const { SovereignAudit } = await import("@/lib/sovereign-audit");
    const hash = SovereignAudit.hashData("x");
    expect(await SovereignAudit.verifyAuditSeal(hash, "audit-seal-v1:abc")).toBe(false);
    await expect(SovereignAudit.signAuditSeal(hash)).rejects.toThrow(/fail-closed/);
    vi.unstubAllEnvs();
    resetConfigCache();
  }, 30000);

  it("AEGIS con basura/entradas límite no falla y permite", async () => {
    const { analyzeAegisSemantic } = await import("@/lib/aegis-semantic");
    for (const input of ["", "   ", "a".repeat(20000), "😀🔥💀", "\u0000\u0001\u0002"]) {
      const analysis = analyzeAegisSemantic(input, {});
      expect(["allow", "flag", "deny"]).toContain(analysis.verdict);
      expect(Number.isFinite(analysis.score)).toBe(true);
    }
    expect(analyzeAegisSemantic("", {}).verdict).toBe("allow");
    // Import dinamico + corpus de 20k bajo carga paralela: margen amplio
    // para que el gate no dependa del scheduling de la maquina.
  }, 30000);

  it("PDP con identidad vacía deniega (no lanza)", async () => {
    const { evaluateAuthorization } = await import("@/lib/authorization");
    const decision = await evaluateAuthorization({
      tenant_id: "",
      subject_id: "",
      action: "execute",
      resource: "tool:memory.retrieve",
      context: {
        ip_address: "127.0.0.1",
        user_agent: "chaos",
        timestamp: new Date(),
      },
    });
    expect(decision.allow).toBe(false);
  }, 30000);
});
