import type { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyNativeJwt } from "./native-auth";
import { validateApiKey } from "./api-keys";
import { config } from "./config";

export type IsabellaRole = "viewer" | "citizen" | "operator" | "admin" | "system";

export interface AuthenticatedPrincipal {
  sub: string;
  tenantId: string;
  roles: IsabellaRole[];
  plan?: string;
  scopes: string[];
  exp?: number;
  iss?: string;
  kind?: "jwt" | "api-key";
  apiKeyId?: string;
}

declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}

const roleRank: Record<IsabellaRole, number> = {
  viewer: 0,
  citizen: 1,
  operator: 2,
  admin: 3,
  system: 4,
};

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(
    normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "="),
    "base64",
  );
}

function safeJson<T>(buf: Buffer): T | null {
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function verifyHs256Jwt(token: string, secret: string): AuthenticatedPrincipal | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = safeJson<{ alg?: string; typ?: string }>(base64UrlDecode(encodedHeader));
  if (header?.alg !== "HS256") return null;
  const expected = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const actual = base64UrlDecode(encodedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const payload = safeJson<any>(base64UrlDecode(encodedPayload));
  if (!payload?.sub || typeof payload.sub !== "string") return null;
  if (payload.exp && Number(payload.exp) * 1000 <= Date.now()) return null;
  // Validate issuer and audience if present
  if (payload.iss && payload.iss !== "isabella-native-auth" && payload.iss !== "isabella-external")
    return null;
  if (payload.aud && payload.aud !== "isabella-api") return null;
  const roles = Array.isArray(payload.roles) ? payload.roles : [payload.role || "citizen"];
  return {
    sub: payload.sub,
    tenantId: String(payload.tenantId || payload.tid || "nodo-cero-rdm"),
    roles: roles.filter((r: string) => r in roleRank),
    plan: typeof payload.plan === "string" ? payload.plan : undefined,
    scopes: Array.isArray(payload.scopes) ? payload.scopes.map(String) : [],
    exp: payload.exp,
    iss: payload.iss,
  };
}

function parseCookies(header: unknown): Record<string, string> {
  if (typeof header !== "string") return {};
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => {
        const [name, ...rest] = part.trim().split("=");
        return [name, decodeURIComponent(rest.join("="))];
      })
      .filter(([name]) => Boolean(name)),
  );
}

/**
 * AUTHENTICATE MIDDLEWARE — Four-layer resolution:
 *   0. httpOnly cookie (__Host-isa_session) — preferred transport
 *   1. Native JWT (Authorization header — backward compat)
 *   2. API Key (x-api-key header)
 *   3. External JWT (ISABELLA_AUTH_SECRET)
 *   4. Dev fallback (non-production only)
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  let cfg: ReturnType<typeof config>;
  try {
    cfg = config();
  } catch {
    return res.status(503).json({ ok: false, error: "Authentication configuration unavailable." });
  }
  const isProduction =
    cfg.NODE_ENV === "production" ||
    cfg.ISABELLA_RUNTIME_MODE === "production" ||
    cfg.ISABELLA_RUNTIME_MODE === "staging" ||
    (cfg.NODE_ENV === "test" && cfg.ISABELLA_RUNTIME_MODE !== "development");

  // Layer 0: httpOnly cookie (preferred — immune to XSS)
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies["__Host-isa_session"] || cookies["isa_session"];
  if (cookieToken) {
    const native = verifyNativeJwt(cookieToken);
    if (native) {
      req.principal = native as AuthenticatedPrincipal;
      return next();
    }
    const externalSecret = process.env.ISABELLA_AUTH_SECRET;
    if (externalSecret) {
      const external = verifyHs256Jwt(cookieToken, externalSecret);
      if (external) {
        req.principal = external;
        return next();
      }
    }
  }

  // Layer 1: Native JWT via Authorization header (backward compat)
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token) {
    const native = verifyNativeJwt(token);
    if (native) {
      req.principal = native as AuthenticatedPrincipal;
      return next();
    }

    const externalSecret = process.env.ISABELLA_AUTH_SECRET;
    if (externalSecret) {
      const external = verifyHs256Jwt(token, externalSecret);
      if (external) {
        req.principal = external;
        return next();
      }
    }

    return res.status(401).json({ ok: false, error: "Invalid or expired authentication token." });
  }

  // Layer 2: API Key (x-api-key header)
  const apiKey = String(req.headers["x-api-key"] || "");
  if (apiKey) {
    const principal = validateApiKey(apiKey);
    if (principal) {
      req.principal = principal as AuthenticatedPrincipal;
      return next();
    }
    return res.status(401).json({ ok: false, error: "Invalid or revoked API key." });
  }

  // Layer 4: Dev fallback (non-production only) — explicit, non-wildcard scopes
  if (
    !isProduction &&
    cfg.NODE_ENV === "development" &&
    cfg.ISABELLA_RUNTIME_MODE === "development" &&
    cfg.AUTH_DEV_SESSION_ENABLED === true &&
    cfg.VERCEL !== true
  ) {
    req.principal = {
      sub: "dev-local",
      tenantId: "nodo-cero-rdm",
      roles: ["admin"],
      scopes: [
        "chat:read",
        "chat:write",
        "models:read",
        "territory:read",
        "billing:read",
        "billing:checkout",
        "audit:read",
        "admin:keys",
        "keys:manage",
        "memory:read",
        "memory:write",
        "agent:chat",
        "agent:lease",
        "governance:read",
        "quantum:execute",
        "tools:execute",
      ],
      kind: "jwt",
    };
    return next();
  }

  return res.status(401).json({ ok: false, error: "Authentication required." });
}

export function requireRole(minRole: IsabellaRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles = req.principal?.roles || [];
    const allowed = roles.some((r) => roleRank[r] >= roleRank[minRole]);
    if (!allowed)
      return res.status(403).json({ ok: false, error: "Insufficient privileges for this action." });
    return next();
  };
}

export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const scopes = req.principal?.scopes || [];
    const roles = req.principal?.roles || [];

    // Wildcard "*" is only allowed for system role
    if (scopes.includes("*")) {
      if (roles.includes("system")) {
        return next();
      }
      return res.status(403).json({ ok: false, error: "Wildcard scope requires system role" });
    }

    if (!scopes.includes(scope)) {
      return res.status(403).json({ ok: false, error: `Missing required scope: ${scope}` });
    }
    return next();
  };
}

export function currentPrincipal(req: Request): AuthenticatedPrincipal {
  return (
    req.principal || {
      sub: "anonymous",
      tenantId: "public",
      roles: ["viewer"],
      scopes: [],
    }
  );
}
