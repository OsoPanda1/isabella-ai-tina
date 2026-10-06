import { beforeEach, describe, expect, it } from "vitest";
import { config, loadConfig, resetConfigCache } from "@/lib/config";

describe("configuration runtime contract", () => {
  beforeEach(() => resetConfigCache());

  it("keeps the canonical configuration accessor callable", () => {
    expect(typeof config).toBe("function");
  });

  it("derives postgres as the durable provider when DATABASE_URL is present", () => {
    const parsed = loadConfig({
      NODE_ENV: "development",
      ISABELLA_RUNTIME_MODE: "development",
      DATABASE_URL: "postgresql://example.invalid/db",
    });
    expect(parsed.ISABELLA_STORAGE_PROVIDER).toBe("postgres");
  });

  it("allows production configuration to derive postgres from the canonical DATABASE_URL", () => {
    const parsed = loadConfig({
      NODE_ENV: "production",
      ISABELLA_RUNTIME_MODE: "production",
      PUBLIC_URL: "https://example.invalid",
      DATABASE_URL: "postgresql://example.invalid/db",
      AUTH_JWT_SECRET: "1234567890123456",
      ENCRYPTION_MASTER_KEY: "12345678901234567890123456789012",
      CROWN_POLICY_SIGNING_KEY: "12345678901234567890123456789012",
      AEGIS_AUDIT_SECRET: "12345678901234567890123456789012",
      BOOKPI_SIGNING_KEY: "12345678901234567890123456789012",
      BOOKPI_SIGNATURE_ALGORITHM: "ECDSA-P384",
      GEMINI_API_KEY: "gemini-key-123456789",
      PROVISION_OWNER_TOKEN: "owner-token-123456789",
      STRIPE_SECRET_KEY: "stripe-secret-123456",
      STRIPE_WEBHOOK_SECRET: "stripe-webhook-123456",
      X402_PAYMENT_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
      FEDERATION_SIGNING_KEYS_JSON: '{"federation-test-key":"0123456789abcdef0123456789abcdef"}',
    });
    expect(parsed.ISABELLA_STORAGE_PROVIDER).toBe("postgres");
    expect(parsed.DATABASE_URL).toBe("postgresql://example.invalid/db");
  });
});
