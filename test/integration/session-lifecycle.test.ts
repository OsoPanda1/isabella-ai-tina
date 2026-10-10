import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * SESIONES: expiración y revocación efectivas
 * (test/integration/session-lifecycle.test.ts)
 * -----------------------------------------------------------------
 * jti ligado a fila de sesión durable (JSON dev): sesión expirada o
 * revocada (is_active=false) → 401 aunque el JWT siga válido.
 * Limpia isabella_data/ al terminar (higiene del repo).
 */

const DATA_DIR = join(process.cwd(), "isabella_data");

describe("ciclo de vida de sesión", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_JWT_SECRET", "test-jwt-secret-min-32-chars-0123456789abcdef");
    vi.stubEnv("ISABELLA_RUNTIME_MODE", "development");
    vi.stubEnv("NODE_ENV", "test");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  });

  async function issueSession(overrides: Record<string, unknown> = {}) {
    const { SecuritySystem } = await import("@/lib/security");
    const { repositoryFactory } = await import("@/lib/persistence/repository-factory");
    const token = await SecuritySystem.generateSovereignToken(
      "user_sess",
      "Operator",
      "tenant_sess",
      "isabella:chat",
    );
    const verification = await SecuritySystem.verifyToken(token);
    if (!verification.success || !verification.claims) throw new Error("token inválido en test");
    const jti = (verification.claims as unknown as Record<string, unknown>).jti as string;
    expect(typeof jti).toBe("string");
    const sessions = repositoryFactory.getSessionRepository();
    const created = await sessions.create("tenant_sess", {
      userId: "user_sess",
      tokenJti: jti,
      isActive: true,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ...overrides,
    } as never);
    return { token, jti, created };
  }

  function authorizedRequest(token: string): Request {
    return new Request("https://test.local/api/db?action=session", {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it("sesión vigente autoriza", async () => {
    const { PrincipalContext } = await import("@/lib/principal-context");
    const { token } = await issueSession();
    // Tenant requerido por el guard: crearlo también.
    const { repositoryFactory } = await import("@/lib/persistence/repository-factory");
    await repositoryFactory.getTenantRepository().create("tenant_sess", {
      id: "tenant_sess",
      slug: "sess",
      tier: "pro",
      quotaBalance: 10,
      quotaTierLimit: 100,
    } as never);
    const result = await PrincipalContext.authorize(authorizedRequest(token));
    expect(result.success).toBe(true);
  });

  it("sesión expirada se rechaza (401) aunque el JWT valga", async () => {
    const { PrincipalContext } = await import("@/lib/principal-context");
    const { repositoryFactory } = await import("@/lib/persistence/repository-factory");
    await repositoryFactory.getTenantRepository().create("tenant_sess", {
      id: "tenant_sess",
      slug: "sess",
      tier: "pro",
      quotaBalance: 10,
      quotaTierLimit: 100,
    } as never);
    const { token } = await issueSession({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const result = await PrincipalContext.authorize(authorizedRequest(token));
    expect(result.success).toBe(false);
    if (!result.success) {
      const body = (await result.response.json()) as { error: string };
      expect(body.error).toMatch(/expirada/i);
    }
  });

  it("sesión revocada (is_active=false) se rechaza", async () => {
    const { PrincipalContext } = await import("@/lib/principal-context");
    const { repositoryFactory } = await import("@/lib/persistence/repository-factory");
    await repositoryFactory.getTenantRepository().create("tenant_sess", {
      id: "tenant_sess",
      slug: "sess",
      tier: "pro",
      quotaBalance: 10,
      quotaTierLimit: 100,
    } as never);
    const { token } = await issueSession({ isActive: false });
    const result = await PrincipalContext.authorize(authorizedRequest(token));
    expect(result.success).toBe(false);
    if (!result.success) {
      const body = (await result.response.json()) as { error: string };
      expect(body.error).toMatch(/revocada/i);
    }
  });
});
