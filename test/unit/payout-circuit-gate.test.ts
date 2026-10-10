import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isPayoutCircuitCertified, resetConfigCache } from "@/lib/config";

/**
 * P0-C: los movimientos de dinero (payouts) están bloqueados por defecto
 * (fail-closed) hasta certificar los circuitos financieros A–J.
 */
describe("payout circuit gate", () => {
  const originalEnv = process.env.ISABELLA_PAYOUT_CIRCUIT_CERTIFIED;

  beforeEach(() => {
    resetConfigCache();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ISABELLA_PAYOUT_CIRCUIT_CERTIFIED;
    } else {
      process.env.ISABELLA_PAYOUT_CIRCUIT_CERTIFIED = originalEnv;
    }
    resetConfigCache();
  });

  it("no certificado → false (payouts bloqueados)", () => {
    delete process.env.ISABELLA_PAYOUT_CIRCUIT_CERTIFIED;
    expect(isPayoutCircuitCertified()).toBe(false);
  });

  it("explicitamente true → se habilita tras certificación", () => {
    process.env.ISABELLA_PAYOUT_CIRCUIT_CERTIFIED = "true";
    expect(isPayoutCircuitCertified()).toBe(true);
  });

  it("cualquier valor no true no habilita (case-insensitive ignorado)", () => {
    process.env.ISABELLA_PAYOUT_CIRCUIT_CERTIFIED = "TRUE";
    expect(isPayoutCircuitCertified()).toBe(true);
    process.env.ISABELLA_PAYOUT_CIRCUIT_CERTIFIED = "yes";
    expect(isPayoutCircuitCertified()).toBe(false);
  });

  it("fuente inyectada sin contaminar process.env", () => {
    expect(isPayoutCircuitCertified({ ISABELLA_PAYOUT_CIRCUIT_CERTIFIED: "true" })).toBe(true);
    expect(
      isPayoutCircuitCertified({
        ISABELLA_PAYOUT_CIRCUIT_CERTIFIED: undefined,
      }),
    ).toBe(false);
  });
});
