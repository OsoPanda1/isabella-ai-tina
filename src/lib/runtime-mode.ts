/**
 * Runtime Mode Resolution & Environment Determination
 * Part of Sovereign Genesis Enterprise Architecture
 */

export type RuntimeMode = "development" | "test" | "staging" | "production";

export function resolveRuntimeMode(input?: string): RuntimeMode {
  const env = String(input ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
  // Emergency/maintenance modes retain production-grade authorization boundaries.
  if (
    env === "production" ||
    env === "emergency" ||
    env === "maintenance" ||
    process.env.VERCEL === "1"
  )
    return "production";
  if (env === "test" || process.env.VITEST === "true") return "test";
  if (env === "staging") return "staging";
  return "development";
}

export function isProductionLike(mode?: string): boolean {
  const resolved = mode ?? resolveRuntimeMode();
  return resolved === "production" || resolved === "staging";
}

export function isDevMode(): boolean {
  return resolveRuntimeMode() === "development";
}

export function isTestMode(): boolean {
  return resolveRuntimeMode() === "test";
}