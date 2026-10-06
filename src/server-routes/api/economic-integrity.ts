import { config } from "@/lib/config";
import { getSigningAlgorithm, isSimulatedAlgorithm } from "@/lib/crypto/bookpi-signer";

export interface EconomicIntegrityReport {
  status: "ok" | "economic_integrity_failure";
  httpStatus: 200 | 503;
  checks: {
    signerAvailable: boolean;
    signatureSimulated: boolean;
    bookpi: { available: boolean; chainValid: boolean };
    projection: { available: boolean; rebuildable: boolean };
  };
}

/**
 * Verificación de integridad económica (autoridad canónica).
 * Fail-closed (§16): escrituras económicas solo si TODO está ok.
 */
export async function checkEconomicIntegrity(
  // BookPI es una cadena por tenant (verifyLedger filtra por tenant_id):
  // sin tenant el caller no puede evaluar integridad económica alguna.
  tenantId = "default-tenant",
): Promise<EconomicIntegrityReport> {
  // Signer disponible (sin exponer secretos).
  let signerAvailable = true;
  let simulated = false;
  try {
    const algorithm = getSigningAlgorithm();
    simulated = isSimulatedAlgorithm(algorithm);
    if (simulated) signerAvailable = false; // simulación ≠ autoridad criptográfica
  } catch {
    signerAvailable = false;
  }

  // Cadena BookPI válida (si la DB canónica está disponible).
  let bookpi: { available: boolean; chainValid: boolean };
  try {
    const { createBookpiPostgresRepository } =
      await import("@/lib/repositories/bookpi-postgres-repository");
    const repo = createBookpiPostgresRepository();
    const integrity = await repo.verifyIntegrity(tenantId);
    bookpi = { available: true, chainValid: integrity.success };
  } catch {
    bookpi = { available: false, chainValid: false };
  }

  // Proyección consistente — solo si economic_events está disponible.
  let projection = { available: false, rebuildable: false };
  try {
    const { Pool } = await import("pg");
    const url = config().DATABASE_URL;
    if (url) {
      const pool = new Pool({ connectionString: url, max: 1 });
      try {
        await pool.query("SELECT 1");
        projection = { available: true, rebuildable: bookpi.chainValid };
      } finally {
        await pool.end();
      }
    }
  } catch {
    projection = { available: false, rebuildable: false };
  }

  const ok = signerAvailable && bookpi.chainValid && projection.available && projection.rebuildable;
  return {
    status: ok ? "ok" : "economic_integrity_failure",
    httpStatus: ok ? 200 : 503,
    checks: {
      signerAvailable,
      signatureSimulated: simulated,
      bookpi: { available: bookpi.available, chainValid: bookpi.chainValid },
      projection: {
        available: projection.available,
        rebuildable: projection.rebuildable,
      },
    },
  };
}
