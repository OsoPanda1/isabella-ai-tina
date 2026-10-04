/**
 * Database Dev-Auth Protected Route (src/server-routes/api/db.ts)
 * -------------------------------------------------------------
 * Fail-closed security rule: In production, returns 404 immediately
 * without leaking existence of database admin routes.
 */
import type { Request, Response } from "express";
import { isProductionLike } from "../../lib/runtime-mode";
import { pgHealthCheck } from "../../lib/persistence/postgres";
import { SecuritySystem } from "../../lib/security";
import { getTrustedClientIp } from "../../lib/trusted-client-ip";

export async function handleDbRoute(req: Request, res: Response): Promise<void> {
  // Production stealth 404 gate
  if (isProductionLike()) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // Dev-only route: still rate-limited so the admin surface cannot be sprayed.
  const rateLimit = SecuritySystem.checkRateLimit(getTrustedClientIp(req), 30);
  if (!rateLimit.allowed) {
    res.status(429).json({ error: "RATE_LIMIT_EXCEEDED" });
    return;
  }

  // Development double-gate: check Authorization header or dev key
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.includes("dev-admin")) {
    res.status(401).json({ error: "DEV_AUTH_REQUIRED" });
    return;
  }

  const health = await pgHealthCheck();
  res.status(200).json({
    mode: "development",
    dbStatus: health,
    timestamp: new Date().toISOString(),
  });
}

export default { handleDbRoute };
