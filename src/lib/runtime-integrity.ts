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

/** Minimum Node major declared by .nvmrc (24.11.0) / engines ("24.x"). */
const MIN_NODE_MAJOR = 24;

function isNodeEngineCompatible(version: string): boolean {
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "", 10);
  return Number.isInteger(major) && major >= MIN_NODE_MAJOR;
}

export function checkRuntimeIntegrity(): RuntimeIntegrityReport {
  const cfg = config();
  const runtimeMode = cfg.ISABELLA_RUNTIME_MODE;
  const memory = process.memoryUsage();
  const memoryUsageMb = Math.round(memory.heapUsed / 1024 / 1024);
  const nodeVersion = process.version;

  // ESM-safe crypto self-test: createHash comes from the static node:crypto
  // import above, so the probe still runs when this module is loaded as ESM
  // (a runtime `require()` would throw there and falsely report cryptoHealthy=false).
  let cryptoHealthy: boolean;
  try {
    const testHash = createHash("sha256").update("integrity_probe").digest("hex");
    cryptoHealthy = testHash.length === 64;
  } catch {
    cryptoHealthy = false;
  }

  const memoryHealthy = memoryUsageMb < 1536; // Under 1.5 GB limit
  // Minimum engine declared by this repo, not an optimistic constant:
  // package.json engines.node = "24.x", .nvmrc = 24.11.0,
  // .github/workflows NODE_VERSION = "24.11.0".
  // Compared as a major floor, so Node 25+ stays compatible (no exact-24 block).
  const nodeEngineCompatible = isNodeEngineCompatible(nodeVersion);

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
