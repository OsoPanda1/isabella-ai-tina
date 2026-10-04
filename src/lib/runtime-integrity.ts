/**
 * Runtime Integrity Engine (src/lib/runtime-integrity.ts)
 * -------------------------------------------------------------
 * Performs pre-flight and in-flight runtime integrity checks:
 * - Engine version verification
 * - Memory bounds checking
 * - Cryptographic self-tests
 * - Integrity posture scoring
 */
import { createHash } from "node:crypto";
import { config } from "./config";

export interface RuntimeIntegrityReport {
  ok: boolean;
  timestamp: string;
  nodeVersion: string;
  memoryUsageMb: number;
  uptimeSeconds: number;
  runtimeMode: string;
  checks: {
    cryptoHealthy: boolean;
    memoryHealthy: boolean;
    nodeEngineCompatible: boolean;
  };
}

function isNode24Compatible(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return false;
  return Number(match[1]) === 24;
}

export function checkRuntimeIntegrity(): RuntimeIntegrityReport {
  const cfg = config();
  const runtimeMode = cfg.ISABELLA_RUNTIME_MODE;
  const memory = process.memoryUsage();
  const memoryUsageMb = Math.round(memory.heapUsed / 1024 / 1024);
  const nodeVersion = process.version;

  // ESM-safe crypto self-test: uses an explicit node:crypto import.
  let cryptoHealthy = false;
  try {
    const testHash = createHash("sha256").update("integrity_probe").digest("hex");
    cryptoHealthy = testHash.length === 64;
  } catch {
    cryptoHealthy = false;
  }

  const memoryHealthy = memoryUsageMb < 1536;
  const nodeEngineCompatible = isNode24Compatible(nodeVersion);

  return {
    ok: cryptoHealthy && memoryHealthy && nodeEngineCompatible,
    timestamp: new Date().toISOString(),
    nodeVersion,
    memoryUsageMb,
    uptimeSeconds: Math.round(process.uptime()),
    runtimeMode,
    checks: {
      cryptoHealthy,
      memoryHealthy,
      nodeEngineCompatible,
    },
  };
}

export default { checkRuntimeIntegrity };