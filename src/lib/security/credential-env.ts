/**
 * AISLAMIENTO DE CREDENCIALES EN EJECUCION NO CONFIABLE
 * (src/lib/security/credential-env.ts)
 * -----------------------------------------------------------------
 * Clasifica nombres de variables de entorno que jamas pueden inyectarse en
 * un contexto de ejecucion no confiable (sandbox de contenedor, ORION,
 * herramientas de terceros). Espejo local del contrato de iron-proxy:
 * credenciales negadas al spawn, env del host inyectado solo en contextos
 * de confianza. No valida valores — solo nombres, de forma fail-closed.
 */

const CREDENTIAL_ENV_PATTERNS: readonly RegExp[] = [
  /(secret|token|password|passwd|credential|passphrase|bearer)/i,
  /(api[_-]?key|private[_-]?key|signing[_-]?key|access[_-]?key|session[_-]?key|service[_-]?role[_-]?key)/i,
  /(^|[_-])key$/i,
  /(^|_)(database|db|postgres|pg|redis|kv|direct|turso)[a-z0-9_]*_url$/i,
];

/**
 * true si `name` nombra una credencial (API key, JWT, secreto, password,
 * URL de base de datos, service-role key) que debe vetarse en el env de
 * ejecucion no confiable.
 */
export function isCredentialEnvName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === "") return false;
  return CREDENTIAL_ENV_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Nombres de `envVars` que califican como credencial. Devuelve solo los
 * nombres (nunca valores) para que el caller pueda auditar sin filtrar.
 */
export function credentialEnvNames(envVars: Record<string, string>): string[] {
  return Object.keys(envVars).filter(isCredentialEnvName);
}
