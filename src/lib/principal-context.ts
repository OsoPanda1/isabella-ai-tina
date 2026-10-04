import { SecuritySystem, TokenClaims } from "./security";
import { evaluateAuthorization, type AuthorizationContext } from "./authorization";
import { type Resource, type Action } from "./permission-matrix";
import { type Role } from "./rbac";
import { ApiKeyAuthenticator } from "./api-key-authenticator";
import { repositoryFactory } from "./persistence/repository-factory";
import { config } from "./config";
import { runWithIdentity, type RequestIdentity } from "./identity-context";

function jsonError(message: string, traceId: string, status: number, headers: Headers): Response {
  return new Response(JSON.stringify({ error: message, traceId }), { status, headers });
}

export function isExplicitDevelopmentAuth(cfg: {
  NODE_ENV?: string;
  ISABELLA_RUNTIME_MODE?: string;
  AUTH_DEV_SESSION_ENABLED?: boolean;
}): boolean {
  return (
    cfg.NODE_ENV === "development" &&
    cfg.ISABELLA_RUNTIME_MODE === "development" &&
    cfg.AUTH_DEV_SESSION_ENABLED === true
  );
}

export function canUseGuestChat(cfg: {
  ALLOW_GUEST_CHAT?: boolean;
  NODE_ENV?: string;
  ISABELLA_RUNTIME_MODE?: string;
  VERCEL_ENV?: string;
}): boolean {
  // El chat invitado solo existe en desarrollo explícito o en previews aislados.
  // Producción exige siempre una identidad firmada o API key.
  const isPreview = cfg.VERCEL_ENV === "preview";
  const isDevelopment =
    cfg.NODE_ENV === "development" && cfg.ISABELLA_RUNTIME_MODE === "development";
  return cfg.ALLOW_GUEST_CHAT === true && (isDevelopment || isPreview);
}

function assertDevelopmentOnly(): void {
  if (!isExplicitDevelopmentAuth(config()))
    throw new Error(
      "[SovereignGuard Violation] Fallback de desarrollo permitido únicamente con NODE_ENV=development, ISABELLA_RUNTIME_MODE=development y AUTH_DEV_SESSION_ENABLED=true.",
    );
}
function guestContext(ip: string, traceId: string, correlationId: string): PrincipalContext {
  return PrincipalContext.createGuestContext(ip, traceId, correlationId);
}
function devContext(ip: string, traceId: string, correlationId: string): PrincipalContext {
  return PrincipalContext.createDevContext(ip, traceId, correlationId);
}
function sessionExpiryMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value))
    return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export class PrincipalContext {
  public readonly userId: string;
  public readonly username: string;
  public readonly tenantId: string;
  public readonly role: Role;
  public readonly scope: string;
  public readonly ip: string;
  public readonly traceId: string;
  public readonly correlationId: string;
  public readonly tenant: { id: string; slug: string; tier: string; quotaBalance: number };
  public constructor(
    claims: TokenClaims,
    tenant: { id: string; slug: string; tier: string; quotaBalance: number },
    username: string,
    ip: string,
    traceId: string,
    correlationId: string,
  ) {
    const tenantId = typeof claims.tenantId === "string" ? claims.tenantId : claims.tenant_id;
    const scope =
      typeof claims.scope === "string"
        ? claims.scope
        : Array.isArray(claims.scopes)
          ? claims.scopes.join(" ")
          : "";
    if (!tenantId) throw new Error("AUTH_TENANT_REQUIRED");
    if (!scope) throw new Error("AUTH_SCOPE_REQUIRED");
    this.userId = claims.sub;
    this.username = username;
    this.tenantId = tenantId;
    this.role = claims.role as Role;
    this.scope = scope;
    this.ip = ip;
    this.traceId = traceId;
    this.correlationId = correlationId;
    this.tenant = tenant;
  }
  public toRequestIdentity(): RequestIdentity {
    return { userId: this.userId, role: this.role, tenantId: this.tenantId, scope: this.scope };
  }
  public static createGuestContext(
    ip: string,
    traceId: string,
    correlationId: string,
  ): PrincipalContext {
    return new PrincipalContext(
      {
        iss: "isabella.guest",
        sub: "guest_user",
        aud: "nodo_cero_rdm",
        exp: Math.floor(Date.now() / 1000) + 3600,
        tenantId: "nodo_cero_rdm",
        role: "Guest" as Role,
        scope: "isabella:chat",
      },
      { id: "nodo_cero_rdm", slug: "nodo-cero", tier: "sovereign", quotaBalance: 0 },
      "guest_user",
      ip,
      traceId,
      correlationId,
    );
  }
  public static createDevContext(
    ip: string,
    traceId: string,
    correlationId: string,
  ): PrincipalContext {
    assertDevelopmentOnly();
    return new PrincipalContext(
      {
        iss: "isabella.dev",
        sub: "dev_user",
        aud: "tenant-dev",
        exp: Math.floor(Date.now() / 1000) + 3600,
        tenantId: "tenant-dev",
        role: "SovereignOwner" as Role,
        scope: "isabella:chat isabella:voice isabella:tools",
      },
      { id: "tenant-dev", slug: "dev", tier: "sovereign", quotaBalance: 9999 },
      "dev_user",
      ip,
      traceId,
      correlationId,
    );
  }
  public static async authorize(
    request: Request,
    requiredScope?: string,
  ): Promise<
    { success: true; context: PrincipalContext } | { success: false; response: Response }
  > {
    const ip = SecuritySystem.resolveClientIp(request);
    const telemetry = SecuritySystem.generateTelemetry(ip, "allowed");
    const headers = SecuritySystem.injectSecureHeaders(
      new Headers({ "content-type": "application/json" }),
    );
    const limitCheck = SecuritySystem.checkRateLimit(ip);
    if (!limitCheck.allowed)
      return {
        success: false,
        response: jsonError(
          "SovereignGate Rate-Limit: Demasiadas solicitudes desde esta IP de origen.",
          telemetry.traceId,
          429,
          headers,
        ),
      };
    const authorizationHeader = request.headers.get("authorization");
    const hasApiKeyHeader = request.headers.has("x-isabella-api-key");
    const hasApiKeyScheme = Boolean(
      authorizationHeader && /^ApiKey\s+\S+$/i.test(authorizationHeader),
    );
    if (hasApiKeyHeader || hasApiKeyScheme) {
      const apiKeyRequest = hasApiKeyHeader
        ? request
        : (() => {
            const headers = new Headers(request.headers);
            headers.set(
              "x-isabella-api-key",
              authorizationHeader!.replace(/^ApiKey\s+/i, "").trim(),
            );
            return new Request(request, { headers });
          })();
      const authResult = await ApiKeyAuthenticator.authenticate(apiKeyRequest);
      if (!authResult.success)
        return {
          success: false,
          response: jsonError(
            `Acceso Denegado API Key: Credencial inválida, expirada o revocada (${authResult.error}).`,
            telemetry.traceId,
            401,
            headers,
          ),
        };
      const principal = authResult.principal;
      if (requiredScope && !principal.scopes.includes(requiredScope))
        return {
          success: false,
          response: jsonError(
            `Privilegios Insuficientes: Ámbito '${requiredScope}' requerido para esta API Key.`,
            telemetry.traceId,
            403,
            headers,
          ),
        };
      const tenantRecord = await repositoryFactory
        .getTenantRepository()
        .read(principal.tenantId, principal.tenantId);
      if (!tenantRecord)
        return {
          success: false,
          response: jsonError(
            "Aislamiento de Tenant Violado: El Tenant asignado a la API Key no está registrado.",
            telemetry.traceId,
            403,
            headers,
          ),
        };
      const expMillis = principal.expiresAt
        ? new Date(principal.expiresAt).getTime()
        : Date.now() + 86400000;
      if (!Number.isFinite(expMillis) || expMillis <= Date.now())
        return {
          success: false,
          response: jsonError(
            "Acceso Denegado: API Key expirada.",
            telemetry.traceId,
            401,
            headers,
          ),
        };
      const claims: TokenClaims = {
        iss: "isabella.sovereign.api-keys",
        sub: principal.subject,
        aud: principal.tenantId,
        exp: Math.floor(expMillis / 1000),
        tenantId: principal.tenantId,
        role: principal.role,
        scope: principal.scopes.join(" "),
      };
      const identity: RequestIdentity = {
        userId: principal.subject,
        role: principal.role,
        tenantId: principal.tenantId,
        scope: principal.scopes.join(" "),
      };
      const context = new PrincipalContext(
        claims,
        {
          id: tenantRecord.id,
          slug: tenantRecord.slug,
          tier: tenantRecord.tier,
          quotaBalance: tenantRecord.quotaBalance,
        },
        "api_key_session",
        ip,
        telemetry.traceId,
        telemetry.correlationId,
      );
      return runWithIdentity(identity, async () => ({ success: true, context }));
    }
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      try {
        const cfg = config();
        if (canUseGuestChat(cfg) && (!requiredScope || requiredScope === "isabella:chat"))
          return {
            success: true,
            context: guestContext(ip, telemetry.traceId, telemetry.correlationId),
          };
        if (isExplicitDevelopmentAuth(cfg))
          return {
            success: true,
            context: devContext(ip, telemetry.traceId, telemetry.correlationId),
          };
      } catch {
        /* fail closed */
      }
      return {
        success: false,
        response: jsonError(
          "No Autorizado OIDC: Falta la firma criptográfica Bearer en la cabecera o la cabecera X-Isabella-API-Key.",
          telemetry.traceId,
          401,
          headers,
        ),
      };
    }
    if (!/^Bearer\s+\S+$/i.test(authHeader))
      return {
        success: false,
        response: jsonError(
          "Acceso Denegado: formato Bearer inválido.",
          telemetry.traceId,
          401,
          headers,
        ),
      };
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const verification = await SecuritySystem.verifyToken(token, {
      ip,
      traceId: telemetry.traceId,
      correlationId: telemetry.correlationId,
      requiredScope,
    });
    if (!verification.success || !verification.claims)
      return {
        success: false,
        response: jsonError(
          `Acceso Denegado: Credencial corrupta o adulterada. ${verification.error || ""}`,
          telemetry.traceId,
          401,
          headers,
        ),
      };
    const claims = { ...verification.claims } as TokenClaims;
    if (claims.role === "Guest" || (claims.role as string) === "guest")
      claims.scope = "isabella:chat";
    if (requiredScope) {
      const scopeCheck = await SecuritySystem.verifyApiScope(token, requiredScope);
      if (!scopeCheck.allowed)
        return {
          success: false,
          response: jsonError(
            `Privilegios Insuficientes: Ámbito '${requiredScope}' requerido en el OIDC token.`,
            telemetry.traceId,
            403,
            headers,
          ),
        };
    }
    const identity: RequestIdentity = {
      userId: claims.sub,
      role: claims.role,
      tenantId: claims.tenantId,
      scope: claims.scope,
    };
    return runWithIdentity(identity, async () => {
      // Fail-closed: un claim sin tenant no puede tocar el repositorio
      // (denegación explícita 403, no un 500 por excepción).
      if (!claims.tenantId) {
        return {
          success: false,
          response: jsonError(
            "Aislamiento de Tenant Violado: El token no declara tenant.",
            telemetry.traceId,
            403,
            headers,
          ),
        };
      }
      const tenantRecord = await repositoryFactory
        .getTenantRepository()
        .read(claims.tenantId, claims.tenantId);
      if (!tenantRecord)
        return {
          success: false,
          response: jsonError(
            "Aislamiento de Tenant Violado: El Tenant asignado al token no está registrado.",
            telemetry.traceId,
            403,
            headers,
          ),
        };
      const jti = (claims as unknown as Record<string, unknown>).jti;
      if (typeof jti !== "string" || !jti)
        return {
          success: false,
          response: jsonError(
            "Acceso Denegado: token sin identificador de sesión.",
            telemetry.traceId,
            401,
            headers,
          ),
        };
      const { items: sessions } = await repositoryFactory
        .getSessionRepository()
        .list(claims.tenantId, { userId: claims.sub });
      const session = sessions.find((candidate) => {
        const rec = candidate as unknown as Record<string, unknown>;
        return String(rec.tokenJti ?? rec.token_jti ?? "") === jti;
      });
      if (!session) {
        let allowDevelopmentRecovery = false;
        try {
          allowDevelopmentRecovery =
            isExplicitDevelopmentAuth(config()) && claims.role === "SovereignOwner";
        } catch {
          /* Fail closed: recovery remains disabled. */
        }
        if (!allowDevelopmentRecovery)
          return {
            success: false,
            response: jsonError(
              "Acceso Denegado: La sesión asociada al token ya no se encuentra activa en el nodo.",
              telemetry.traceId,
              401,
              headers,
            ),
          };
      }
      const sessionRecord = session as unknown as Record<string, unknown> | undefined;
      if (sessionRecord) {
        const activeFlag = sessionRecord.is_active ?? sessionRecord.isActive;
        if (activeFlag === false)
          return {
            success: false,
            response: jsonError(
              "Acceso Denegado: sesión revocada.",
              telemetry.traceId,
              401,
              headers,
            ),
          };
        const expiresRaw = sessionRecord.expiresAt ?? sessionRecord.expires_at ?? sessionRecord.exp;
        if (expiresRaw !== undefined && expiresRaw !== null) {
          const expiresMillis = sessionExpiryMillis(expiresRaw);
          if (expiresMillis === null || expiresMillis <= Date.now())
            return {
              success: false,
              response: jsonError(
                "Acceso Denegado: sesión expirada o con fecha inválida.",
                telemetry.traceId,
                401,
                headers,
              ),
            };
        }
      }
      const context = new PrincipalContext(
        claims,
        {
          id: tenantRecord.id,
          slug: tenantRecord.slug,
          tier: tenantRecord.tier,
          quotaBalance: tenantRecord.quotaBalance,
        },
        String(sessionRecord?.username ?? ""),
        ip,
        telemetry.traceId,
        telemetry.correlationId,
      );
      return { success: true, context };
    });
  }
}

export function withSovereignAuth(
  resource: Resource,
  action: Action,
  handler: (context: PrincipalContext, request: Request, body?: unknown) => Promise<Response>,
) {
  return async ({ request }: { request: Request }): Promise<Response> => {
    // El turno de chat exige scope de conversación; la ejecución de sistema
    // también (conserva el contrato de scope previo). La lectura de sesión
    // propia no requiere scope adicional: sólo identidad + session:read.
    const requiredScope =
      resource === "chat" || (resource === "system" && action === "execute")
        ? "isabella:chat"
        : undefined;
    const authResult = await PrincipalContext.authorize(request, requiredScope);
    if (!authResult.success) return authResult.response;
    const { context } = authResult;
    const authReq: AuthorizationContext = {
      tenant_id: context.tenantId,
      subject_id: context.userId,
      action,
      resource,
      role: context.role,
      authenticated: true,
      context: {
        ip_address: context.ip,
        user_agent: request.headers.get("user-agent") ?? "unknown",
        timestamp: new Date(),
      },
    };
    // Sin atajos por rol: toda identidad pasa por el PDP centralizado.
    // (Guest chatea mediante el recurso "chat", nunca mediante system/execute.)
    const decisionResult = await evaluateAuthorization(authReq);
    if (!decisionResult.allow)
      return jsonError(
        `Acceso Denegado por Política Centralizada: Privilegios insuficientes para la operación (${resource}:${action}).`,
        context.traceId,
        403,
        SecuritySystem.injectSecureHeaders(new Headers({ "content-type": "application/json" })),
      );
    const { assessIntent, evaluatePolicy, createDefaultContext } = await import("./crown");
    const intent = assessIntent(`API Operation: ${resource}:${action}`);
    const identityAssessment = {
      authenticated: true,
      roles: [context.role],
      permissions: context.scope ? context.scope.split(" ") : [],
      dataScopes: ["territorial"] as ["territorial"],
    };
    const reqContext = createDefaultContext(`API Operation: ${resource}:${action}`, {
      actorId: context.userId,
      sessionId: context.traceId,
    });
    const policyResult = evaluatePolicy(reqContext, intent, identityAssessment);
    if (policyResult.status === "denied")
      return jsonError(
        "Acceso Denegado por CROWN (Constitutional Gate): Operación bloqueada por riesgo estructural.",
        context.traceId,
        403,
        SecuritySystem.injectSecureHeaders(new Headers({ "content-type": "application/json" })),
      );
    let body: unknown = null;
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
      const maxBodyBytes = config().INPUT_MAX_BODY_BYTES;
      if (Number.isFinite(contentLength) && contentLength > maxBodyBytes)
        return jsonError(
          "Payload too large.",
          context.traceId,
          413,
          SecuritySystem.injectSecureHeaders(new Headers({ "content-type": "application/json" })),
        );
      if (request.headers.get("content-type")?.includes("application/json")) {
        try {
          body = await request.clone().json();
        } catch {
          return jsonError("JSON body inválido.", context.traceId, 400, headersForJson());
        }
      }
    }
    return runWithIdentity(context.toRequestIdentity(), () => handler(context, request, body));
  };
}
function headersForJson(): Headers {
  return SecuritySystem.injectSecureHeaders(new Headers({ "content-type": "application/json" }));
}
