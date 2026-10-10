import { resolveRoleChain, type Role } from "./rbac";

// ============================================================================
// PRIVILEGE VALIDATION (src/lib/privilege-validation.ts)
// ----------------------------------------------------------------------------
// Validación de privilegios para la EMISIÓN de credenciales (API Keys).
// Un emisor nunca puede conceder un privilegio mayor al que posee
// (mínimo privilegio, FASE 2.2). Fail-closed en todos los casos.
// ============================================================================

/** Compara si el rol solicitado es estrictamente igual o menor que el rol del emisor. */
export function isRoleSubset(requestedRole: string, issuerRole: string): boolean {
  if (requestedRole === issuerRole) return true;
  const issuerChain = resolveRoleChain(issuerRole as Role);
  return issuerChain.includes(requestedRole as Role);
}

/** Compara si los scopes solicitados están contenidos en los scopes del emisor. */
export function isScopeSubset(requestedScopes: string[], issuerScopes: string[]): boolean {
  if (requestedScopes.length === 0) return true;
  const issuerSet = new Set(issuerScopes.flatMap((s) => s.split(/\s+/).filter(Boolean)));
  return requestedScopes.every((s) => issuerSet.has(s));
}

/** TTL máximo (en segundos) permitido para API keys por rol del emisor. */
export function maxApiKeyTTLForRole(issuerRole: string): number {
  switch (issuerRole) {
    case "SovereignOwner":
      return 365 * 24 * 3600; // 1 año
    case "Operator":
    case "governance_admin":
      return 30 * 24 * 3600; // 30 días
    default:
      return 24 * 3600; // 24h, mínimo privilegio
  }
}

export interface IssuePrivilegeResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Valida la emisión de una credencial API Key contra el principal emisor.
 * Todos los chequeos son fail-closed y devuelven la razón textual.
 */
export function validateApiKeyIssue(input: {
  issuerRole: string;
  issuerScopes: string[];
  issuerTenantId: string;
  requestedRole: string;
  requestedScopes: string[];
  requestedTenantId?: string;
  requestedTtlSeconds?: number;
}): IssuePrivilegeResult {
  const {
    issuerRole,
    issuerScopes,
    issuerTenantId,
    requestedRole,
    requestedScopes,
    requestedTenantId,
    requestedTtlSeconds,
  } = input;

  if (!isRoleSubset(requestedRole, issuerRole)) {
    return {
      allowed: false,
      reason: "Cannot issue credential with higher role",
    };
  }

  if (!isScopeSubset(requestedScopes, issuerScopes)) {
    return {
      allowed: false,
      reason: "Cannot issue credential with broader scopes",
    };
  }

  if (requestedTenantId && requestedTenantId !== issuerTenantId) {
    return {
      allowed: false,
      reason: "Cannot issue credential for another tenant",
    };
  }

  if (requestedTtlSeconds !== undefined) {
    const maxTTL = maxApiKeyTTLForRole(issuerRole);
    if (requestedTtlSeconds > maxTTL) {
      return {
        allowed: false,
        reason: `API key TTL exceeds maximum of ${maxTTL}s`,
      };
    }
  }

  return { allowed: true };
}
