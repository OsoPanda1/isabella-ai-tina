/**
 * Isabella Quantum Mesh — ARGUS Quantum Policy Engine (Núcleo 03)
 * Evalúa cada request contra la política gobernada antes de ejecución.
 * Ningún agente puede elevar scopes. Ningún provider remoto opera sin credenciales.
 */
import type { Principal, PolicyDecision, QuantumRequest, DeviceCapability } from "./contracts";

const ROLE_LIMITS = {
  user: { wires: 12, shots: 10_000, maxTimeoutMs: 15_000 },
  agent: { wires: 16, shots: 20_000, maxTimeoutMs: 30_000 },
  operator: { wires: 24, shots: 100_000, maxTimeoutMs: 60_000 },
  service: { wires: 24, shots: 100_000, maxTimeoutMs: 60_000 },
} as const;

const POLICY_VERSION = "quantum-policy-v1";

interface PolicyAuditEntry {
  traceId: string;
  decision: PolicyDecision;
  reason: string;
  timestamp: string;
}

const policyAuditLog: PolicyAuditEntry[] = [];

function deny(reason: string): PolicyDecision {
  return {
    decision: "deny",
    reason,
    maxTimeoutMs: 5_000,
    maxWires: 0,
    maxShots: 0,
    requiresApproval: false,
  };
}

function degrade(reason: string): PolicyDecision {
  return {
    decision: "degraded",
    reason,
    maxTimeoutMs: 5_000,
    maxWires: 0,
    maxShots: 0,
    requiresApproval: false,
  };
}

function allow(role: keyof typeof ROLE_LIMITS, remote: boolean): PolicyDecision {
  const limits = ROLE_LIMITS[role];
  const requiresApproval = remote || role === "user";
  return {
    decision: "allow",
    reason: "POLICY_ALLOWED",
    maxTimeoutMs: remote ? 60_000 : limits.maxTimeoutMs,
    maxWires: limits.wires,
    maxShots: limits.shots,
    requiresApproval,
  };
}

/**
 * Evalúa un request cuántico contra la política ARGUS.
 * Reglas de los núcleos:
 * - Ningún núcleo puede cambiar sus propios scopes.
 * - Ningún núcleo puede firmar su propia decisión de autorización.
 * - Los núcleos de ejecución no pueden escribir política.
 */
export function evaluateQuantumPolicy(
  principal: Principal,
  request: QuantumRequest,
  capability: DeviceCapability,
): PolicyDecision {
  // Rule 1: Tenant isolation — tenant mismatch = auto deny
  if (principal.tenantId !== request.tenantId) {
    return deny("TENANT_MISMATCH");
  }

  // Rule 2: Required scope
  if (!principal.scopes.includes("quantum:execute") && !principal.scopes.includes("*")) {
    return deny("MISSING_QUANTUM_EXECUTE");
  }

  // Rule 3: Device must be enabled
  if (!capability.enabled) {
    return degrade("DEVICE_DISABLED");
  }

  // Rule 4: Missing provider-specific scopes
  const missing = capability.requiredScopes.filter(
    (scope) => !principal.scopes.includes(scope) && !principal.scopes.includes("*"),
  );
  if (missing.length > 0) {
    return deny(`MISSING_SCOPES:${missing.join(",")}`);
  }

  // Rule 5: Role-based wire limits
  const roleLimit = ROLE_LIMITS[principal.role];
  if (request.wires > roleLimit.wires) {
    return deny("ROLE_WIRE_LIMIT");
  }

  // Rule 6: Role-based shot limits
  if (request.shots !== null && request.shots > roleLimit.shots) {
    return deny("ROLE_SHOT_LIMIT");
  }

  // Rule 7: Mode compatibility
  if (request.mode === "analytic" && !capability.supportsAnalytic) {
    return degrade("DEVICE_NO_ANALYTIC");
  }
  if (request.mode === "sampled" && request.shots !== null && !capability.supportsShots) {
    return degrade("DEVICE_NO_SHOTS");
  }

  // Rule 8: Remote providers need WebAuthn step-up
  const requiresApproval = capability.remote || capability.trust === "qpu";
  if (requiresApproval && !principal.webauthnVerified) {
    return deny("WEBAUTHN_STEP_UP_REQUIRED");
  }

  // Rule 9: High risk needs WebAuthn
  if (principal.riskLevel === "high" && !principal.webauthnVerified) {
    return deny("HIGH_RISK_WEBAUTHN_REQUIRED");
  }

  // Rule 10: Secret validation for remote
  if (capability.remote) {
    for (const secret of capability.requiredSecrets) {
      if (!process.env[secret]) {
        return degrade(`REMOTE_SECRET_MISSING:${secret}`);
      }
    }
  }

  // Allow
  return allow(principal.role, capability.remote);
}

/**
 * Registra una decisión de política para auditoría.
 */
export function recordPolicyDecision(
  traceId: string,
  decision: PolicyDecision,
  reason?: string,
): void {
  policyAuditLog.push({
    traceId,
    decision,
    reason: reason || decision.reason,
    timestamp: new Date().toISOString(),
  });

  // Mantener solo los últimos 1000 registros en memoria
  if (policyAuditLog.length > 1000) {
    policyAuditLog.splice(0, policyAuditLog.length - 1000);
  }
}

/**
 * Obtiene las últimas decisiones de política.
 */
export function getPolicyAuditLog(limit: number = 50): PolicyAuditEntry[] {
  return policyAuditLog.slice(-limit);
}

/**
 * Obtiene métricas de política.
 */
export function getPolicyMetrics() {
  const recent = policyAuditLog.slice(-200);
  const allows = recent.filter((e) => e.decision.decision === "allow").length;
  const denials = recent.filter((e) => e.decision.decision === "deny").length;
  const degraded = recent.filter((e) => e.decision.decision === "degraded").length;

  return {
    version: POLICY_VERSION,
    totalDecisions: policyAuditLog.length,
    recentAllows: allows,
    recentDenials: denials,
    recentDegraded: degraded,
    denialRate: recent.length > 0 ? denials / recent.length : 0,
  };
}
