import { describe, it, expect, beforeAll, vi } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";

/**
 * EVIDENCIA FINANCIERA (test/bookpi/financial-evidence.test.ts)
 * -----------------------------------------------------------------
 * Stripe webhook → idempotency → transaction → BookPI → balance →
 * reconciliación → audit, con pruebas de concurrencia.
 *
 * - Firma Stripe: verificación REAL (constructEvent, sin red).
 * - Concurrencia/idempotencia/reconciliación: PostgreSQL real, suite
 *   omitida si no hay TEST_DATABASE_URL ni DATABASE_URL (evidencia
 *   explícita, no simulada). Requiere migraciones aplicadas.
 */

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(DB_URL);

beforeAll(async () => {
  if (!HAS_DB) return;
  vi.stubEnv("DATABASE_URL", DB_URL as string);
  vi.stubEnv("ISABELLA_RUNTIME_MODE", "development");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vi.stubEnv("BOOKPI_SIGNATURE_ALGORITHM", "RSA-SHA256");
  vi.stubEnv("BOOKPI_SIGNING_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const { resetConfigCache } = await import("@/lib/config");
  resetConfigCache();
});

describe("Stripe webhook signature verification (real, sin red)", () => {
  it("acepta evento firmado y rechaza payload manipulado", { timeout: 30000 }, async () => {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe("sk_test_evidence", {
      apiVersion: "2022-11-15" as never,
    });
    const secret = "whsec_evidence_secret";
    const payload = JSON.stringify({
      id: "evt_evidence_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", metadata: { planId: "pro" } } },
    });
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    const event = stripe.webhooks.constructEvent(payload, header, secret);
    expect(event.id).toBe("evt_evidence_1");
    expect(event.type).toBe("checkout.session.completed");

    expect(() => stripe.webhooks.constructEvent(`${payload} `, header, secret)).toThrow();
  });
});

describe.skipIf(!HAS_DB)("idempotencia concurrente (PostgreSQL real)", () => {
  it("10 entregas simultáneas del mismo webhook → 1 processed + 9 duplicate", async () => {
    const { claimWebhookEvent } = await import("@/lib/economic-events");
    const eventId = `evt_conc_${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        claimWebhookEvent({
          provider: "stripe",
          providerEventId: eventId,
          eventType: "charge.succeeded",
        }),
      ),
    );
    const processed = results.filter((result) => result.status === "claimed");
    const duplicates = results.filter((result) => result.status === "duplicate");
    expect(processed).toHaveLength(1);
    expect(duplicates).toHaveLength(9);
  });

  it("eventos económicos concurrentes con misma idempotency_key → 1 ok", async () => {
    const { recordEconomicEvent } = await import("@/lib/economic-events");
    const tenant = `tenant_conc_${randomUUID().slice(0, 8)}`;
    const key = `idem_${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        recordEconomicEvent({
          tenantId: tenant,
          actorId: "u1",
          eventType: "QUOTA_TOPUP",
          amountMinor: 1000,
          direction: "CREDIT",
          source: "stripe",
          provider: "stripe",
          providerEventId: `pi_${randomUUID()}`,
          idempotencyKey: key,
        }),
      ),
    );
    const ok = results.filter((result) => result.ok);
    const duplicate = results.filter((result) => result.duplicate);
    expect(ok).toHaveLength(1);
    expect(duplicate).toHaveLength(7);
  });

  it("reconciliación: CREDIT − DEBIT = balance proyectado", async () => {
    const { recordEconomicEvent, sumEconomicBalance } = await import("@/lib/economic-events");
    const tenant = `tenant_rec_${randomUUID().slice(0, 8)}`;
    const first = await recordEconomicEvent({
      tenantId: tenant,
      actorId: "u1",
      eventType: "QUOTA_TOPUP",
      amountMinor: 10000,
      direction: "CREDIT",
      idempotencyKey: `k1_${randomUUID()}`,
    });
    const second = await recordEconomicEvent({
      tenantId: tenant,
      actorId: "u1",
      eventType: "QUANTUM_CHARGE",
      amountMinor: 2500,
      direction: "DEBIT",
      idempotencyKey: `k2_${randomUUID()}`,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await sumEconomicBalance(tenant)).toBe(7500n);
  });
});

describe.skipIf(!HAS_DB)("BookPI concurrente + refund único (PostgreSQL real)", () => {
  it("appends concurrentes → índices contiguos y cadena válida", async () => {
    const { createBookpiPostgresRepository } =
      await import("@/lib/repositories/bookpi-postgres-repository");
    const repo = createBookpiPostgresRepository();
    const tenant = `tenant_ledger_${randomUUID().slice(0, 8)}`;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        repo.append({
          tenantId: tenant,
          userId: "u1",
          operation: `CONCURRENT_OP_${index}`,
          category: "processing",
          cost: 1.5,
          tokens: 10,
        }),
      ),
    );
    expect(results.every((result) => result.success)).toBe(true);
    const blocks = await repo.list(tenant);
    expect(blocks).toHaveLength(6);
    const indexes = blocks.map((block) => block.index).sort((a, b) => a - b);
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5]);
    const integrity = await repo.verifyIntegrity(tenant);
    expect(integrity.success).toBe(true);
  });

  it("doble refund simultáneo → 1 éxito + original intacto", async () => {
    const { createBookpiPostgresRepository } =
      await import("@/lib/repositories/bookpi-postgres-repository");
    const repo = createBookpiPostgresRepository();
    const tenant = `tenant_refund_${randomUUID().slice(0, 8)}`;
    const appended = await repo.append({
      tenantId: tenant,
      userId: "u1",
      operation: "CHARGE_ME",
      category: "processing",
      cost: 5,
      tokens: 10,
    });
    expect(appended.success).toBe(true);

    const results = await Promise.all([
      repo.refund("0", { tenantId: tenant, userId: "u1" }, "test"),
      repo.refund("0", { tenantId: tenant, userId: "u1" }, "test"),
    ]);
    const succeeded = results.filter((result) => result.success);
    expect(succeeded).toHaveLength(1);

    const blocks = await repo.list(tenant);
    const original = blocks.find((block) => block.index === 0);
    expect(original?.costDecimal).toBe("5.00");
    const integrity = await repo.verifyIntegrity(tenant);
    expect(integrity.success).toBe(true);
  });
});
