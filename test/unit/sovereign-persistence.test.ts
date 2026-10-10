import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock `pg` BEFORE importing sovereign-engine so hydrate()/save() never hit a
// real database. The mock Pool records queries the way pg's Pool API does.
const queryLog: { text: string; params: unknown[] }[] = [];

// Failure injector: makes the NEXT sovereign_state query reject, simulating a
// PostgreSQL outage so the P0 fail-closed guards can be exercised.
let failNextSovereignQuery = false;

vi.mock("pg", () => {
  class MockPool {
    public max = 5;
    public on() {
      return this;
    }
    public async query(text: string, params: unknown[] = []) {
      queryLog.push({ text, params });
      if (failNextSovereignQuery) {
        throw new Error("mock pg outage");
      }
      // SELECT over sovereign_state → no existing row
      if (text.startsWith("SELECT") && text.includes("sovereign_state")) {
        return { rows: [] };
      }
      // CREATE TABLE / INSERT / upsert → ok
      return { rows: [], rowCount: 1 };
    }
  }
  return {
    Pool: MockPool,
  };
});

import { SovereignDB, DurableStateUnavailableError } from "../../src/lib/sovereign-engine";
import { resetConfigCache } from "../../src/lib/config";

const originalRuntimeMode = process.env.ISABELLA_RUNTIME_MODE;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalEnv = {
  PUBLIC_URL: process.env.PUBLIC_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ENCRYPTION_MASTER_KEY: process.env.ENCRYPTION_MASTER_KEY,
  CROWN_POLICY_SIGNING_KEY: process.env.CROWN_POLICY_SIGNING_KEY,
  AEGIS_AUDIT_SECRET: process.env.AEGIS_AUDIT_SECRET,
  BOOKPI_SIGNING_KEY: process.env.BOOKPI_SIGNING_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
};

/** Entorno suficiente para que config() parsee en modo production (mock pg). */
const PROD_ENV_STUBS: Record<string, string> = {
  ISABELLA_RUNTIME_MODE: "production",
  PUBLIC_URL: "https://isabella.test",
  SUPABASE_URL: "https://fake.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def",
  AUTH_JWT_SECRET: "jwt-secret-0123456789abcdef-0123456789abcdef",
  GEMINI_API_KEY: "gemini-key-001",
  ENCRYPTION_MASTER_KEY: "enc-key-0123456789abcdef-0123456789abcdef",
  CROWN_POLICY_SIGNING_KEY: "crown-key-0123456789abcdef-0123456789abcdef",
  AEGIS_AUDIT_SECRET: "aegis-key-0123456789abcdef-0123456789abcdef",
  BOOKPI_SIGNING_KEY: "bookpi-key-0123456789abcdef-0123456789abcdef",
  STRIPE_SECRET_KEY: "sk_test_51abcdefghijklmnopqrstuvwxyz",
  STRIPE_WEBHOOK_SECRET: "whsec_abcdefghijklmnopqrstuvwxyz",
};

function applyProductionEnv(databaseUrl?: string) {
  for (const [k, v] of Object.entries(PROD_ENV_STUBS)) {
    process.env[k] = v;
  }
  // El host puede traer gate de dev activo; en producción deben estar apagados.
  process.env.AUTH_DEV_SESSION_ENABLED = "false";
  process.env.ALLOW_GUEST_CHAT = "false";
  process.env.DURABLE_JSON_ALLOWED = "false";
  if (databaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = databaseUrl;
  }
}

describe("SovereignDB Production Persistence Adapter (P0 deployment blocker)", () => {
  beforeEach(() => {
    queryLog.length = 0;
    failNextSovereignQuery = false;
    SovereignDB.resetMemoryCache();
  });

  afterEach(() => {
    failNextSovereignQuery = false;
    if (originalRuntimeMode === undefined) {
      delete process.env.ISABELLA_RUNTIME_MODE;
    } else {
      process.env.ISABELLA_RUNTIME_MODE = originalRuntimeMode;
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    resetConfigCache();
    SovereignDB.resetMemoryCache();
  });

  it("load() no debe lanzar en modo no-producción (compat retenida)", () => {
    const db = SovereignDB.load();
    expect(db).toBeDefined();
    expect(Array.isArray(db.tenants)).toBe(true);
    expect(Array.isArray(db.ledger)).toBe(true);
  });

  it("save()/load() round-trip mantiene el estado en caché", () => {
    const db = SovereignDB.load();
    db.tenants.push({
      id: "tenant_test_save",
      name: "Tenant Test",
      region: "Mexico-Hidalgo-01",
      quotaBalance: 25,
      tier: "Enterprise",
    });
    SovereignDB.upsertTenant(db.tenants[db.tenants.length - 1]!);
    const reloaded = SovereignDB.load();
    expect(reloaded.tenants.some((t) => t.id === "tenant_test_save")).toBe(true);
  });

  it("appendLedgerBlock no rompe la cadena (integridad)", () => {
    SovereignDB.appendLedgerBlock(
      "t_prod_persist",
      "u_test",
      "VERIFICATION: test block",
      "other",
      0.05,
      10,
    );
    const integrity = SovereignDB.verifyLedgerIntegrity();
    expect(integrity.success).toBe(true);
  });

  it("hydrate() es idempotente y no requiere base real (mock pg)", async () => {
    // La caché se reseteó; hydrate en modo no-prod devuelve estado vacío sin fallar.
    const result = await SovereignDB.hydrate();
    expect(result).toBeDefined();
    if (!process.env.NODE_ENV || process.env.NODE_ENV === "test") {
      // No-production: no debe intentar consultas a pg
      expect(queryLog.some((q) => q.text.includes("sovereign_state"))).toBe(false);
    }
  });

  it("reutiliza la caché durante la ventana de refresco", async () => {
    const first = await SovereignDB.hydrate({ maxAgeMs: 5_000 });
    const second = await SovereignDB.hydrate({ maxAgeMs: 5_000 });

    expect(second).toBe(first);
    if (!process.env.NODE_ENV || process.env.NODE_ENV === "test") {
      expect(queryLog.some((q) => q.text.includes("sovereign_state"))).toBe(false);
    }
  });

  // ---------------------------------------------------------------------------
  // P0-B fail-closed: en producción NUNCA se sirve memoria vacía ni se acepta
  // una escritura no durable. (Sin DATABASE_URL primero, para que getPgPool no
  // cachee un pool que rompería el resto de los casos.)
  // ---------------------------------------------------------------------------

  it("producción sin DATABASE_URL: hydrate() lanza (fail-closed, nunca memoria vacía)", async () => {
    applyProductionEnv(undefined);
    resetConfigCache();

    await expect(SovereignDB.hydrate()).rejects.toMatchObject({
      code: "SOVEREIGN_STATE_UNAVAILABLE",
    });
  });

  it("producción sin DATABASE_URL: upsertTenant() lanza en vez de escribir en memoria", () => {
    process.env.ISABELLA_RUNTIME_MODE = "production";
    delete process.env.DATABASE_URL;
    resetConfigCache();

    expect(() =>
      SovereignDB.upsertTenant({
        id: "tenant_gsz_no_url",
        name: "Tenant Sin URL",
        region: "Mexico-Hidalgo-01",
        quotaBalance: 0,
        tier: "Free",
      }),
    ).toThrow(DurableStateUnavailableError);
  });

  it("producción con DB caída: hydrate() lanza y NO devuelve emptyDatabase()", async () => {
    applyProductionEnv("postgres://mock/outage");
    failNextSovereignQuery = true;
    resetConfigCache();

    await expect(SovereignDB.hydrate()).rejects.toMatchObject({
      code: "SOVEREIGN_STATE_UNAVAILABLE",
    });
  });

  it("producción sin pool: upsertTenant rechaza la escritura no durable", () => {
    applyProductionEnv("postgres://mock/outage");
    resetConfigCache();

    expect(() =>
      SovereignDB.upsertTenant({
        id: "tenant_gsz_persist_fail",
        name: "Tenant Persist Fail",
        region: "Mexico-Hidalgo-01",
        quotaBalance: 0,
        tier: "Free",
      }),
    ).toThrow(DurableStateUnavailableError);
  });
});
