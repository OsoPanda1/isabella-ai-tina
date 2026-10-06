/**
 * Production Authority Engine (src/lib/production-authority.ts)
 * -------------------------------------------------------------
 * Fuente de verdad de las seis autoridades declaradas por Isabella.
 * Reporta únicamente estado respaldado por configuración disponible.
 *
 * IMPORTANTE:
 * - No confunde criptografía de aplicación con HSM/KMS hardware.
 * - No inventa readiness en producción.
 * - Toda configuración se obtiene mediante el contrato central de config().
 */
import { config } from "./config";
import { isProductionLike } from "./runtime-mode";

export interface AuthorityStatus {
  name: string;
  configured: boolean;
  status: "ACTIVE" | "DEGRADED" | "MISSING";
  requiredInProduction: boolean;
  details?: string;
}

export interface ProductionAuditReport {
  ready: boolean;
  environment: string;
  authorities: AuthorityStatus[];
  missingCount: number;
}

function present(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validBookpiAlgorithm(value: unknown): boolean {
  return value === "ECDSA-P384" || value === "RSA-SHA256";
}

export function evaluateProductionAuthorities(): ProductionAuditReport {
  const cfg = config();
  const production = isProductionLike(cfg.ISABELLA_RUNTIME_MODE);

  const identityConfigured = present(cfg.AUTH_JWT_SECRET) || present(cfg.SUPABASE_URL);
  const policyConfigured = present(cfg.CROWN_POLICY_SIGNING_KEY) && present(cfg.AEGIS_AUDIT_SECRET);
  const persistenceConfigured = present(cfg.DATABASE_URL);

  const evidenceConfigured =
    present(cfg.AEGIS_AUDIT_SECRET) &&
    present(cfg.BOOKPI_SIGNING_KEY) &&
    present(cfg.CROWN_POLICY_SIGNING_KEY) &&
    validBookpiAlgorithm(cfg.BOOKPI_SIGNATURE_ALGORITHM);

  const cryptoConfigured =
    present(cfg.ENCRYPTION_MASTER_KEY) &&
    present(cfg.CROWN_POLICY_SIGNING_KEY) &&
    present(cfg.BOOKPI_SIGNING_KEY) &&
    validBookpiAlgorithm(cfg.BOOKPI_SIGNATURE_ALGORITHM);

  const authorities: AuthorityStatus[] = [
    {
      name: "IDENTITY_AUTHORITY",
      configured: identityConfigured,
      status: identityConfigured || !production ? "ACTIVE" : "MISSING",
      requiredInProduction: true,
      details:
        "Identidad firmada mediante AUTH_JWT_SECRET y/o proveedor OIDC/Supabase configurado.",
    },
    {
      name: "POLICY_AUTHORITY",
      configured: policyConfigured,
      status: policyConfigured || !production ? "ACTIVE" : "MISSING",
      requiredInProduction: true,
      details:
        "CROWN/ARGUS ejecuta evaluación determinista antes de la ejecución sensible; requiere CROWN_POLICY_SIGNING_KEY y AEGIS_AUDIT_SECRET.",
    },
    {
      name: "PERSISTENCE_AUTHORITY",
      configured: persistenceConfigured,
      status: persistenceConfigured || !production ? "ACTIVE" : "MISSING",
      requiredInProduction: true,
      details: "PostgreSQL es la autoridad durable requerida en staging/production.",
    },
    {
      name: "EVIDENCE_AUTHORITY",
      configured: evidenceConfigured,
      status: evidenceConfigured || !production ? "ACTIVE" : "MISSING",
      requiredInProduction: true,
      details:
        "BookPI/ledger requiere AEGIS_AUDIT_SECRET, claves de firma y algoritmo explícitamente permitido.",
    },
    {
      name: "ECONOMIC_AUTHORITY",
      configured: present(cfg.STRIPE_SECRET_KEY),
      status: present(cfg.STRIPE_SECRET_KEY) || !production ? "ACTIVE" : "DEGRADED",
      requiredInProduction: false,
      details: "Stripe/Cattleya permanece opcional para el núcleo conversacional.",
    },
    {
      name: "CRYPTOGRAPHIC_AUTHORITY",
      configured: cryptoConfigured,
      status: cryptoConfigured || !production ? "ACTIVE" : "MISSING",
      requiredInProduction: true,
      details:
        "AES-256-GCM/HKDF y firmas BookPI/CROWN. La disponibilidad de HSM/KMS hardware no se infiere de esta configuración.",
    },
  ];

  const missing = authorities.filter(
    (authority) => authority.requiredInProduction && authority.status === "MISSING",
  );

  return {
    ready: missing.length === 0,
    environment: cfg.ISABELLA_RUNTIME_MODE,
    authorities,
    missingCount: missing.length,
  };
}

export function assertProductionReady(): void {
  const cfg = config();
  if (!isProductionLike(cfg.ISABELLA_RUNTIME_MODE)) return;

  const report = evaluateProductionAuthorities();
  if (!report.ready) {
    const missingNames = report.authorities
      .filter((authority) => authority.requiredInProduction && authority.status === "MISSING")
      .map((authority) => authority.name)
      .join(", ");

    throw new Error(
      `PRODUCTION_AUTHORITY_ABORT: System cannot start in production. Incomplete authorities: ${missingNames}`,
    );
  }
}

export default {
  evaluateProductionAuthorities,
  assertProductionReady,
};
