/**
 * Isabella Quantum Mesh — Core Modules Registry (24 Núcleos)
 * Los 24 núcleos como dominios de capacidad, NO como procesos con privilegios globales.
 * Reglas: Ningún núcleo puede cambiar sus propios scopes ni firmar su propia decisión.
 */

export interface CoreModule {
  id: number;
  name: string;
  domain: string;
  inputType: string;
  outputType: string;
  canWritePolicy: boolean;
  canSignAuthorization: boolean;
  canPurgeAudit: boolean;
  requiredScopes: string[];
}

export const CORE_MODULES: CoreModule[] = [
  {
    id: 1,
    name: "Identity",
    domain: "WebAuthn, sesión",
    inputType: "credential",
    outputType: "principal",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["identity:read"],
  },
  {
    id: 2,
    name: "Consent",
    domain: "consentimiento",
    inputType: "consent_request",
    outputType: "authorization",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["consent:write"],
  },
  {
    id: 3,
    name: "ARGUS",
    domain: "request + contexto",
    inputType: "request_context",
    outputType: "policy_decision",
    canWritePolicy: true,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["policy:evaluate"],
  },
  {
    id: 4,
    name: "Yun",
    domain: "intención",
    inputType: "intent",
    outputType: "execution_plan",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["orchestration:plan"],
  },
  {
    id: 5,
    name: "Quantum Gateway",
    domain: "request",
    inputType: "quantum_request",
    outputType: "normalized_job",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["quantum:execute"],
  },
  {
    id: 6,
    name: "Device Registry",
    domain: "provider",
    inputType: "provider_id",
    outputType: "capability_record",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["quantum:registry"],
  },
  {
    id: 7,
    name: "Scheduler",
    domain: "coste + prioridad",
    inputType: "job",
    outputType: "assignment",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["quantum:schedule"],
  },
  {
    id: 8,
    name: "Worker Supervisor",
    domain: "job",
    inputType: "job",
    outputType: "lifecycle",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["quantum:supervise"],
  },
  {
    id: 9,
    name: "PennyLane Core",
    domain: "circuito",
    inputType: "circuit",
    outputType: "simulated_result",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["quantum:execute"],
  },
  {
    id: 10,
    name: "Lightning",
    domain: "circuito HPC",
    inputType: "circuit",
    outputType: "accelerated_result",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["quantum:execute", "quantum:lightning"],
  },
  {
    id: 11,
    name: "Qiskit",
    domain: "circuito/provider",
    inputType: "circuit",
    outputType: "qiskit_result",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["quantum:execute", "quantum:qiskit"],
  },
  {
    id: 12,
    name: "Rigetti",
    domain: "circuito/provider",
    inputType: "circuit",
    outputType: "rigetti_result",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["quantum:execute", "quantum:rigetti"],
  },
  {
    id: 13,
    name: "Braket",
    domain: "circuito/provider",
    inputType: "circuit",
    outputType: "braket_result",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["quantum:execute", "quantum:braket"],
  },
  {
    id: 14,
    name: "Catalyst",
    domain: "programa permitido",
    inputType: "program",
    outputType: "compiled_artifact",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["quantum:execute", "quantum:catalyst"],
  },
  {
    id: 15,
    name: "PQC",
    domain: "digest",
    inputType: "payload",
    outputType: "ml_dsa_signature",
    canWritePolicy: false,
    canSignAuthorization: true,
    canPurgeAudit: false,
    requiredScopes: ["crypto:sign"],
  },
  {
    id: 16,
    name: "HSM",
    domain: "operación criptográfica",
    inputType: "operation",
    outputType: "signature_or_unwrap",
    canWritePolicy: false,
    canSignAuthorization: true,
    canPurgeAudit: false,
    requiredScopes: ["hsm:sign"],
  },
  {
    id: 17,
    name: "TEE",
    domain: "evidencia",
    inputType: "attestation_req",
    outputType: "attestation_decision",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["tee:verify"],
  },
  {
    id: 18,
    name: "BookPI",
    domain: "evento",
    inputType: "event",
    outputType: "audit_block",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["audit:write"],
  },
  {
    id: 19,
    name: "CRYSTALS-LATAMV",
    domain: "bloque previo",
    inputType: "block",
    outputType: "chained_block",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["audit:write"],
  },
  {
    id: 20,
    name: "PostgreSQL",
    domain: "evento",
    inputType: "event",
    outputType: "persistent_state",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["storage:write"],
  },
  {
    id: 21,
    name: "Backup",
    domain: "snapshot/evento",
    inputType: "snapshot",
    outputType: "verified_copy",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["backup:write"],
  },
  {
    id: 22,
    name: "Telemetry",
    domain: "spans/metrics/logs",
    inputType: "telemetry_data",
    outputType: "observability",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["telemetry:write"],
  },
  {
    id: 23,
    name: "Heptafederado",
    domain: "evento firmado",
    inputType: "signed_event",
    outputType: "validated_replica",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: false,
    requiredScopes: ["federation:replicate"],
  },
  {
    id: 24,
    name: "Recovery",
    domain: "incidente",
    inputType: "incident",
    outputType: "recovery_plan",
    canWritePolicy: false,
    canSignAuthorization: false,
    canPurgeAudit: true,
    requiredScopes: ["recovery:activate"],
  },
];

/**
 * Obtiene un módulo core por ID.
 */
export function getCoreModule(id: number): CoreModule | undefined {
  return CORE_MODULES.find((m) => m.id === id);
}

/**
 * Obtiene un módulo core por nombre.
 */
export function getCoreModuleByName(name: string): CoreModule | undefined {
  return CORE_MODULES.find((m) => m.name.toLowerCase() === name.toLowerCase());
}

/**
 * Verifica si un scope es necesario para operar un módulo.
 */
export function hasRequiredScopes(moduleId: number, userScopes: string[]): boolean {
  const mod = getCoreModule(moduleId);
  if (!mod) return false;
  return mod.requiredScopes.every((s) => userScopes.includes(s) || userScopes.includes("*"));
}

/**
 * Métricas de los 24 núcleos.
 */
export function getCoreModulesStatus() {
  return {
    totalModules: CORE_MODULES.length,
    modules: CORE_MODULES.map((m) => ({
      id: m.id,
      name: m.name,
      domain: m.domain,
      canWritePolicy: m.canWritePolicy,
      canSignAuthorization: m.canSignAuthorization,
      canPurgeAudit: m.canPurgeAudit,
    })),
  };
}
