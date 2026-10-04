/**
 * CAPA DE VERIFICACIÓN JWKS/OIDC Y AUDITORÍA DE AUTENTICACIÓN (src/lib/auth-verification-layer.ts)
 * -----------------------------------------------------------------
 * Proporciona verificación criptográfica rigurosa de proveedores OIDC/JWKS,
 * prevención activa de suplantación de identidad (Anti-Spoofing), validación de integridad
 * de sesión y auditoría append-only encadenada criptográficamente (Severidades S0-S3).
 *
 * Principios de Seguridad (Zero Trust):
 * 1. Prevención de Confusión de Algoritmos: Rechaza 'none' y prohíbe evaluar
 *    tokens asimétricos (RS256) con claves simétricas (HMAC) o viceversa.
 * 2. Whitelist Estricta de Emisores (Issuers): Solo se admiten proveedores OIDC
 *    explícitamente autorizados (AUTH_ISSUER, Supabase, Google, Sovereign Hub).
 * 3. Restricción Estricta de Audiencias (Audience Restriction): Los tokens deben
 *    tener como público destinatario 'isabella' / 'Isabella S0 Gateway' / Client ID.
 * 4. Integridad Criptográfica de Claves (JWKS): Resolución dinámica por 'kid'
 *    con caché TTL, protección contra agotamiento de recursos y refresco controlado.
 * 5. Prevención de Escalado de Privilegios: Mapeo seguro de roles; los tokens
 *    externos nunca pueden autoasignarse 'SovereignOwner' arbitrariamente sin
 *    validación de tenant soberano.
 * 6. Auditoría Inmutable: Registro de cada verificación exitosa, advertencia o
 *    intento de intrusión/spoofing en el AuditStore encadenado por SHA-256.
 */

import * as crypto from "node:crypto";
import { config } from "./config";
import { createJwksCache, type JwksCache } from "./jwks-cache";
import { verifyJwt, type JwtClaims, type JwtHeader } from "./jwt-verifier";
import { jwkToPem } from "./oidc";
import { createAuditRepository, type AuditSeverity } from "./repositories/audit-repository";
import { mapSupabaseRole } from "./supabase-auth";
import { ROLES, type Role } from "./rbac";
import type { TokenClaims } from "./security";

export type AuthProviderType = "internal_sovereign" | "oidc_jwks" | "supabase_auth";

export type AuthFailureReasonCode =
  | "TOKEN_MISSING"
  | "FORMAT_INVALID"
  | "ALGORITHM_NONE_FORBIDDEN"
  | "ALGORITHM_CONFUSION"
  | "UNTRUSTED_ISSUER"
  | "SIGNATURE_TAMPERED"
  | "TOKEN_EXPIRED"
  | "TOKEN_NOT_YET_VALID"
  | "AUDIENCE_MISMATCH"
  | "SUBJECT_MISSING"
  | "TENANT_MISSING"
  | "JWKS_KEY_NOT_FOUND"
  | "PRIVILEGE_SPOOFING_ATTEMPT"
  | "CRYPTO_ERROR";

export interface AuthVerificationContext {
  ip?: string;
  traceId?: string;
  correlationId?: string;
  requiredScope?: string;
  expectedAudience?: string;
  tenantId?: string;
}

export interface AuthVerificationSuccess {
  success: true;
  provider: AuthProviderType;
  claims: TokenClaims;
  identity: {
    userId: string;
    tenantId: string;
    role: string;
    scope: string;
    email?: string;
    username?: string;
  };
  auditSeverity: "S3";
  traceId: string;
  correlationId: string;
}

export interface AuthVerificationFailure {
  success: false;
  error: string;
  spoofingAttempt: boolean;
  auditSeverity: AuditSeverity;
  traceId: string;
  correlationId: string;
  reasonCode: AuthFailureReasonCode;
}

export type AuthVerificationOutcome = AuthVerificationSuccess | AuthVerificationFailure;

export interface TrustedOidcProviderConfig {
  issuer: string;
  jwksUri?: string;
  audience?: string;
  name?: string;
}

class AuthVerificationLayerImpl {
  private auditRepo = createAuditRepository();
  private jwksCaches = new Map<string, JwksCache>();
  private customTrustedProviders = new Map<string, TrustedOidcProviderConfig>();

  /**
   * Resuelve los emisores autorizados dinámicamente desde la configuración activa.
   */
  public getTrustedIssuers(): string[] {
    const cfg = config();
    const issuers = new Set<string>();

    // Emisor soberano interno
    issuers.add("TAMV Online Network Security Hub");
    issuers.add("isabella.sovereign");

    // Emisor OIDC canónico configurado en env
    if (cfg.AUTH_ISSUER) {
      issuers.add(cfg.AUTH_ISSUER.replace(/\/+$/, ""));
    }

    // Emisor Supabase si está configurado
    if (cfg.SUPABASE_URL) {
      const base = cfg.SUPABASE_URL.replace(/\/+$/, "");
      issuers.add(`${base}/auth/v1`);
      issuers.add(base);
    }

    // Proveedores personalizados registrados
    for (const [iss] of this.customTrustedProviders) {
      issuers.add(iss.replace(/\/+$/, ""));
    }

    return Array.from(issuers);
  }

  /**
   * Registra un proveedor OIDC confiable para entornos federados.
   */
  public registerTrustedProvider(provider: TrustedOidcProviderConfig): void {
    const norm = provider.issuer.replace(/\/+$/, "");
    this.customTrustedProviders.set(norm, { ...provider, issuer: norm });
  }

  /**
   * Obtiene o inicializa la caché JWKS para un emisor específico.
   */
  private getJwksCacheForIssuer(issuer: string, customJwksUri?: string): JwksCache {
    const norm = issuer.replace(/\/+$/, "");
    let cache = this.jwksCaches.get(norm);
    if (!cache) {
      const cfg = config();
      const ttlMs = (cfg.JWKS_CACHE_TTL ?? 3600) * 1000;
      // Si se define OIDC_JWKS_URL global o customJwksUri
      const effectiveJwksUri =
        customJwksUri ||
        (cfg.AUTH_ISSUER && norm === cfg.AUTH_ISSUER.replace(/\/+$/, "")
          ? cfg.OIDC_JWKS_URL
          : undefined);

      if (effectiveJwksUri) {
        // JwksCache usa `${issuer}/.well-known/jwks.json`, si se pasa URI directa la adaptamos
        const urlObj = new URL(effectiveJwksUri);
        const derivedBase = urlObj.pathname.endsWith("/.well-known/jwks.json")
          ? `${urlObj.origin}${urlObj.pathname.replace(/\/\.well-known\/jwks\.json$/, "")}`
          : norm;
        cache = createJwksCache(derivedBase, { ttlMs });
      } else {
        cache = createJwksCache(norm, { ttlMs });
      }
      this.jwksCaches.set(norm, cache);
    }
    return cache;
  }

  /**
   * Decodifica de forma segura la cabecera del JWT sin confiar en su firma aún.
   */
  private inspectHeader(
    token: string,
  ): { ok: true; header: Partial<JwtHeader> } | { ok: false; reason: string } {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { ok: false, reason: "Formato JWT inválido (se esperan 3 segmentos)." };
    }
    const [headerB64] = parts;
    try {
      const normalized = headerB64.replace(/-/g, "+").replace(/_/g, "/");
      const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
      const json = Buffer.from(normalized + pad, "base64").toString("utf-8");
      const header = JSON.parse(json) as Partial<JwtHeader>;
      return { ok: true, header };
    } catch {
      return { ok: false, reason: "Cabecera JWT corrupta o no parseable." };
    }
  }

  /**
   * Decodifica el payload sin verificar para inspeccionar claims de emisor/sujeto antes de resolver la clave.
   */
  private inspectPayload(
    token: string,
  ): { ok: true; payload: Partial<JwtClaims> } | { ok: false; reason: string } {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { ok: false, reason: "Formato JWT inválido." };
    }
    const [, payloadB64] = parts;
    try {
      const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
      const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
      const json = Buffer.from(normalized + pad, "base64").toString("utf-8");
      const payload = JSON.parse(json) as Partial<JwtClaims>;
      return { ok: true, payload };
    } catch {
      return { ok: false, reason: "Payload JWT corrupto." };
    }
  }

  /**
   * Verifica un token JWT mediante la cadena de confianza soberana y JWKS/OIDC.
   * Aplica defensas estrictas contra suplantación de identidad (Anti-Spoofing) y auditoría inmutable.
   */
  public async verifyToken(
    token: string | null | undefined,
    ctx: AuthVerificationContext = {},
  ): Promise<AuthVerificationOutcome> {
    const traceId = ctx.traceId || `tr_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const correlationId =
      ctx.correlationId || `corr_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const actorIp = ctx.ip || "127.0.0.1";

    if (!token || typeof token !== "string" || !token.trim()) {
      return this.fail({
        traceId,
        correlationId,
        actorIp,
        error: "Credencial ausente o nula.",
        reasonCode: "TOKEN_MISSING",
        spoofingAttempt: false,
        severity: "S2",
      });
    }

    if (token.startsWith("isa_live_")) {
      return this.fail({
        traceId,
        correlationId,
        actorIp,
        error:
          "El formato de token 'isa_live_' ha sido plenamente deprecado. Inicie sesión mediante OIDC/OAuth.",
        reasonCode: "FORMAT_INVALID",
        spoofingAttempt: false,
        severity: "S2",
      });
    }

    // 1. Inspeccionar cabecera
    const headerResult = this.inspectHeader(token);
    if (!headerResult.ok) {
      return this.fail({
        traceId,
        correlationId,
        actorIp,
        error: headerResult.reason,
        reasonCode: "FORMAT_INVALID",
        spoofingAttempt: true,
        severity: "S1",
      });
    }

    const { header } = headerResult;
    const alg = header.alg;

    // 2. Prevención de ataque 'alg: none'
    if (!alg || alg.toLowerCase() === "none") {
      return this.fail({
        traceId,
        correlationId,
        actorIp,
        error:
          "Ataque detectado: Algoritmo 'none' estrictamente prohibido por política Sovereign Zero-Trust.",
        reasonCode: "ALGORITHM_NONE_FORBIDDEN",
        spoofingAttempt: true,
        severity: "S0",
      });
    }

    // 3. Inspeccionar payload preliminar (iss, aud, sub)
    const payloadResult = this.inspectPayload(token);
    if (!payloadResult.ok) {
      return this.fail({
        traceId,
        correlationId,
        actorIp,
        error: payloadResult.reason,
        reasonCode: "FORMAT_INVALID",
        spoofingAttempt: true,
        severity: "S1",
      });
    }

    const rawPayload = payloadResult.payload;
    const tokenIssuer =
      typeof rawPayload.iss === "string" ? rawPayload.iss.replace(/\/+$/, "") : "";
    const trustedIssuers = this.getTrustedIssuers();

    // 4. Verificación de Emisor (Issuer Whitelist & Anti-Spoofing)
    if (!tokenIssuer) {
      return this.fail({
        traceId,
        correlationId,
        actorIp,
        error: "Suplantación rechazada: Falta el emisor 'iss' en el token.",
        reasonCode: "UNTRUSTED_ISSUER",
        spoofingAttempt: true,
        severity: "S0",
      });
    }

    const isTrustedIssuer = trustedIssuers.some(
      (ti) => ti.toLowerCase() === tokenIssuer.toLowerCase(),
    );
    if (!isTrustedIssuer) {
      return this.fail({
        traceId,
        correlationId,
        actorIp,
        error: `Suplantación rechazada: Emisor '${tokenIssuer}' no reconocido ni autorizado en la lista de confianza soberana.`,
        reasonCode: "UNTRUSTED_ISSUER",
        spoofingAttempt: true,
        severity: "S0",
      });
    }

    // 5. Determinación de la ruta criptográfica según algoritmo y emisor
    const cfg = config();
    const isInternalIssuer =
      tokenIssuer === "TAMV Online Network Security Hub" || tokenIssuer === "isabella.sovereign";

    if (alg === "HS256") {
      // Prevención de Confusión de Algoritmo:
      // Tokens externos de OIDC NUNCA deben verificarse con secreto simétrico HMAC local
      if (!isInternalIssuer) {
        return this.fail({
          traceId,
          correlationId,
          actorIp,
          error: `Intento de ataque por confusión de algoritmos: Emisor externo '${tokenIssuer}' intentó autenticar con clave simétrica HS256.`,
          reasonCode: "ALGORITHM_CONFUSION",
          spoofingAttempt: true,
          severity: "S0",
        });
      }

      const secret = cfg.AUTH_JWT_SECRET;
      if (!secret) {
        return this.fail({
          traceId,
          correlationId,
          actorIp,
          error: "Error interno del servidor: AUTH_JWT_SECRET no configurado.",
          reasonCode: "CRYPTO_ERROR",
          spoofingAttempt: false,
          severity: "S1",
        });
      }

      const verified = verifyJwt(token, {
        key: secret,
        algorithm: "HS256",
        issuer: tokenIssuer,
        audiences: ctx.expectedAudience
          ? [ctx.expectedAudience]
          : ["Isabella S0 Gateway", cfg.AUTH_AUDIENCE || "isabella"],
      });

      if (!verified.ok) {
        const isExpired = verified.reason.includes("expirado");
        return this.fail({
          traceId,
          correlationId,
          actorIp,
          error: verified.reason,
          reasonCode: isExpired ? "TOKEN_EXPIRED" : "SIGNATURE_TAMPERED",
          spoofingAttempt: !isExpired,
          severity: isExpired ? "S2" : "S1",
        });
      }

      return this.succeed({
        traceId,
        correlationId,
        actorIp,
        provider: "internal_sovereign",
        payload: verified.payload,
      });
    }

    if (alg === "RS256") {
      // 6. Verificación Asimétrica con JWKS / OIDC Provider
      const customConfig = this.customTrustedProviders.get(tokenIssuer);
      const jwksCache = this.getJwksCacheForIssuer(tokenIssuer, customConfig?.jwksUri);

      let keyPem: string;
      try {
        const jwkKey = await jwksCache.keyByKid(header.kid);
        keyPem = jwkToPem(jwkKey);
      } catch (err) {
        return this.fail({
          traceId,
          correlationId,
          actorIp,
          error: `Error al resolver clave pública JWKS para kid '${header.kid ?? "(sin kid)"}': ${err instanceof Error ? err.message : String(err)}`,
          reasonCode: "JWKS_KEY_NOT_FOUND",
          spoofingAttempt: true,
          severity: "S1",
        });
      }

      const expectedAudiences = [
        ctx.expectedAudience || cfg.AUTH_AUDIENCE || "isabella",
        "Isabella S0 Gateway",
        ...(customConfig?.audience ? [customConfig.audience] : []),
      ];

      const verified = verifyJwt(token, {
        key: keyPem,
        algorithm: "RS256",
        issuer: tokenIssuer,
        audiences: expectedAudiences,
      });

      if (!verified.ok) {
        const isExpired = verified.reason.includes("expirado");
        return this.fail({
          traceId,
          correlationId,
          actorIp,
          error: `Firma OIDC/JWKS inválida: ${verified.reason}`,
          reasonCode: isExpired ? "TOKEN_EXPIRED" : "SIGNATURE_TAMPERED",
          spoofingAttempt: !isExpired,
          severity: isExpired ? "S2" : "S1",
        });
      }

      // Mapeo seguro de identidad y prevención de escalado de privilegios
      const p = verified.payload;
      const isSupabase = tokenIssuer.includes("supabase.co") || tokenIssuer.includes("/auth/v1");
      const rawTenantId =
        (p.tenantId as string | undefined) ??
        ((p.app_metadata as Record<string, unknown> | undefined)?.tenant_id as string | undefined);
      if (typeof rawTenantId !== "string" || rawTenantId.trim().length === 0) {
        return this.fail({
          traceId,
          correlationId,
          actorIp,
          error: "Credencial rechazada: el token autenticado no demuestra un tenant explícito.",
          reasonCode: "TENANT_MISSING",
          spoofingAttempt: true,
          severity: "S0",
        });
      }
      const providerType: AuthProviderType = isSupabase ? "supabase_auth" : "oidc_jwks";

      // Control Anti-Spoofing de Roles:
      // - Un rol desconocido/ausente degrada a Guest, nunca a Operator
      //   (que tiene tool:execute, sandbox:run y monetización).
      // - Un emisor EXTERNO (OIDC de terceros) sólo puede declarar roles de
      //   la allowlist: jamás governance_admin ni SovereignOwner. La
      //   administración de gobernanza/permisos no viene de un IdP ajeno.
      const EXTERNAL_ISSUER_ROLES: readonly string[] = ["Guest", "Auditor", "Operator"];
      const rawRole =
        (p.role as unknown) ?? (p.app_metadata as Record<string, unknown> | undefined)?.role;
      // Normalización case-insensitive: los IdP suelen emitir "operator".
      const normalizedRole =
        typeof rawRole === "string"
          ? (ROLES.find((role) => role.toLowerCase() === rawRole.trim().toLowerCase()) as
              Role | undefined)
          : undefined;
      const roleAllowed =
        normalizedRole !== undefined &&
        (isInternalIssuer || isSupabase || EXTERNAL_ISSUER_ROLES.includes(normalizedRole));
      const mappedRole: Role = isSupabase
        ? mapSupabaseRole(rawRole)
        : normalizedRole && roleAllowed
          ? normalizedRole
          : "Guest";

      const normalizedClaims: TokenClaims = {
        iss: p.iss ?? tokenIssuer,
        sub: p.sub,
        aud: Array.isArray(p.aud) ? p.aud.join(" ") : String(p.aud ?? "isabella"),
        exp: p.exp ?? Math.floor(Date.now() / 1000) + 3600,
        tenantId: rawTenantId.trim(),
        role: mappedRole,
        scope: typeof p.scope === "string" ? p.scope : "isabella:chat",
        jti: (p.jti as string) ?? `oidc_${crypto.randomUUID().slice(0, 12)}`,
      };

      return this.succeed({
        traceId,
        correlationId,
        actorIp,
        provider: providerType,
        payload: normalizedClaims as unknown as JwtClaims,
      });
    }

    // Algoritmo no soportado
    return this.fail({
      traceId,
      correlationId,
      actorIp,
      error: `Algoritmo criptográfico '${alg}' no permitido por la política Sovereign Zero-Trust.`,
      reasonCode: "ALGORITHM_CONFUSION",
      spoofingAttempt: true,
      severity: "S0",
    });
  }

  private async fail(params: {
    traceId: string;
    correlationId: string;
    actorIp: string;
    error: string;
    reasonCode: AuthFailureReasonCode;
    spoofingAttempt: boolean;
    severity: Exclude<AuditSeverity, "S3">;
  }): Promise<AuthVerificationFailure> {
    const eventName = params.spoofingAttempt
      ? `AUTH_SPOOFING_PREVENTED_${params.reasonCode}`
      : `AUTH_FAILURE_${params.reasonCode}`;

    try {
      await this.auditRepo.append({
        traceId: params.traceId,
        correlationId: params.correlationId,
        actorIp: params.actorIp,
        event: eventName,
        severity: params.severity,
        details: JSON.stringify({
          error: params.error,
          reasonCode: params.reasonCode,
          spoofingAttempt: params.spoofingAttempt,
          timestamp: new Date().toISOString(),
        }),
        remediated: true, // Bloqueado activamente por la capa de verificación
      });
    } catch (err) {
      console.error("[AuthVerificationLayer] Error al persistir evento de auditoría:", err);
    }

    return {
      success: false,
      error: params.error,
      spoofingAttempt: params.spoofingAttempt,
      auditSeverity: params.severity,
      traceId: params.traceId,
      correlationId: params.correlationId,
      reasonCode: params.reasonCode,
    };
  }

  private async succeed(params: {
    traceId: string;
    correlationId: string;
    actorIp: string;
    provider: AuthProviderType;
    payload: JwtClaims;
  }): Promise<AuthVerificationSuccess | AuthVerificationFailure> {
    const p = params.payload;
    const tenantId =
      typeof p.tenantId === "string" && p.tenantId.trim()
        ? p.tenantId.trim()
        : typeof (p as Record<string, unknown>).tenant_id === "string" &&
            String((p as Record<string, unknown>).tenant_id).trim()
          ? String((p as Record<string, unknown>).tenant_id).trim()
          : "";

    if (!tenantId) {
      return this.fail({
        traceId: params.traceId,
        correlationId: params.correlationId,
        actorIp: params.actorIp,
        error: "Credencial rechazada: el token verificado no contiene un tenant explícito.",
        reasonCode: "TENANT_MISSING",
        spoofingAttempt: true,
        severity: "S0",
      });
    }

    const claims: TokenClaims = {
      iss: p.iss ?? "unknown",
      sub: p.sub,
      aud: Array.isArray(p.aud) ? p.aud.join(" ") : String(p.aud ?? "isabella"),
      exp: p.exp ?? Math.floor(Date.now() / 1000) + 3600,
      tenantId,
      role:
        typeof p.role === "string" && (ROLES as readonly string[]).includes(p.role)
          ? p.role
          : "Guest",
      scope: (p.scope as string) ?? "isabella:chat",
      jti: (p.jti as string) ?? `jti_${crypto.randomUUID().slice(0, 8)}`,
    };

    try {
      await this.auditRepo.append({
        traceId: params.traceId,
        correlationId: params.correlationId,
        actorIp: params.actorIp,
        event: `AUTH_SUCCESS_${params.provider.toUpperCase()}`,
        severity: "S3",
        details: JSON.stringify({
          provider: params.provider,
          sub: claims.sub,
          tenantId: claims.tenantId,
          role: claims.role,
          scope: claims.scope,
          jti: claims.jti,
        }),
        remediated: false,
      });
    } catch (err) {
      console.error("[AuthVerificationLayer] Error al persistir evento de éxito:", err);
    }

    return {
      success: true,
      provider: params.provider,
      claims,
      identity: {
        userId: claims.sub,
        tenantId: claims.tenantId,
        role: claims.role,
        scope: claims.scope,
        email: typeof p.email === "string" ? p.email : undefined,
        username: typeof p.username === "string" ? p.username : undefined,
      },
      auditSeverity: "S3",
      traceId: params.traceId,
      correlationId: params.correlationId,
    };
  }

  /**
   * Limpia cachés de JWKS para pruebas o rotación de claves forzada.
   */
  public resetJwksCache(): void {
    for (const [, cache] of this.jwksCaches) {
      cache.reset();
    }
    this.jwksCaches.clear();
  }
}

export const AuthVerificationLayer = new AuthVerificationLayerImpl();
