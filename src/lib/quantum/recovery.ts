/**
 * Isabella Quantum Mesh — Recovery & Emergency Plans (Núcleo 24 + Incidentes)
 * Planes tipificados para cada tipo de incidente.
 * El núcleo 24 puede activar aislamiento y degradación, pero NO borrar auditoría.
 */
import { randomUUID } from "node:crypto";
import type { RecoveryIncident } from "./contracts";

const incidents: RecoveryIncident[] = [];

function createIncident(
  type: RecoveryIncident["type"],
  severity: RecoveryIncident["severity"],
  component: string,
  description: string,
  actions: string[],
): RecoveryIncident {
  const incident: RecoveryIncident = {
    incidentId: randomUUID(),
    type,
    severity,
    affectedComponent: component,
    description,
    actionsTaken: actions,
    createdAt: new Date().toISOString(),
  };
  incidents.push(incident);
  return incident;
}

// ============================================================================
// INCIDENT RESPONSE PROCEDURES
// ============================================================================

/**
 * Incidente A: PennyLane ausente
 * Marcar provider unavailable → Responder degraded → No usar etiqueta PennyLane
 */
export function handlePennyLaneAbsent(provider: string): RecoveryIncident {
  return createIncident(
    "pennylane_absent",
    "medium",
    `quantum-worker-${provider}`,
    `PennyLane provider ${provider} is not available. Falling back to degraded mode.`,
    [
      "Mark provider as unavailable in Device Registry",
      "Respond with degraded status (never label fallback as PennyLane)",
      "Emit quantum.provider.unavailable event",
      "Avoid automatic plugin deployment",
      "Keep worker core available for local simulation",
      "Log incident for reconciliation",
    ],
  );
}

/**
 * Incidente B: Worker colgado
 * Cancelar por timeout → Matar proceso → Marcar retryable → Abrir circuit breaker
 */
export function handleWorkerHung(workerId: string, pool: string): RecoveryIncident {
  return createIncident(
    "worker_hung",
    "high",
    `quantum-worker-${pool}`,
    `Worker ${workerId} in pool ${pool} is unresponsive. Timeout exceeded.`,
    [
      "Cancel job by timeout",
      "Kill worker process (SIGKILL)",
      "Mark job as retryable",
      "Spawn clean replacement worker",
      "Increment restart metric",
      "Open circuit breaker if threshold exceeded",
    ],
  );
}

/**
 * Incidente C: Proveedor remoto caído
 * Abrir circuito del proveedor → No cambiar a hardware diferente sin política
 */
export function handleRemoteProviderDown(provider: string): RecoveryIncident {
  return createIncident(
    "remote_provider_down",
    "high",
    provider,
    `Remote provider ${provider} is down. Circuit breaker activated.`,
    [
      "Open circuit for specific provider only (not entire platform)",
      "Do not auto-switch to different hardware without policy approval",
      "Offer local simulator only if user accepts and mark as degraded/substituted",
      "Retry with limited backoff",
      "Record outage and original provider for reconciliation",
    ],
  );
}

/**
 * Incidente D: HSM no disponible
 * Bloquear nuevas firmas → Permitir lectura → HSM backup si aprobado
 */
export function handleHSMUnavailable(): RecoveryIncident {
  return createIncident(
    "hsm_unavailable",
    "critical",
    "hsm-primary",
    "Primary HSM is unavailable. Blocking new signatures.",
    [
      "Block all new signing operations",
      "Allow reading previously signed results",
      "Switch to backup HSM if approved",
      "Do NOT use software keys without explicit emergency policy",
      "Mark events pending signature for later reconciliation",
      "Reconcile and sign after HSM recovery",
    ],
  );
}

/**
 * Incidente E: TEE no verificable
 * Rechazar confidential computing → Permitir simulación local con clasificación diferente
 */
export function handleTEEUnverifiable(): RecoveryIncident {
  return createIncident(
    "tee_unverifiable",
    "medium",
    "tee-verifier",
    "TEE attestation could not be verified. Confidential computing operations rejected.",
    [
      "Reject operations requiring confidential computing",
      "Allow local simulation only with different classification",
      "Do NOT set teeVerified flag",
      "Record unverified evidence without public exposure",
      "Notify operator for manual review",
    ],
  );
}

/**
 * Incidente F: BookPI/PostgreSQL caído
 * No declarar confirmada → Journal local cifrado → Detener alto impacto
 */
export function handleBookPIPostgresDown(): RecoveryIncident {
  return createIncident(
    "bookpi_postgres_down",
    "critical",
    "bookpi-postgresql",
    "BookPI and/or PostgreSQL is down. Audit chain persistence interrupted.",
    [
      "Do not declare executions as fully confirmed",
      "Maintain encrypted local journal (limited size)",
      "Retry persistence with exponential backoff",
      "Stop high-impact executions (QPU, remote)",
      "Reconcile by requestId and circuitHash after recovery",
    ],
  );
}

/**
 * Incidente G: Nodo federado malicioso
 * Suspender replicación → Mantener cadena local → Revocar certificado
 */
export function handleFederationNodeMalicious(nodeId: string): RecoveryIncident {
  return createIncident(
    "federation_node_malicious",
    "critical",
    `federation-${nodeId}`,
    `Federated node ${nodeId} is exhibiting malicious behavior.`,
    [
      "Suspend replication toward compromised node",
      "Maintain local audit chain integrity",
      "Revoke node certificate or key",
      "Compare blocks and hashes for tampering evidence",
      "Reintegrate only after full revalidation and manual review",
      "Alert all other federation nodes",
    ],
  );
}

// ============================================================================
// QUERY & METRICS
// ============================================================================

export function getActiveIncidents(): RecoveryIncident[] {
  return incidents.filter((i) => !i.resolvedAt);
}

export function getAllIncidents(limit: number = 50): RecoveryIncident[] {
  return incidents.slice(-limit);
}

export function resolveIncident(incidentId: string): boolean {
  const incident = incidents.find((i) => i.incidentId === incidentId);
  if (!incident) return false;
  incident.resolvedAt = new Date().toISOString();
  return true;
}

export function getRecoveryMetrics() {
  const active = getActiveIncidents();
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const i of incidents) {
    byType[i.type] = (byType[i.type] || 0) + 1;
    bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
  }

  return {
    totalIncidents: incidents.length,
    active: active.length,
    resolved: incidents.length - active.length,
    byType,
    bySeverity,
  };
}
