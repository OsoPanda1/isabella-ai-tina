/**
 * Isabella Quantum Mesh — HSM Client (Núcleo 16)
 * Firma de decisiones policy comprometidas, bloques BookPI, manifest de worker,
 * digest de artefactos Catalyst, eventos de replicación federada.
 * PROTOTYPE: Simulación con dual YubiHSM + failover.
 *
 * SEGURIDAD: Requiere FEATURE_LAB_MODE=true en producción.
 * Sin esta flag, signHSM lanza PROTOTYPE_NOT_AVAILABLE.
 */
import { createHash, randomUUID } from "node:crypto";
import { requireLabMode } from "../lab-mode";

export interface HSMOperation {
  operationId: string;
  type:
    | "sign_policy"
    | "sign_bookpi"
    | "sign_worker_manifest"
    | "sign_artifact"
    | "sign_federation"
    | "unwrap";
  payloadHash: string;
  signatureHex: string;
  keyId: string;
  algorithm: string;
  latencyMs: number;
  timestamp: string;
  status: "success" | "error" | "fallback";
}

interface HSMConfig {
  primaryEndpoint: string;
  backupEndpoint: string;
  timeoutMs: number;
  circuitBreakerThreshold: number;
}

const config: HSMConfig = {
  primaryEndpoint: process.env.HSM_PRIMARY_ENDPOINT || "yubihsm-simulator-primary",
  backupEndpoint: process.env.HSM_BACKUP_ENDPOINT || "yubihsm-simulator-backup",
  timeoutMs: Number(process.env.HSM_TIMEOUT_MS || 5_000),
  circuitBreakerThreshold: Number(process.env.HSM_CB_THRESHOLD || 5),
};

let primaryFailures = 0;
let backupFailures = 0;
let usePrimary = true;

const operationLog: HSMOperation[] = [];
const MAX_LOG = 2_000;

function simulateHSMOperation(type: string, payloadHash: string): string {
  const signature = createHash("sha256")
    .update(`hsm-${type}-${payloadHash}-${Date.now()}`)
    .digest("hex");
  return `hsm_sig_${signature}`;
}

/**
 * Firma una operación criptográfica via HSM.
 * Si el primario falla, usa backup. Si ambos fallan, marca fallback.
 */
export async function signHSM(params: {
  type: HSMOperation["type"];
  payload: string;
  keyId?: string;
}): Promise<HSMOperation> {
  requireLabMode("HSM-SIMULATOR");
  const startedAt = Date.now();
  const payloadHash = createHash("sha256").update(params.payload).digest("hex");
  const keyId = params.keyId || `hsm-${params.type}-v1`;

  let signatureHex: string;
  let status: HSMOperation["status"];

  try {
    if (usePrimary && primaryFailures < config.circuitBreakerThreshold) {
      signatureHex = simulateHSMOperation(params.type, payloadHash);
      primaryFailures = 0;
      status = "success";
    } else if (backupFailures < config.circuitBreakerThreshold) {
      signatureHex = simulateHSMOperation(params.type, payloadHash);
      backupFailures = 0;
      status = "success";
    } else {
      throw new Error("HSM_UNAVAILABLE");
    }
  } catch {
    primaryFailures++;
    if (primaryFailures >= config.circuitBreakerThreshold) {
      usePrimary = false;
    }
    signatureHex = simulateHSMOperation(params.type, payloadHash); // fallback
    status = "fallback";
  }

  const operation: HSMOperation = {
    operationId: randomUUID(),
    type: params.type,
    payloadHash,
    signatureHex,
    keyId,
    algorithm: "HSM-ECDSA-P384",
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
    status,
  };

  operationLog.push(operation);
  if (operationLog.length > MAX_LOG) {
    operationLog.splice(0, operationLog.length - MAX_LOG);
  }

  return operation;
}

/**
 * Estado del HSM (primario y backup).
 */
export function getHSMStatus() {
  return {
    primary: {
      endpoint: config.primaryEndpoint,
      failures: primaryFailures,
      healthy: primaryFailures < config.circuitBreakerThreshold,
      circuitOpen: primaryFailures >= config.circuitBreakerThreshold,
    },
    backup: {
      endpoint: config.backupEndpoint,
      failures: backupFailures,
      healthy: backupFailures < config.circuitBreakerThreshold,
      circuitOpen: backupFailures >= config.circuitBreakerThreshold,
    },
    activeEndpoint: usePrimary ? "primary" : "backup",
    totalOperations: operationLog.length,
    recentOperations: operationLog.slice(-20),
  };
}

/**
 * Resetea los circuitos del HSM.
 */
export function resetHSMCircuits(): void {
  primaryFailures = 0;
  backupFailures = 0;
  usePrimary = true;
}

/**
 * Métricas HSM.
 */
export function getHSMMetrics() {
  const recent = operationLog.slice(-200);
  return {
    total: operationLog.length,
    success: recent.filter((o) => o.status === "success").length,
    fallback: recent.filter((o) => o.status === "fallback").length,
    error: recent.filter((o) => o.status === "error").length,
    avgLatencyMs:
      recent.length > 0
        ? Math.round(recent.reduce((s, o) => s + o.latencyMs, 0) / recent.length)
        : 0,
    primaryFailures,
    backupFailures,
  };
}
