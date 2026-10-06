import { describe, expect, it } from "vitest";
import { validateQuotaTopupMetadata } from "@/lib/economic-events";
import { createRedactor } from "@/lib/secret-redactor";

describe("billing security invariants", () => {
  it("requires tenant, user, purpose, USD and exact amount for Stripe topups", () => {
    const base = {
      status: "succeeded",
      currency: "usd",
      amount: 2500,
      metadata: { purpose: "quota_topup", tenantId: "tenant-a", userId: "user-a" },
    };
    expect(validateQuotaTopupMetadata(base, "tenant-a", "user-a", 2500)).toEqual({ ok: true });
    expect(validateQuotaTopupMetadata(base, "tenant-b", "user-a", 2500).ok).toBe(false);
    expect(validateQuotaTopupMetadata(base, "tenant-a", "user-b", 2500).ok).toBe(false);
    expect(
      validateQuotaTopupMetadata({ ...base, currency: "mxn" }, "tenant-a", "user-a", 2500).ok,
    ).toBe(false);
    expect(
      validateQuotaTopupMetadata({ ...base, amount: 2501 }, "tenant-a", "user-a", 2500).ok,
    ).toBe(false);
    expect(
      validateQuotaTopupMetadata(
        { ...base, metadata: { ...base.metadata, purpose: "subscription" } },
        "tenant-a",
        "user-a",
        2500,
      ).ok,
    ).toBe(false);
  });

  it("redacts all configured provider secret keys", () => {
    const redactor = createRedactor([
      "sk_test_STRIPE_SECRET_123456789",
      "groq-secret-123456789",
      "mux-secret-123456789",
    ]);
    const output = redactor.redactObject({
      STRIPE_SECRET_KEY: "sk_test_STRIPE_SECRET_123456789",
      GROQ_API_KEY: "groq-secret-123456789",
      nested: { MUX_TOKEN_SECRET: "mux-secret-123456789" },
    }) as Record<string, unknown>;
    expect(output.STRIPE_SECRET_KEY).toBe("[REDACTED]");
    expect(output.GROQ_API_KEY).toBe("[REDACTED]");
    expect((output.nested as Record<string, unknown>).MUX_TOKEN_SECRET).toBe("[REDACTED]");
  });
});
