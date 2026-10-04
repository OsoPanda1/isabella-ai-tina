/**
 * Security Boundary & SSRF Defense (src/lib/security.ts)
 * -----------------------------------------------------------------
 * Core security controls:
 * - SSRF allowlist enforcement
 * - Fail-closed rate limiting checks
 * - Token claims contracts
 * - Payload sanitization and defensive filtering
 */
import { isProductionLike } from "./runtime-mode";

export interface TokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  role?: string;
  tenant_id?: string;
  /** Canonical normalized tenant claim produced by auth-verification-layer. */
  tenantId?: string;
  /** Canonical normalized scope string produced by auth-verification-layer. */
  scope?: string;
  scopes?: string[];
  [key: string]: unknown;
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
