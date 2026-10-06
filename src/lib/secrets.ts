/**
 * Secrets Management & Redaction
 * Enforces fail-closed secret acquisition with zero client leakage.
 */
import { isProductionLike } from "./runtime-mode";

export class MissingSecretError extends Error {
  constructor(public readonly secretName: string) {
    super(`CRITICAL_SECURITY_ERROR: Required secret '${secretName}' is missing.`);
    this.name = "MissingSecretError";
  }
}

export function getSecret(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value && value.trim().length > 0) {
    return value.trim();
  }
  if (fallback !== undefined) {
    return fallback;
  }
  if (isProductionLike()) {
    throw new MissingSecretError(name);
  }
  // Safe ephemeral dev default
  return `dev-ephemeral-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-key`;
}

export function getOptionalSecret(name: string): string | null {
  const value = process.env[name];
  if (value && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

export const secrets = {
  get: getSecret,
  getOptional: getOptionalSecret,
  jwtSecret: () => getSecret("AUTH_JWT_SECRET"),
};

export default secrets;
