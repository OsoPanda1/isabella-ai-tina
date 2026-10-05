/**
 * Isabella — Authentication Middleware
 *
 * Sistema de autenticación con soporte para:
 * - API Key authentication
 * - Session token authentication
 * - HMAC request signing
 * - Role-based access control (RBAC)
 *
 * Autoría: Edwin Oswaldo Castillo Trejo (Anubis Villaseñor)
 * ORCID: 0009-0008-5050-1539
 * Licencia: CC BY 4.0
 */

import crypto from "crypto";
import { verifyHMAC512, verifySignedToken, sha256, createHMAC512 } from "./crypto";
import { validateAPIKey, type APIKeyScope, apiKeyStore } from "./api-keys";

// ============================================================================
// TYPES
// ============================================================================

export interface AuthContext {
  authenticated: boolean;
  method: "api-key" | "session" | "hmac" | "internal";
  subjectId?: string | undefined;
  scopes?: APIKeyScope[] | undefined;
  keyId?: string | undefined;
  sessionId?: string | undefined;
  error?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AuthMiddlewareOptions {
  requiredScopes?: APIKeyScope[];
  allowInternal?: boolean;
  requireAuth?: boolean;
}

export interface HMACRequest {
  method: string;
  path: string;
  timestamp: number;
  body?: string;
  signature: string;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Authenticate a request using API Key.
 */
export function authenticateAPIKey(apiKey: string, requiredScope?: APIKeyScope): AuthContext {
  if (!apiKey) {
    return { authenticated: false, method: "api-key", error: "No API key provided" };
  }

  const storedKeys = apiKeyStore.listActive();
  const result = validateAPIKey(apiKey, storedKeys, requiredScope);

  if (!result.valid) {
    return {
      authenticated: false,
      method: "api-key",
      error: result.error,
    };
  }

  // Update last used timestamp
  if (result.keyId) {
    apiKeyStore.updateLastUsed(result.keyId);
  }

  return {
    authenticated: true,
    method: "api-key",
    keyId: result.keyId,
    scopes: result.scopes,
  };
}

/**
 * Authenticate a request using a session token.
 */
export function authenticateSession(token: string, signingKey: Buffer): AuthContext {
  if (!token) {
    return { authenticated: false, method: "session", error: "No session token provided" };
  }

  const result = verifySignedToken(token, signingKey);

  if (!result.valid || !result.payload) {
    return {
      authenticated: false,
      method: "session",
      error: "Invalid or expired session token",
    };
  }

  return {
    authenticated: true,
    method: "session",
    sessionId: result.payload["jti"] as string,
    subjectId: result.payload["sub"] as string,
    scopes: result.payload["scopes"] as APIKeyScope[],
    metadata: result.payload,
  };
}

/**
 * Authenticate a request using HMAC signature.
 */
export function authenticateHMAC(
  request: HMACRequest,
  secret: Buffer,
  maxAgeMs: number = 300000, // 5 minutes
): AuthContext {
  if (!request.signature) {
    return { authenticated: false, method: "hmac", error: "No HMAC signature provided" };
  }

  // Check timestamp freshness
  const age = Math.abs(Date.now() - request.timestamp);
  if (age > maxAgeMs) {
    return {
      authenticated: false,
      method: "hmac",
      error: "Request timestamp too old",
    };
  }

  // Construct the message to sign
  const message = [
    request.method.toUpperCase(),
    request.path,
    request.timestamp.toString(),
    request.body ? sha256(request.body) : "",
  ].join("\n");

  const isValid = verifyHMAC512(secret, message, request.signature);

  if (!isValid) {
    return {
      authenticated: false,
      method: "hmac",
      error: "Invalid HMAC signature",
    };
  }

  return {
    authenticated: true,
    method: "hmac",
    metadata: { timestamp: request.timestamp },
  };
}

/**
 * Authenticate internal requests (server-to-server).
 */
export function authenticateInternal(internalKey: string, expectedKey: string): AuthContext {
  if (!internalKey || !expectedKey) {
    return { authenticated: false, method: "internal", error: "Missing internal key" };
  }

  const { timingSafeEqual } = crypto;
  const isValid = timingSafeEqual(
    Buffer.from(sha256(internalKey), "hex"),
    Buffer.from(sha256(expectedKey), "hex"),
  );

  if (!isValid) {
    return { authenticated: false, method: "internal", error: "Invalid internal key" };
  }

  return {
    authenticated: true,
    method: "internal",
    scopes: ["*"],
  };
}

// ============================================================================
// AUTHORIZATION
// ============================================================================

/**
 * Check if an auth context has the required scope.
 */
export function hasScope(context: AuthContext, requiredScope: APIKeyScope): boolean {
  if (!context.authenticated) return false;
  if (context.scopes?.includes("*")) return true;
  return context.scopes?.includes(requiredScope) ?? false;
}

/**
 * Check if an auth context has all required scopes.
 */
export function hasAllScopes(context: AuthContext, requiredScopes: APIKeyScope[]): boolean {
  return requiredScopes.every((scope) => hasScope(context, scope));
}

/**
 * Check if an auth context has any of the required scopes.
 */
export function hasAnyScope(context: AuthContext, requiredScopes: APIKeyScope[]): boolean {
  return requiredScopes.some((scope) => hasScope(context, scope));
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Authentication middleware for API routes.
 */
export function authMiddleware(
  request: { headers: Record<string, string>; method: string; path: string; body?: string },
  options: AuthMiddlewareOptions = {},
): AuthContext {
  const { requiredScopes, allowInternal = true, requireAuth = true } = options;

  // 1. Check for API Key in headers
  const apiKey =
    request.headers["x-api-key"] || request.headers["authorization"]?.replace(/^Bearer\s+/i, "");

  if (apiKey) {
    const context = authenticateAPIKey(apiKey, requiredScopes?.[0]);
    if (context.authenticated) {
      if (requiredScopes && !hasAllScopes(context, requiredScopes)) {
        return {
          ...context,
          authenticated: false,
          error: `Missing required scopes: ${requiredScopes.join(", ")}`,
        };
      }
      return context;
    }
    return context;
  }

  // 2. Check for internal key
  if (allowInternal) {
    const internalKey = request.headers["x-internal-key"];
    if (internalKey) {
      const expectedKey = process.env["ISABELLA_INTERNAL_KEY"];
      if (expectedKey) {
        return authenticateInternal(internalKey, expectedKey);
      }
    }
  }

  // 3. No authentication found
  if (requireAuth) {
    return {
      authenticated: false,
      method: "api-key",
      error: "Authentication required",
    };
  }

  return {
    authenticated: false,
    method: "api-key",
    error: "No authentication provided",
  };
}

// ============================================================================
// RATE LIMITING
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();

  check(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now > entry.resetAt) {
      this.limits.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetAt: now + windowMs,
      };
    }

    if (entry.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  }

  reset(key: string): void {
    this.limits.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits) {
      if (now > entry.resetAt) {
        this.limits.delete(key);
      }
    }
  }
}

export const rateLimiter = new RateLimiter();

/**
 * Check rate limits for an API key.
 */
export function checkRateLimit(
  keyId: string,
  limits: { requestsPerMinute?: number; requestsPerHour?: number; requestsPerDay?: number },
): {
  allowed: boolean;
  remaining: { minute: number; hour: number; day: number };
  resetAt: { minute: number; hour: number; day: number };
} {
  const minuteResult = rateLimiter.check(
    `${keyId}:minute`,
    limits.requestsPerMinute ?? 60,
    60 * 1000,
  );
  const hourResult = rateLimiter.check(
    `${keyId}:hour`,
    limits.requestsPerHour ?? 1000,
    60 * 60 * 1000,
  );
  const dayResult = rateLimiter.check(
    `${keyId}:day`,
    limits.requestsPerDay ?? 10000,
    24 * 60 * 60 * 1000,
  );

  return {
    allowed: minuteResult.allowed && hourResult.allowed && dayResult.allowed,
    remaining: {
      minute: minuteResult.remaining,
      hour: hourResult.remaining,
      day: dayResult.remaining,
    },
    resetAt: {
      minute: minuteResult.resetAt,
      hour: hourResult.resetAt,
      day: dayResult.resetAt,
    },
  };
}

// ============================================================================
// SECURITY UTILITIES
// ============================================================================

/**
 * Sanitize a string for safe logging.
 */
export function sanitizeForLogging(input: string): string {
  return input
    .replace(/[^\w\s@.\-]/g, "") // Remove special chars
    .substring(0, 200); // Limit length
}

/**
 * Redact sensitive fields from an object.
 */
export function redactSensitiveFields(
  obj: Record<string, unknown>,
  fields: string[] = ["password", "secret", "key", "token"],
): Record<string, unknown> {
  const result = { ...obj };
  for (const field of fields) {
    if (field in result) {
      result[field] = "[REDACTED]";
    }
  }
  return result;
}

/**
 * Validate a request timestamp is within acceptable range.
 */
export function isTimestampValid(timestamp: number, maxAgeMs: number = 300000): boolean {
  const age = Math.abs(Date.now() - timestamp);
  return age <= maxAgeMs;
}

/**
 * Generate a request signature for HMAC authentication.
 */
export function signRequest(
  method: string,
  path: string,
  body: string | undefined,
  secret: Buffer,
): { timestamp: number; signature: string } {
  const timestamp = Date.now();
  const message = [method.toUpperCase(), path, timestamp.toString(), body ? sha256(body) : ""].join(
    "\n",
  );

  return {
    timestamp,
    signature: createHMAC512(secret, message),
  };
}
