import { describe, expect, it, beforeEach } from "vitest";
import { envSchema } from "@/lib/env-schema";
import { canUseGuestChat, isExplicitDevelopmentAuth } from "@/lib/principal-context";
import { loadConfig, resetConfigCache } from "@/lib/config";

describe("configuration hardening", () => {
  beforeEach(() => {
    resetConfigCache();
  });

  it("rejects malformed runtime modes instead of normalizing them", () => {
    const result = envSchema.safeParse({ ISABELLA_RUNTIME_MODE: "== development" });
    expect(result.success).toBe(false);
  });

  it("treats empty runtime mode values as unset and applies the default", () => {
    expect(envSchema.safeParse({ ISABELLA_RUNTIME_MODE: "" }).data?.ISABELLA_RUNTIME_MODE).toBe(
      "development",
    );
    expect(envSchema.safeParse({ ISABELLA_RUNTIME_MODE: "   " }).data?.ISABELLA_RUNTIME_MODE).toBe(
      "development",
    );
  });

  it("defaults development authentication and guest chat to disabled", () => {
    const parsed = loadConfig({ NODE_ENV: "development", ISABELLA_RUNTIME_MODE: "development" });
    expect(parsed.AUTH_DEV_SESSION_ENABLED).toBe(false);
    expect(parsed.ALLOW_GUEST_CHAT).toBe(false);
  });

  it("does not use Supabase service-role credentials as an auth JWT secret", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        ISABELLA_RUNTIME_MODE: "production",
        PUBLIC_URL: "https://example.invalid",
        ISABELLA_STORAGE_PROVIDER: "postgres",
        DATABASE_URL: "postgresql://example.invalid/db",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
        ENCRYPTION_MASTER_KEY: "12345678901234567890123456789012",
        CROWN_POLICY_SIGNING_KEY: "12345678901234567890123456789012",
        AEGIS_AUDIT_SECRET: "12345678901234567890123456789012",
        BOOKPI_SIGNING_KEY: "12345678901234567890123456789012",
        GEMINI_API_KEY: "gemini-key-123456789",
        PROVISION_OWNER_TOKEN: "owner-token-123456789",
        STRIPE_SECRET_KEY: "stripe-secret-123456",
        STRIPE_WEBHOOK_SECRET: "stripe-webhook-123456",
      }),
    ).toThrow(/AUTH_JWT_SECRET/);
  });

  it("rejects conflicting provider-specific database aliases", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        ISABELLA_RUNTIME_MODE: "production",
        PUBLIC_URL: "https://example.invalid",
        ISABELLA_STORAGE_PROVIDER: "neon",
        DATABASE_URL: "postgresql://canonical.invalid/db",
        NEON_DATABASE_POSTGRES_URL: "postgresql://different.invalid/db",
        AUTH_JWT_SECRET: "1234567890123456",
        ENCRYPTION_MASTER_KEY: "12345678901234567890123456789012",
        CROWN_POLICY_SIGNING_KEY: "12345678901234567890123456789012",
        AEGIS_AUDIT_SECRET: "12345678901234567890123456789012",
        BOOKPI_SIGNING_KEY: "12345678901234567890123456789012",
        GEMINI_API_KEY: "gemini-key-123456789",
        PROVISION_OWNER_TOKEN: "owner-token-123456789",
        STRIPE_SECRET_KEY: "stripe-secret-123456",
        STRIPE_WEBHOOK_SECRET: "stripe-webhook-123456",
        X402_PAYMENT_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
        FEDERATION_SIGNING_KEYS_JSON:
          '{"federation-test-key":"0123456789abcdef0123456789abcdef"}',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("requires explicit and authoritative development guest configuration", () => {
    expect(
      canUseGuestChat({
        ALLOW_GUEST_CHAT: true,
        NODE_ENV: "development",
        ISABELLA_RUNTIME_MODE: "production",
      }),
    ).toBe(false);
    expect(
      canUseGuestChat({
        ALLOW_GUEST_CHAT: true,
        NODE_ENV: "production",
        ISABELLA_RUNTIME_MODE: "development",
      }),
    ).toBe(false);
    expect(
      canUseGuestChat({
        ALLOW_GUEST_CHAT: true,
        NODE_ENV: "development",
        ISABELLA_RUNTIME_MODE: "development",
      }),
    ).toBe(true);
  });

  it("requires all three development-auth conditions", () => {
    expect(
      isExplicitDevelopmentAuth({
        NODE_ENV: "development",
        ISABELLA_RUNTIME_MODE: "development",
        AUTH_DEV_SESSION_ENABLED: true,
      }),
    ).toBe(true);
    expect(
      isExplicitDevelopmentAuth({
        NODE_ENV: "development",
        ISABELLA_RUNTIME_MODE: "production",
        AUTH_DEV_SESSION_ENABLED: true,
      }),
    ).toBe(false);
  });

  it("fails closed when staging has no explicit storage provider", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        ISABELLA_RUNTIME_MODE: "staging",
        PUBLIC_URL: "https://example.invalid",
      }),
    ).toThrow();
  });
});
