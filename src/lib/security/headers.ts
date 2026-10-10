/**
 * Isabella — Security Headers & Input Sanitization
 *
 * Headers de seguridad HTTP, sanitización de entrada,
 * protección contra XSS, CSRF, inyección y más.
 *
 * Autoría: Edwin Oswaldo Castillo Trejo (Anubis Villaseñor)
 * ORCID: 0009-0008-5050-1539
 * Licencia: CC BY 4.0
 */

import { randomBytes } from "crypto";

// ============================================================================
// SECURITY HEADERS
// ============================================================================

export interface SecurityHeaders {
  [key: string]: string;
}

/**
 * Get all security headers for HTTP responses.
 */
export function getSecurityHeaders(): SecurityHeaders {
  return {
    // Content Security Policy
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co https://ai.gateway.lovable.dev",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; "),

    // Prevent clickjacking
    "X-Frame-Options": "DENY",

    // Prevent MIME type sniffing
    "X-Content-Type-Options": "nosniff",

    // XSS Protection (legacy browsers)
    "X-XSS-Protection": "1; mode=block",

    // Referrer Policy
    "Referrer-Policy": "strict-origin-when-cross-origin",

    // Permissions Policy
    "Permissions-Policy": [
      "accelerometer=()",
      "ambient-light-sensor=()",
      "autoplay=()",
      "battery=()",
      "camera=()",
      "display-capture=()",
      "document-domain=()",
      "encrypted-media=()",
      "execution-while-not-rendered=()",
      "execution-while-out-of-viewport=()",
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "navigation-override=()",
      "payment=()",
      "picture-in-picture=()",
      "publickey-credentials-get=()",
      "screen-wake-lock=()",
      "sync-xhr=(self)",
      "usb=()",
      "web-share=()",
      "xr-spatial-tracking=()",
    ].join(", "),

    // HSTS (if HTTPS)
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",

    // Cache Control for sensitive endpoints
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",

    // Prevent cross-origin attacks
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  };
}

/**
 * Get CSP nonce for inline scripts.
 */
export function generateCSPNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * Build CSP header with nonce.
 */
export function getCSPWithNonce(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co https://ai.gateway.lovable.dev",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

// ============================================================================
// INPUT SANITIZATION
// ============================================================================

/**
 * Sanitize a string to prevent XSS.
 */
export function sanitizeXSS(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Sanitize HTML to remove all tags.
 */
export function stripHTML(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

/**
 * Sanitize a filename.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_") // Allow only safe chars
    .replace(/_{2,}/g, "_") // Collapse multiple underscores
    .replace(/^_+|_+$/g, "") // Remove leading/trailing underscores
    .substring(0, 255); // Limit length
}

/**
 * Sanitize a SQL string (basic escaping).
 * WARNING: Use parameterized queries instead!
 */
export function sanitizeSQL(input: string): string {
  return input
    .replace(/'/g, "''")
    .replace(/"/g, '""')
    .replace(/;/g, "")
    .replace(/--/g, "")
    .replace(/\/\*/g, "")
    .replace(/\*\//g, "");
}

/**
 * Sanitize a URL.
 */
export function sanitizeURL(url: string): string {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

/**
 * Sanitize user input for general use.
 */
export function sanitizeInput(
  input: string,
  options?: {
    maxLength?: number;
    allowHTML?: boolean;
    trimWhitespace?: boolean;
  },
): string {
  const maxLength = options?.maxLength ?? 10000;
  const allowHTML = options?.allowHTML ?? false;
  const trimWhitespace = options?.trimWhitespace ?? true;

  let sanitized = input;

  if (trimWhitespace) {
    sanitized = sanitized.trim();
  }

  if (!allowHTML) {
    sanitized = sanitizeXSS(sanitized);
  }

  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate an email address.
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validate a UUID.
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate a hex string.
 */
export function isValidHex(hex: string, length?: number): boolean {
  const hexRegex = /^[0-9a-f]+$/i;
  if (!hexRegex.test(hex)) return false;
  if (length && hex.length !== length) return false;
  return true;
}

/**
 * Validate a base64 string.
 */
export function isValidBase64(str: string): boolean {
  try {
    return btoa(atob(str)) === str;
  } catch {
    return false;
  }
}

/**
 * Validate a base64url string.
 */
export function isValidBase64URL(str: string): boolean {
  const base64URLRegex = /^[A-Za-z0-9_-]+$/;
  return base64URLRegex.test(str);
}

/**
 * Validate JSON string.
 */
export function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// RATE LIMITING HELPERS
// ============================================================================

/**
 * Get client IP from request headers.
 */
export function getClientIP(headers: Record<string, string>): string {
  return (
    headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    headers["x-real-ip"] ||
    headers["cf-connecting-ip"] ||
    "unknown"
  );
}

/**
 * Generate a rate limit key from IP and endpoint.
 */
export function getRateLimitKey(ip: string, endpoint: string): string {
  return `${ip}:${endpoint}`;
}

// ============================================================================
// LOGGING SECURITY
// ============================================================================

/**
 * Sanitize data for logging (remove sensitive fields).
 */
export function sanitizeForLogging(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = [
    "password",
    "secret",
    "key",
    "token",
    "apiKey",
    "api_key",
    "authorization",
    "cookie",
    "session",
    "credentials",
  ];

  const sanitized = { ...data };

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = "[REDACTED]";
    }
  }

  return sanitized;
}

/**
 * Create a secure log entry.
 */
export function createSecureLogEntry(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  data?: Record<string, unknown>,
): {
  timestamp: string;
  level: string;
  message: string;
  data?: Record<string, unknown> | undefined;
} {
  return {
    timestamp: new Date().toISOString(),
    level,
    message: sanitizeXSS(message),
    data: data ? sanitizeForLogging(data) : undefined,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export const SECURITY_CONSTANTS = {
  MAX_INPUT_LENGTH: 10000,
  MAX_FILENAME_LENGTH: 255,
  MAX_EMAIL_LENGTH: 254,
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_MAX_REQUESTS: 60,
  CSRF_TOKEN_LENGTH: 32,
  SESSION_TOKEN_LENGTH: 48,
  API_KEY_PREFIX: "isa_",
} as const;
