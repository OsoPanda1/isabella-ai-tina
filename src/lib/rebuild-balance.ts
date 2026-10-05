/**
 * REBUILD BALANCE (src/lib/rebuild-balance.ts)
 * -----------------------------------------------------------------
 * §10/§59.- el balance es una PROYECCIÓN, nunca autoridad contable.
 * El saldo debe reconstruirse desde los eventos económicos y verificarse
 * contra la proyección operativa (tenant.quotaBalance).
 *
 * Flujo: EconomicEvents → ledger → projection → balance.
 * Si `proyección != saldo calculado` → ECONOMIC_INTEGRITY_FAILURE.
 */
import { sovereignStateRepository } from "./sovereign-state-repository";
import { sumEconomicBalance } from "./economic-events";

export interface BalanceVerificationResult {
  tenantId: string;
  projectionDollars: number;
  calculatedDollars: number;
  deviationMinor: bigint;
  match: boolean;
  /**
   * Cuando `economic_events` no está disponible (tabla ausente o sin eventos),
   * `available: false` indica que la verificación no pudo ejecutarse, nunca
   * que el balance es correcto (fail-closed).
   */
  available: boolean;
}

export async function rebuildBalance(tenantId: string): Promise<BalanceVerificationResult> {
  const tenant = await sovereignStateRepository.getTenant(tenantId);
  const projectionDollars = tenant?.quotaBalance ?? 0;

  let calculatedMinor: bigint;
  let available = true;
  try {
    calculatedMinor = await sumEconomicBalance(tenantId);
  } catch {
    available = false;
    calculatedMinor = 0n;
  }

  const calculatedDollars = Number(calculatedMinor) / 100;
  const projectionMinor = BigInt(Math.round(projectionDollars * 100));
  const deviationMinor = projectionMinor - calculatedMinor;

  return {
    tenantId,
    projectionDollars,
    calculatedDollars,
    deviationMinor,
    match: available && deviationMinor === 0n,
    available,
  };
}

export const ECONOMIC_INTEGRITY_FAILURE = "ECONOMIC_INTEGRITY_FAILURE";
