import { describe, it, expect, vi } from "vitest";

/**
 * PAYOUT EXECUTOR (test/unit/payout-executor.test.ts)
 * -----------------------------------------------------------------
 * Validación, idempotencia propagada y fail-closed sin clave.
 * Cliente Stripe falso inyectado (lógica, no red).
 */

import { executePayout } from "@/lib/monetization/payout-executor";

function fakeStripe() {
  const calls: Array<{
    params: Record<string, unknown>;
    opts?: { idempotencyKey?: string };
  }> = [];
  return {
    calls,
    client: {
      transfers: {
        create: async (params: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
          calls.push({ params, opts });
          return {
            id: "tr_test_123",
            amount: params.amount as number,
            destination: params.destination,
          };
        },
      },
    },
  };
}

describe("payout executor", () => {
  it("ejecuta con idempotency key propagada a Stripe", async () => {
    const fake = fakeStripe();
    const result = await executePayout(
      {
        amountCents: 5000,
        destinationAccountId: "acct_123ABC",
        idempotencyKey: "idem_payout_1",
        metadata: { tenant: "t1" },
      },
      fake.client,
    );
    expect(result.payoutId).toBe("tr_test_123");
    expect(result.amountCents).toBe(5000);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].opts?.idempotencyKey).toBe("idem_payout_1");
    expect(fake.calls[0].params.currency).toBe("usd");
  });

  it("rechaza montos inválidos, destinos y topes", async () => {
    const fake = fakeStripe();
    const base = {
      destinationAccountId: "acct_123",
      idempotencyKey: "idem_12345678",
    };
    await expect(executePayout({ ...base, amountCents: 0 }, fake.client)).rejects.toThrow(
      /inválido/i,
    );
    await expect(executePayout({ ...base, amountCents: -5 }, fake.client)).rejects.toThrow();
    await expect(executePayout({ ...base, amountCents: 1_000_001 }, fake.client)).rejects.toThrow(
      /tope/i,
    );
    await expect(
      executePayout(
        {
          amountCents: 100,
          destinationAccountId: "nope",
          idempotencyKey: "idem_12345678",
        },
        fake.client,
      ),
    ).rejects.toThrow(/destino/i);
    await expect(
      executePayout(
        {
          amountCents: 100,
          destinationAccountId: "acct_1",
          idempotencyKey: "x",
        },
        fake.client,
      ),
    ).rejects.toThrow(/IdempotencyKey/i);
    expect(fake.calls).toHaveLength(0);
  });

  it("sin clave Stripe falla cerrado (no inventa payout)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    await expect(
      executePayout({
        amountCents: 100,
        destinationAccountId: "acct_1",
        idempotencyKey: "idem_12345678",
      }),
    ).rejects.toThrow(/STRIPE_SECRET_KEY/);
    vi.unstubAllEnvs();
    resetConfigCache();
  });
});
