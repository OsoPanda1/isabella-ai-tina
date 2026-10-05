import { z } from "zod";
import * as crypto from "node:crypto";
import { config } from "./config";
import { isProductionLike } from "./runtime-mode";
import { JWT_VERIFIER } from "./jwt-verifier";
import { AuthVerificationLayer } from "./auth-verification-layer";

// ============================================================================
// CANONICAL SEVEN LAYERS OF SECURITY HARDENING SYSTEM - ISABELLA v4.2.0
// ============================================================================

function securitySecret(): string {
  const value = config().AUTH_JWT_SECRET;
  if (!value) {
    throw new Error(
      "securitySecret: AUTH_JWT_SECRET no configurado. No se pueden firmar tokens soberanos.",
    );
  }
  return value;
}

const RATE_LIMIT_WINDOW_MS = 60000;
const TENANT_RATE_LIMIT_WINDOW_MS = 60000;
const TENANT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const rateLimitCache = new Map<string, { count: number; windowStart: number }>();
const tenantRateLimitCache = new Map<string, { count: number; windowStart: number }>();
const tenantQuotaCache = new Map<string, { consumed: number; windowStart: number }>();

function isValidIpAddress(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;

  if (candidate.includes(":")) {
    const hextets = candidate.split("::");
    if (hextets.length > 2) return false;
    const left = hextets[0] ? hextets[0].split(":") : [];
    const right = hextets.length === 2 && hextets[1] ? hextets[1].split(":") : [];
    const groups = [...left, ...right];
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return false;
    return hextets.length === 2 ? groups.length < 8 : groups.length === 8;
  }

  const octets = candidate.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^(0|[1-9]\\d{0,2})$/.test(octet) && Number(octet) <= 255)
  );
}

function isProductionLikeRuntime(): boolean {
  try {
    // El modo configurado manda: staging/production/emergency/maintenance
    // conservan fronteras de producción (fail-closed).
    if (config().ISABELLA_RUNTIME_MODE !== "development") return true;
    // Sin modo explícito productivo, cae al guard canónico (NODE_ENV/VERCEL).
    return isProductionLike();
  } catch {
    return true;
  }
}

let redisClient: {
  incr: (key: string) => Promise<number>;
  expire: (key: string, sec: number) => Promise<number>;
  ttl: (key: string) => Promise<number>;
} | null = null;
async function getRedis(): Promise<typeof redisClient> {
  if (redisClient) return redisClient;
  const url = config().REDIS_URL || config().KV_URL;
  if (!url) return null;
  try {
    const mod = (await import("@upstash/redis").catch(() => null)) as unknown as {
      Redis?: new (opts: { url: string; token?: string }) => unknown;
    } | null;
    if (!mod?.Redis) return null;
    const token =
      config().KV_REST_API_TOKEN || config().UPSTASH_REDIS_TOKEN || config().REDIS_TOKEN;
    redisClient = new (
      mod.Redis as unknown as new (opts: Record<string, unknown>) => typeof redisClient
    )({ url, token } as Record<string, unknown>) as typeof redisClient;
    return redisClient;
  } catch {
    return null;
  }
}

export interface SecurityTelemetry {
  traceId: string;
  correlationId: string;
  sanitized: boolean;
  rateLimitRemaining: number;
  policyStatus: "allowed" | "denied" | "flagged";
  checkedLayers: string[];
}

export interface TokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  nbf?: number;
  iat?: number;
  tenantId: string;
  role: string;
  scope: string;
  /** Claim legacy de tenant (Supabase/PostgREST: request.jwt.claims.tenant_id). */
  tenant_id?: string;
  /** Claim legacy de scopes en arreglo (algunos emisores OIDC lo producen así). */
  scopes?: string[];
  jti?: string;
}

export class SecurityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 403,
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * SSRF Host Allowlist
 * Only strictly declared domains are permitted for outbound requests.
 */
const ALLOWED_EXTERNAL_HOSTS = new Set<string>([
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "api.anthropic.com",
  "api.groq.com",
  "api.cohere.ai",
  "api.stripe.com",
  "mux.com",
  "api.mux.com",
  "stream.mux.com",
  "image.mux.com",
  "localhost",
  "127.0.0.1",
]);

export function isAllowedExternalUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    // Protocol must be HTTPS (or HTTP in local test/dev)
    if (url.protocol !== "https:" && (isProductionLike() || url.protocol !== "http:")) {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    // Block private/link-local IPv4 ranges in production
    if (isProductionLike()) {
      if (
        hostname === "localhost" ||
        hostname.startsWith("127.") ||
        hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("169.254.") ||
        hostname.endsWith(".internal") ||
        hostname.endsWith(".local")
      ) {
        return false;
      }
    }
    return ALLOWED_EXTERNAL_HOSTS.has(hostname) || hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

export function validateSsrfSafeUrl(urlString: string): URL {
  if (!isAllowedExternalUrl(urlString)) {
    throw new SecurityError(
      "SSRF_VIOLATION",
      `Outbound request to ${urlString} is rejected by SSRF guard policy.`,
      403,
    );
  }
  return new URL(urlString);
}

/**
 * Rate Limiter Fail-Closed Matrix
 */
interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

const inMemoryRateLimits = new Map<string, { count: number; resetAt: number }>();

export function checkDistributedRateLimit(
  key: string,
  limit: number = 100,
  windowSeconds: number = 60,
): RateLimitStatus {
  const now = Date.now();
  const entry = inMemoryRateLimits.get(key);

  if (!entry || entry.resetAt <= now) {
    inMemoryRateLimits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, resetSeconds: windowSeconds };
  }

  if (entry.count >= limit) {
    const resetSec = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, resetSeconds: resetSec };
  }

  entry.count += 1;
  const resetSec = Math.ceil((entry.resetAt - now) / 1000);
  return { allowed: true, remaining: limit - entry.count, resetSeconds: resetSec };
}

export function sanitizePayload<T>(data: T): T {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) {
    return data.map((item) => sanitizePayload(item)) as unknown as T;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key.toLowerCase().includes("secret") || key.toLowerCase().includes("token")) {
      clean[key] = "[REDACTED]";
    } else {
      clean[key] = typeof value === "object" ? sanitizePayload(value) : value;
    }
  }
  return clean as T;
}

const UPSTREAM_ALLOWLIST: readonly string[] = [
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "api.x.ai",
];

/**
 * Detecta hosts que son literales IP (IPv4, IPv6, decimal/hex ya
 * normalizado por el parser WHATWG). Una IP nunca esta en la allowlist,
 * pero el parser convierte formas como http://2130706433 a 127.0.0.1,
 * asi que se rechaza explicitamente (ISA-184/ISA-187).
 */
function isLiteralIpHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host.includes(":")) return true; // IPv6 (con o sin corchetes)
  const octets = host.split(".");
  const isOctet = (part: string) => part.length > 0 && part.length <= 3 && /^\d+$/.test(part);
  if (octets.length === 4 && octets.every(isOctet)) return true; // IPv4
  if (/^0x[0-9a-f]+$/.test(host) || /^\d+$/.test(host)) return true; // hex/decimal residual
  return false;
}

function isUpstreamAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // ISA-184: canonicalizacion estricta del destino.
  if (parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  // ISA-185: solo el puerto https por defecto (443 implicito o explicito).
  if (parsed.port !== "" && parsed.port !== "443") return false;
  // Coincidencia exacta: sin trailing dot, sin literales IP.
  const host = parsed.hostname.toLowerCase();
  if (host === "" || isLiteralIpHost(host)) return false;
  if (UPSTREAM_ALLOWLIST.includes(host)) return true;
  try {
    const voice = config().VOICE_API_URL;
    if (voice && new URL(voice).hostname.toLowerCase() === host) return true;
  } catch {
    // Sin configuración válida: solo la allowlist estática.
  }
  return false;
}

export const SecuritySystem = {
  // --- LAYER 0: Secure IP Resolver (Trusted Proxy Guard) ---
  // Only explicit proxy contracts are trusted. The legacy boolean mode and
  // arbitrary X-Forwarded-For are fail-closed.
  resolveClientIp(request: Request): string {
    let mode: string;
    try {
      mode = String(config().TRUSTED_PROXY_MODE ?? "")
        .trim()
        .toLowerCase();
    } catch {
      return "unknown";
    }

    const candidate =
      mode === "vercel"
        ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
        : mode === "cloudflare"
          ? request.headers.get("cf-connecting-ip")?.trim()
          : mode === "generic"
            ? request.headers.get("x-real-ip")?.trim()
            : undefined;

    return candidate && isValidIpAddress(candidate) ? candidate : "unknown";
  },

  validateInput<T>(
    schema: z.Schema<T>,
    payload: unknown,
  ): { success: true; data: T } | { success: false; error: string } {
    const result = schema.safeParse(payload);
    if (!result.success) {
      return {
        success: false,
        error:
          "Fallo de Integridad de Datos: El esquema ingresado no cumple los contratos de Isabella.",
      };
    }
    return { success: true, data: result.data };
  },

  checkRateLimit(ip: string, limit: number = 30): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const entry = rateLimitCache.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitCache.set(ip, { count: 1, windowStart: now });
      return { allowed: true, remaining: limit - 1 };
    }
    if (entry.count >= limit) return { allowed: false, remaining: 0 };
    entry.count += 1;
    return { allowed: true, remaining: limit - entry.count };
  },

  async checkRateLimitDistributed(
    ip: string,
    limit: number = 30,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    degraded?: boolean;
    reason?: string;
  }> {
    const redis = await getRedis();
    if (!redis) {
      if (isProductionLikeRuntime()) {
        return {
          allowed: false,
          remaining: 0,
          degraded: true,
          reason: "rate-limit-infrastructure-unavailable",
        };
      }
      return this.checkRateLimit(ip, limit);
    }
    try {
      const key = `ratelimit:${ip}:${Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS)}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
      const remaining = Math.max(0, limit - count);
      return { allowed: count <= limit, remaining };
    } catch {
      if (isProductionLikeRuntime()) {
        return {
          allowed: false,
          remaining: 0,
          degraded: true,
          reason: "rate-limit-infrastructure-unavailable",
        };
      }
      return this.checkRateLimit(ip, limit);
    }
  },

  // --- LAYER 2b: Tenant-scoped Rate Limiting (P0-13) ---
  // Aísla por tenant además de IP para evitar que un tenant abuse
  // consumiendo cuota ajena o burlando límites vía IP rotativa.
  // Fail-closed: tenantId vacío/inválido se deniega.
  checkRateLimitByTenant(
    tenantId: string,
    limit: number = 60,
  ): { allowed: boolean; remaining: number; reason?: string } {
    const tid = typeof tenantId === "string" ? tenantId.trim() : "";
    if (!tid || tid.length === 0 || tid.length > 128) {
      return { allowed: false, remaining: 0, reason: "tenant-required" };
    }
    if (!/^[a-zA-Z0-9_\-:]+$/.test(tid)) {
      return { allowed: false, remaining: 0, reason: "tenant-invalid-format" };
    }
    const now = Date.now();
    const entry = tenantRateLimitCache.get(tid);
    if (!entry || now - entry.windowStart > TENANT_RATE_LIMIT_WINDOW_MS) {
      tenantRateLimitCache.set(tid, { count: 1, windowStart: now });
      return { allowed: true, remaining: limit - 1 };
    }
    if (entry.count >= limit)
      return { allowed: false, remaining: 0, reason: "tenant-rate-limit-exceeded" };
    entry.count += 1;
    return { allowed: true, remaining: limit - entry.count };
  },

  async checkRateLimitByTenantDistributed(
    tenantId: string,
    limit: number = 60,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    degraded?: boolean;
    reason?: string;
  }> {
    const tid = typeof tenantId === "string" ? tenantId.trim() : "";
    if (!tid || tid.length === 0 || tid.length > 128) {
      return { allowed: false, remaining: 0, reason: "tenant-required" };
    }
    if (!/^[a-zA-Z0-9_\-:]+$/.test(tid)) {
      return { allowed: false, remaining: 0, reason: "tenant-invalid-format" };
    }
    const redis = await getRedis();
    if (!redis) {
      if (isProductionLikeRuntime()) {
        return {
          allowed: false,
          remaining: 0,
          degraded: true,
          reason: "rate-limit-infrastructure-unavailable",
        };
      }
      return this.checkRateLimitByTenant(tid, limit);
    }
    try {
      const key = `ratelimit:tenant:${tid}:${Math.floor(Date.now() / TENANT_RATE_LIMIT_WINDOW_MS)}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
      const remaining = Math.max(0, limit - count);
      if (count > limit)
        return { allowed: false, remaining: 0, reason: "tenant-rate-limit-exceeded" };
      return { allowed: true, remaining };
    } catch {
      if (isProductionLikeRuntime()) {
        return {
          allowed: false,
          remaining: 0,
          degraded: true,
          reason: "rate-limit-infrastructure-unavailable",
        };
      }
      return this.checkRateLimitByTenant(tid, limit);
    }
  },

  // --- LAYER 2c: Tenant Quotas (P0-13) ---
  // Cuota diaria por tenant para inferencia/recursos. Ventana deslizante de 24h.
  // Fail-closed: tenant vacío denegado. No consume si excede.
  checkTenantQuota(
    tenantId: string,
    quotaLimit: number = 50_000,
  ): { allowed: boolean; remaining: number; consumed: number; resetAt: number } {
    const tid = typeof tenantId === "string" ? tenantId.trim() : "";
    if (!tid || tid.length === 0) {
      return {
        allowed: false,
        remaining: 0,
        consumed: 0,
        resetAt: Date.now() + TENANT_QUOTA_WINDOW_MS,
      };
    }
    const now = Date.now();
    const entry = tenantQuotaCache.get(tid);
    if (!entry || now - entry.windowStart > TENANT_QUOTA_WINDOW_MS) {
      return {
        allowed: true,
        remaining: quotaLimit,
        consumed: 0,
        resetAt: now + TENANT_QUOTA_WINDOW_MS,
      };
    }
    const remaining = Math.max(0, quotaLimit - entry.consumed);
    return {
      allowed: entry.consumed < quotaLimit,
      remaining,
      consumed: entry.consumed,
      resetAt: entry.windowStart + TENANT_QUOTA_WINDOW_MS,
    };
  },

  consumeTenantQuota(
    tenantId: string,
    cost: number,
    quotaLimit: number = 50_000,
  ): { allowed: boolean; remaining: number; consumed: number; reason?: string } {
    const tid = typeof tenantId === "string" ? tenantId.trim() : "";
    if (!tid || tid.length === 0) {
      return { allowed: false, remaining: 0, consumed: 0, reason: "tenant-required" };
    }
    if (!Number.isFinite(cost) || cost <= 0) {
      return { allowed: false, remaining: 0, consumed: 0, reason: "invalid-cost" };
    }
    const now = Date.now();
    let entry = tenantQuotaCache.get(tid);
    if (!entry || now - entry.windowStart > TENANT_QUOTA_WINDOW_MS) {
      entry = { consumed: 0, windowStart: now };
      tenantQuotaCache.set(tid, entry);
    }
    if (entry.consumed + cost > quotaLimit) {
      return {
        allowed: false,
        remaining: Math.max(0, quotaLimit - entry.consumed),
        consumed: entry.consumed,
        reason: "quota-exceeded",
      };
    }
    entry.consumed += cost;
    return { allowed: true, remaining: quotaLimit - entry.consumed, consumed: entry.consumed };
  },

  getTenantQuotaStatus(
    tenantId: string,
  ): { consumed: number; windowStart: number; resetAt: number } | null {
    const tid = typeof tenantId === "string" ? tenantId.trim() : "";
    if (!tid) return null;
    const entry = tenantQuotaCache.get(tid);
    if (!entry) return null;
    if (Date.now() - entry.windowStart > TENANT_QUOTA_WINDOW_MS) return null;
    return {
      consumed: entry.consumed,
      windowStart: entry.windowStart,
      resetAt: entry.windowStart + TENANT_QUOTA_WINDOW_MS,
    };
  },

  resetTenantQuota(tenantId: string): void {
    const tid = typeof tenantId === "string" ? tenantId.trim() : "";
    if (!tid) return;
    tenantQuotaCache.delete(tid);
  },

  // Utilidad solo para tests: limpia caches de tenant sin exponer mapas internos.
  _clearTenantCachesForTests(): void {
    tenantRateLimitCache.clear();
    tenantQuotaCache.clear();
  },

  /**
   * Genera un token soberano firmado con AUTH_JWT_SECRET para uso general.
   */
  async generateSovereignToken(
    userId: string,
    role: string,
    tenantId: string,
    scope: string,
  ): Promise<string> {
    const payload = {
      iss: "TAMV Online Network Security Hub",
      sub: userId,
      aud: "Isabella S0 Gateway",
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: crypto.randomUUID(),
      tenantId,
      role,
      scope,
    };
    return JWT_VERIFIER.signHs256(payload, securitySecret());
  },

  /**
   * Genera un token RLS (Row Level Security) firmado con SUPABASE_JWT_SECRET
   * para que PostgREST lo valide y pule request.jwt.claims.
   * El secreto legacy es obligatorio: desde que Supabase migró a JWT Signing Keys
   * (ECC P-256), el único secreto compartido que PostgREST acepta para HS256 es
   * el Legacy secret. Sin él, se niega la operación (fail-closed → RLS imposible).
   */
  generateSupabaseRlsToken(userId: string, tenantId: string, scope: string): string {
    const legacy = config().SUPABASE_JWT_SECRET;
    if (!legacy) {
      throw new Error(
        "securitySecret: SUPABASE_JWT_SECRET (Legacy JWT Secret de Supabase) no configurado. " +
          "PostgREST no puede validar tokens soberanos para RLS tenant-scoped (P0-13).",
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: "TAMV Online Network Security Hub",
      sub: userId,
      aud: "Isabella S0 Gateway",
      iat: now,
      exp: now + 3300, // 55 min — algo menor a la hora de sesión
      jti: crypto.randomUUID(),
      // Claims que consumen las políticas RLS (request.jwt.claims):
      role: "authenticated", // rol Postgres real que PostgREST usa al ejecutar
      tenantId, // auth.current_tenant_id() (init_schema.sql)
      tenant_id: tenantId, // aislamiento api_keys (request.jwt.claims.tenant_id)
      scope,
    };
    return JWT_VERIFIER.signHs256(payload, legacy);
  },

  /**
   * Verifica un JWT usando AuthVerificationLayer (nueva arquitectura) o
   * fallback al validación directa con AUTH_JWT_SECRET.
   * Acepta un segundo argumento ctx con metadatos opcionales (ip, traceId, etc.).
   */
  async verifyToken(
    token: string | null,
    ctx?: {
      ip?: string;
      traceId?: string;
      correlationId?: string;
      requiredScope?: string;
      expectedAudience?: string;
    },
  ): Promise<{
    success: boolean;
    claims?: TokenClaims;
    error?: string;
    provider?: string;
  }> {
    // Intento usando AuthVerificationLayer (nueva arquitectura)
    try {
      const outcome = await AuthVerificationLayer.verifyToken(token, ctx);
      if (outcome.success) {
        return { success: true, claims: outcome.claims, provider: "auth-verification-layer" };
      }
    } catch {
      // Continuar con fallback legacy si AuthVerificationLayer falla
    }

    // Fallback legacy: verificación directa con AUTH_JWT_SECRET
    if (!token) {
      return { success: false, error: "Credencial nula: No se proporcionó clave de API." };
    }

    if (token.startsWith("isa_live_")) {
      return {
        success: false,
        error:
          "El formato de token 'isa_live_' ha sido plenamente deprecado por razones de seguridad. Por favor, inicie sesión mediante OIDC/OAuth para obtener un JWT válido.",
      };
    }

    try {
      const res = JWT_VERIFIER.verify(token, {
        key: securitySecret(),
        algorithm: "HS256",
        issuer: "TAMV Online Network Security Hub",
        audiences: ["Isabella S0 Gateway"],
      });

      if (!res.ok) {
        return {
          success: false,
          error:
            res.reason ?? "Firma digital no válida: Manipulación detectada (Integrity violation).",
        };
      }

      return { success: true, claims: res.payload as unknown as TokenClaims };
    } catch {
      return { success: false, error: "No se pudo descifrar la credencial soberana." };
    }
  },

  async verifyApiScope(
    token: string | null,
    requiredScope: string,
  ): Promise<{ allowed: boolean; reason?: string; claims?: TokenClaims }> {
    const verification = await this.verifyToken(token);
    if (!verification.success) {
      return { allowed: false, reason: verification.error ?? "Credencial no válida." };
    }
    const claims = verification.claims!;
    const scopesList = claims.scope.split(" ");
    if (!scopesList.includes(requiredScope)) {
      return {
        allowed: false,
        reason: `Ámbito insuficiente (Scope violation): Requiere '${requiredScope}'.`,
      };
    }
    return { allowed: true, claims };
  },

  // --- LAYER 4: Hardened OWASP Secure Headers (CSP nonces + HSTS preload) ---
  /** Genera nonce criptográfico por-request para CSP (16 bytes → base64). Plan nonces: ver docs/operations/CSP-NONCES.md */
  generateCspNonce(): string {
    return crypto.randomBytes(16).toString("base64");
  },

  /** Construye CSP estricto; si nonce se provee usa 'nonce-<value>' y elimina unsafe-inline en prod. */
  buildCspHeader(nonce?: string): string {
    const production = isProductionLikeRuntime();
    const hasNonce = typeof nonce === "string" && nonce.length >= 16;
    // En producción con nonce: script-src 'self' 'nonce-<value>' (sin unsafe-inline). Fallback dev: permite unsafe-inline solo si no hay nonce.
    const scriptSource = hasNonce
      ? `'self' 'nonce-${nonce}'`
      : production
        ? "'self'"
        : "'self' 'unsafe-inline'";
    return [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "media-src 'self' blob:",
      "connect-src 'self' https://generativelanguage.googleapis.com https://api.groq.com https://api.x.ai https://api.stripe.com https://stream.mux.com https://*.supabase.co",
      "style-src 'self' 'unsafe-inline'",
      `script-src ${scriptSource}`,
      "worker-src 'self' blob:",
      "upgrade-insecure-requests",
    ].join("; ");
  },

  /** HSTS con preload (RFC 6797) — vercel.json + server.ts deben coincidir. Valor canónico: 63072000 (2 años) + includeSubDomains + preload */
  getHstsHeader(): string {
    return "max-age=63072000; includeSubDomains; preload";
  },

  injectSecureHeaders(
    headers: Headers = new Headers(),
    opts?: { nonce?: string; cspNonce?: string },
  ): Headers {
    const nonce = opts?.nonce ?? opts?.cspNonce;
    if (!headers.has("Content-Security-Policy")) {
      headers.set("Content-Security-Policy", this.buildCspHeader(nonce));
      if (nonce) headers.set("X-CSP-Nonce", nonce);
    } else if (nonce && !headers.get("Content-Security-Policy")?.includes("nonce-")) {
      // Si caller pasó nonce pero CSP ya existía sin nonce, expone nonce por header auxiliar para auditoría.
      headers.set("X-CSP-Nonce", nonce);
    }
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("X-XSS-Protection", "0");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Strict-Transport-Security", this.getHstsHeader());
    headers.set("X-Permitted-Cross-Domain-Policies", "none");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    // Never advertise a literal nonce placeholder as if it were a real CSP nonce.
    headers.delete("Content-Security-Policy-Report-Only");
    return headers;
  },

  /** Secret-redactor integration — delega a src/lib/secret-redactor.ts (deterministic redaction). */
  redactSecrets(input: string): string {
    // Fallback inline para evitar ciclo ESM; src/lib/secret-redactor.ts es canónico para logs.
    return input.replace(
      /(\b(?:api[_-]?key|secret|token|password|bearer)\b\s*[:=]\s*["']?)([^\s"']{8,})/gi,
      "$1[REDACTED]",
    );
  },

  UPSTREAM_ALLOWLIST,
  isUpstreamAllowed,

  async fetchSafeUpstream(url: string, options: RequestInit): Promise<Response> {
    if (!isUpstreamAllowed(url)) {
      throw new Error(`[SovereignEgress] Host no autorizado para egress server-side: ${url}.`);
    }
    // ISA-185: los redireccionamientos no se siguen nunca: un 302 podria
    // llevar el request a un host fuera de la allowlist.
    const response = await globalCircuitBreaker.execute(url, {
      ...options,
      redirect: "error",
    });
    // Defensa en profundidad: con redirect:"error" un 3xx no deberia
    // llegar nunca; si llega, el cuerpo se descarta en lugar de propagarse
    // a un host que no fue validado.
    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        `[SovereignEgress] Redireccionamiento inesperado (${response.status}) hacia: ${
          response.headers.get("location") ?? "unknown"
        }.`,
      );
    }
    if (response.url && !isUpstreamAllowed(response.url)) {
      throw new Error(`[SovereignEgress] Destino final no autorizado (redirect): ${response.url}.`);
    }
    return response;
  },

  generateTelemetry(ip: string, policy: "allowed" | "denied" | "flagged"): SecurityTelemetry {
    const traceId = "tr_" + this.simpleHash(crypto.randomUUID()).toUpperCase();
    const correlationId = "corr_" + this.simpleHash(crypto.randomUUID() + "corr").toUpperCase();
    const entry = rateLimitCache.get(ip);
    const maxLimit = 120;
    const rateLimitRemaining = entry ? Math.max(0, maxLimit - entry.count) : maxLimit;
    return {
      traceId,
      correlationId,
      sanitized: true,
      rateLimitRemaining,
      policyStatus: policy,
      checkedLayers: [
        "L1_Integrity",
        "L2_RateLimiter",
        "L3_ScopeGate",
        "L4_OwaspHeaders",
        "L5_CircuitBreaker",
        "L6_TraceTelemetry",
        "L7_ContentFilter",
      ],
    };
  },

  sanitizePayload(text: string): { clean: string; flagged: boolean; reason?: string } {
    const lowercase = text.toLowerCase();
    const hostilePatterns = [
      "<script",
      "javascript:",
      "onload=",
      "onerror=",
      "ignore all previous instructions",
      "ignore previous guidelines",
      "forget your instructions",
      "forget all instructions",
      "reveal your system prompt",
      "system override",
      "drop table",
      "select * from",
      "../",
      "..\\",
      "[system override]",
      "<system>",
      "markdown-injection-bypass",
      "\\u003cscript",
      "\\u002e\\u002e\\u002f",
    ];
    for (const pattern of hostilePatterns) {
      if (lowercase.includes(pattern)) {
        return {
          clean: text.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "[CONTIENE_SCRIPT_VETADO]"),
          flagged: true,
          reason: `Se detectó patrón hostil catalogado: "${pattern}"`,
        };
      }
    }
    return { clean: text, flagged: false };
  },

  hmacSha256(message: string, key: string): string {
    return crypto.createHmac("sha256", key).update(message).digest("hex");
  },

  simpleHash(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 12);
  },
};

export class UpstreamCircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private readonly failureThreshold = 3;
  private readonly recoveryTimeoutMs = 15000;
  private readonly timeoutMs = 8500;

  public getState(): "CLOSED" | "OPEN" | "HALF_OPEN" {
    this.updateState();
    return this.state;
  }

  private updateState() {
    const now = Date.now();
    if (
      this.state === "OPEN" &&
      this.lastFailureTime &&
      now - this.lastFailureTime > this.recoveryTimeoutMs
    ) {
      this.state = "HALF_OPEN";
      console.log("[CircuitBreaker] Cooldown elapsed. Transitioning to HALF_OPEN.");
    }
  }

  public async execute(url: string, options: RequestInit): Promise<Response> {
    this.updateState();
    if (this.state === "OPEN") {
      return new Response(
        JSON.stringify({
          error:
            "Servicio temporalmente deshabilitado: Disyuntor activo (Circuit Breaker OPEN). El núcleo de inferencia está experimentando fallos consecutivos.",
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) this.onSuccess();
      else if (response.status >= 500 || response.status === 429) this.onFailure();
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      this.onFailure();
      if (err instanceof Error && err.name === "AbortError") {
        return new Response(
          JSON.stringify({
            error:
              "Límite de tiempo excedido al comunicarse con el núcleo de inferencia (Timeout protection).",
          }),
          { status: 504, headers: { "content-type": "application/json" } },
        );
      }
      throw err;
    }
  }

  private onSuccess() {
    if (this.state === "HALF_OPEN") {
      console.log("[CircuitBreaker] Success in HALF_OPEN. Resetting state to CLOSED.");
    }
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    console.warn(`[CircuitBreaker] Failure detected. Count: ${this.failureCount}/3.`);
    if (this.state === "CLOSED" && this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      console.error("[CircuitBreaker] Failure threshold exceeded. Breaker tripped to OPEN.");
    } else if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      console.error("[CircuitBreaker] Failure detected in HALF_OPEN. Breaker reverted to OPEN.");
    }
  }
}

export const globalCircuitBreaker = new UpstreamCircuitBreaker();
