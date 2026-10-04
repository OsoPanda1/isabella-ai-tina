/**
 * CONSTITUTION ejecutable (src/lib/policy/constitution.ts)
 * --------------------------------------------------------
 * Espejo en TypeScript de `policy/constitution.rego` (paquete
 * `isabella.constitution`), absorbido de nodo genesis y adaptado a los
 * artefactos reales de este repositorio (k8s/deployment.yaml,
 * k8s/qup-psp.yaml). La política vive en dos capas, igual que en el
 * origen: (1) declarativa (rego/OPA/Gatekeeper) y (2) esta evaluación
 * ejecutable que las pruebas de paridad mantienen sincronizadas.
 *
 * Semántica idéntica al rego: fail-closed por defecto (toda regla sin
 * `default` explícito que no aplique ⇒ no permitida), y la regla de
 * verificación es AND estricto.
 *
 * Honestidad (AGENTS.md §19): esta capa prueba la equivalencia de la
 * política; NO sustituye la ejecución de OPA (sigue EVIDENCE_GATED
 * hasta que corra en CI/entorno con el binario).
 */

export interface ConstitutionInput {
  /** Proveedor criptográfico auditado disponible (sellado híbrido). */
  providerAvailable?: boolean;
  classicalOk?: boolean;
  postQuantumOk?: boolean;
  policyOk?: boolean;
  hashOk?: boolean;
  runAsNonRoot?: boolean;
  readinessProbe?: string;
  sensitivity?: "restricted" | "critical" | string;
  sealed?: boolean;
  domain?: string;
  federationId?: string | null;
}

export interface ConstitutionCheck {
  rule: string;
  ok: boolean;
  detail?: string;
}

export interface ConstitutionAssessment {
  ok: boolean;
  policy: string;
  checks: ConstitutionCheck[];
}

export const CONSTITUTION_POLICY_VERSION = "isabella-constitution-v1";

/** Endpoint de prontitud declarado en k8s/deployment.yaml. */
export const READINESS_PROBE_PATH = "/api/health/ready";

/**
 * Evalúa la constitución sobre un input. Devuelve `ok: false` si
 * CUALQUIER regla aplica y no se cumple; las reglas que no aplican
 * cuentan como no permitidas (fail-closed del `default ... = false`).
 */
export function evaluateConstitution(input: ConstitutionInput): ConstitutionAssessment {
  const sealAllowed = input.providerAvailable === true;
  const verifyAllowed =
    input.classicalOk === true &&
    input.postQuantumOk === true &&
    input.policyOk === true &&
    input.hashOk === true;
  const runAsNonRoot = input.runAsNonRoot === true;
  const readinessAllowed = input.readinessProbe === READINESS_PROBE_PATH;
  const criticalSealed =
    (input.sensitivity === "restricted" || input.sensitivity === "critical") &&
    input.sealed === true;
  const federationLeak = input.domain === "federations" && input.federationId != null;

  const checks: ConstitutionCheck[] = [
    {
      rule: "seal_allowed",
      ok: sealAllowed,
      detail: sealAllowed
        ? undefined
        : "sellado híbrido requiere proveedor criptográfico auditado disponible",
    },
    {
      rule: "verify_allowed",
      ok: verifyAllowed,
      detail: verifyAllowed
        ? undefined
        : "verificación AND: clásica AND post-cuántica AND política AND hash",
    },
    {
      rule: "allow_run_as_non_root",
      ok: runAsNonRoot,
      detail: runAsNonRoot ? undefined : "el contenedor debe ejecutar como usuario no root",
    },
    {
      rule: "allow_readiness_probe",
      ok: readinessAllowed,
      detail: readinessAllowed ? undefined : `readinessProbe debe ser ${READINESS_PROBE_PATH}`,
    },
    {
      rule: "allow_critical_sealed",
      ok: criticalSealed,
      detail: criticalSealed
        ? undefined
        : "sensibilidad restricted/critical exige sello (sealed=true)",
    },
    {
      rule: "deny_federation_domain_leak",
      ok: !federationLeak,
      detail: federationLeak
        ? "eventos de federaciones no deben referir una federación concreta"
        : undefined,
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    policy: CONSTITUTION_POLICY_VERSION,
    checks,
  };
}

export const ISABELLA_CONSTITUTION = {
  evaluate: evaluateConstitution,
  policy: CONSTITUTION_POLICY_VERSION,
  readinessProbePath: READINESS_PROBE_PATH,
};
