import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * DEV-AUTH GUARD + MARKETPLACE VALIDATE
 * (test/unit/dev-auth-marketplace.test.ts)
 * -----------------------------------------------------------------
 * - dev-auth no existe en producción (404), existe en desarrollo.
 * - Validación de marketplace pura (sin DB).
 */

describe("dev-auth guard", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
  });

  it("en producción responde 404 (no confirma existencia)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ISABELLA_RUNTIME_MODE", "production");
    vi.stubEnv("AUTH_DEV_SESSION_ENABLED", "false");
    vi.stubEnv("ALLOW_GUEST_CHAT", "false");
    vi.stubEnv("DURABLE_JSON_ALLOWED", "false");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const { devAuthNotFound, isDevAuthAction } = await import("@/lib/dev-auth-guard");
    expect(isDevAuthAction("dev-session")).toBe(true);
    expect(isDevAuthAction("session")).toBe(false);
    const response = devAuthNotFound("dev-session");
    expect(response).not.toBeNull();
    expect(response?.status).toBe(404);
    vi.unstubAllEnvs();
    resetConfigCache();
  });

  it("en desarrollo deja pasar al doble gate", async () => {
    const { devAuthNotFound } = await import("@/lib/dev-auth-guard");
    expect(devAuthNotFound("oauth-url")).toBeNull();
  });

  it("las acciones normales NUNCA las bloquea este guard (regresion /api/db)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ISABELLA_RUNTIME_MODE", "production");
    vi.stubEnv("AUTH_DEV_SESSION_ENABLED", "false");
    vi.stubEnv("ALLOW_GUEST_CHAT", "false");
    vi.stubEnv("DURABLE_JSON_ALLOWED", "false");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const { devAuthNotFound } = await import("@/lib/dev-auth-guard");
    for (const action of [
      "session",
      "ledger",
      "audit",
      "test",
      "emergency-kill",
      "user-login",
      "approve",
      "payout",
    ]) {
      expect(devAuthNotFound(action)).toBeNull();
    }
    vi.unstubAllEnvs();
    resetConfigCache();
  });

  it("la superficie dev/test si se oculta en produccion (404)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ISABELLA_RUNTIME_MODE", "production");
    vi.stubEnv("AUTH_DEV_SESSION_ENABLED", "false");
    vi.stubEnv("ALLOW_GUEST_CHAT", "false");
    vi.stubEnv("DURABLE_JSON_ALLOWED", "false");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const { devSurfaceNotFound } = await import("@/lib/dev-auth-guard");
    const response = devSurfaceNotFound();
    expect(response?.status).toBe(404);
    vi.unstubAllEnvs();
    resetConfigCache();
    expect(devSurfaceNotFound()).toBeNull();
  });
});

describe("marketplace validate (puro)", () => {
  it("acepta listing válido y rechaza inválidos", async () => {
    const { validateMarketplaceInput } = await import("@/lib/repositories/marketplace-repository");
    expect(
      validateMarketplaceInput({
        skillId: "gis-cadastre",
        title: "Módulo GIS",
        costCents: 4500,
        description: "Descripción suficientemente larga.",
      }).valid,
    ).toBe(true);
    expect(
      validateMarketplaceInput({
        skillId: "BAD ID!",
        title: "T",
        costCents: -5,
        description: "x",
      }).valid,
    ).toBe(false);
    expect(
      validateMarketplaceInput({
        skillId: "ok-id",
        title: "Título válido",
        costCents: 200_000,
        description: "Descripción suficientemente larga.",
      }).valid,
    ).toBe(false);
  });
});
