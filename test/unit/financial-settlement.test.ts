import { describe, it, expect } from "vitest";

/**
 * SETTLEMENT SAGA (test/unit/financial-settlement.test.ts)
 * -----------------------------------------------------------------
 * Orden estricto, aborto con compensación, reentrancia idempotente.
 * Pasos inyectados deterministas (la persistencia real se prueba en
 * financial-evidence con PG).
 */

import { settlePayment, type SettlementSteps } from "@/lib/financial-settlement";

function baseInput() {
  return {
    provider: "stripe",
    providerEventId: "evt_saga_1",
    eventType: "charge.succeeded",
    tenantId: "tenant_saga",
    actorId: "user_saga",
    amountMinor: 2900,
    idempotencyKey: "saga_1",
    operation: "SUBSCRIPTION",
    category: "other" as const,
    cost: 0,
    tokens: 0,
  };
}

function workingSteps(overrides: Partial<SettlementSteps> = {}): SettlementSteps {
  const calls: string[] = [];
  return {
    claim: async () => {
      calls.push("claim");
      return { status: "processed" };
    },
    record: async () => {
      calls.push("record");
      return { ok: true };
    },
    appendLedger: async () => {
      calls.push("ledger");
      return { success: true, block: { index: 7 } };
    },
    appendAccounting: async () => {
      calls.push("accounting");
      return { success: true };
    },
    compensate: async () => {
      calls.push("compensate");
      return null;
    },
    audit: async () => null,
    ...overrides,
  };
}

describe("saga de liquidación", () => {
  it("camino feliz liquida los 4 pasos con recibo", async () => {
    const receipt = await settlePayment(baseInput(), workingSteps());
    expect(receipt.status).toBe("settled");
    expect(receipt.steps).toEqual(["claim", "record", "ledger", "accounting"]);
    expect(receipt.blockIndex).toBe(7);
  });

  it("claim duplicado retorna sin escribir", async () => {
    const receipt = await settlePayment(
      baseInput(),
      workingSteps({
        claim: async () => ({ status: "duplicate" }),
        record: async () => {
          throw new Error("no debe llamarse");
        },
      }),
    );
    expect(receipt.status).toBe("duplicate");
    expect(receipt.steps).toEqual(["claim:duplicate"]);
  });

  it("fallo de ledger compensa con reversa y aborta", async () => {
    const events: string[] = [];
    const receipt = await settlePayment(
      baseInput(),
      workingSteps({
        appendLedger: async () => ({ success: false, error: "DB caída" }),
        compensate: async () => {
          events.push("compensated");
          return null;
        },
      }),
    );
    expect(receipt.status).toBe("aborted");
    expect(receipt.steps).toEqual(["claim", "record"]);
    expect(receipt.compensations).toEqual(["reversal-recorded"]);
    expect(events).toEqual(["compensated"]);
  });

  it("accounting no bloquea: difiere con auditoría", async () => {
    const receipt = await settlePayment(
      baseInput(),
      workingSteps({
        appendAccounting: async () => ({
          success: false,
          error: "sin adaptador",
        }),
      }),
    );
    expect(receipt.status).toBe("settled");
    expect(receipt.compensations).toEqual(["accounting-deferred"]);
  });

  it("fallo de claim aborta antes de cualquier escritura", async () => {
    const receipt = await settlePayment(
      baseInput(),
      workingSteps({
        claim: async () => ({ status: "error" }),
        record: async () => {
          throw new Error("no debe llamarse");
        },
      }),
    );
    expect(receipt.status).toBe("aborted");
    expect(receipt.steps).toEqual([]);
  });
});
