/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — BETA / IDENTITY
 * Resuelve actor, tenant, sesión, rol, scopes y nivel de garantía.
 * ================================================================
 */

export type AssuranceLevel = "none" | "basic" | "verified" | "high" | "critical";

export interface IdentityContext {
  actorId: string;
  tenantId: string;
  sessionId?: string;
  roles: string[];
  scopes: string[];
  assuranceLevel: AssuranceLevel;
  authenticatedAt: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
}

export interface IdentityVerification {
  verified: boolean;
  method: "api_key" | "session" | "hmac" | "oauth" | "mfa";
  assuranceLevel: AssuranceLevel;
  scopesGranted: string[];
  deniedScopes: string[];
  reason?: string;
}

/* =========================================================================
   IDENTITY RESOLVER
   ========================================================================= */

export class IdentityResolver {
  private knownRoles: Map<string, string[]> = new Map([
    ["admin", ["*"]],
    ["user", ["cognitive:read", "cognitive:write", "memory:read"]],
    ["viewer", ["cognitive:read"]],
    ["operator", ["cognitive:read", "cognitive:write", "pipeline:execute"]],
  ]);

  /**
   * Resolve identity from request context.
   */
  resolve(params: {
    actorId: string;
    tenantId: string;
    sessionId?: string;
    authMethod?: string;
    providedScopes?: string[];
  }): IdentityContext {
    const roles = this.inferRoles(params.actorId, params.tenantId);
    const scopes = this.resolveScopes(roles, params.providedScopes);
    const assuranceLevel = this.assessAssuranceLevel(params.authMethod ?? "session");

    return {
      actorId: params.actorId,
      tenantId: params.tenantId,
      sessionId: params.sessionId,
      roles,
      scopes,
      assuranceLevel,
      authenticatedAt: new Date().toISOString(),
      metadata: {},
    };
  }

  /**
   * Verify that an identity has the required scopes.
   */
  verify(identity: IdentityContext, requiredScopes: string[]): IdentityVerification {
    const granted: string[] = [];
    const denied: string[] = [];

    for (const scope of requiredScopes) {
      if (identity.scopes.includes(scope) || identity.scopes.includes("*")) {
        granted.push(scope);
      } else {
        denied.push(scope);
      }
    }

    return {
      verified: denied.length === 0,
      method: "session",
      assuranceLevel: identity.assuranceLevel,
      scopesGranted: granted,
      deniedScopes: denied,
      reason: denied.length > 0 ? `Missing scopes: ${denied.join(", ")}` : undefined,
    };
  }

  private inferRoles(actorId: string, tenantId: string): string[] {
    if (actorId.startsWith("admin")) return ["admin"];
    if (actorId.startsWith("operator")) return ["operator"];
    return ["user"];
  }

  private resolveScopes(roles: string[], provided?: string[]): string[] {
    const scopeSet = new Set<string>();

    for (const role of roles) {
      const roleScopes = this.knownRoles.get(role) ?? [];
      for (const scope of roleScopes) {
        scopeSet.add(scope);
      }
    }

    if (provided) {
      for (const scope of provided) {
        scopeSet.add(scope);
      }
    }

    return Array.from(scopeSet);
  }

  private assessAssuranceLevel(method: string): AssuranceLevel {
    const levels: Record<string, AssuranceLevel> = {
      mfa: "critical",
      oauth: "high",
      api_key: "verified",
      hmac: "verified",
      session: "basic",
    };

    return levels[method] ?? "none";
  }
}

export const identityResolver = new IdentityResolver();
