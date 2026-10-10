/**
 * Runtime Mode Resolution & Environment Determination
 * Part of Sovereign Genesis Enterprise Architecture
 */
import { runtimeModeSignal } from "./config";

export type RuntimeMode = "development" | "test" | "staging" | "production";

/**
 * Normaliza un valor explícito de modo runtime (p. ej. `ISABELLA_RUNTIME_MODE`).
 * Devuelve `null` cuando no hay valor usable y la resolución debe delegarse al
 * entorno. Cualquier valor no reconocido —incluidos los estados operativos
 * `emergency` y `maintenance`— se resuelve como `production`: sólo existen en
 * un runtime ya desplegado (fail-closed, nunca degrada a development).
 */
function normalizeRuntimeMode(value: string | undefined): RuntimeMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "development" ||
    normalized === "test" ||
    normalized === "staging" ||
    normalized === "production"
  ) {
    return normalized;
  }
  return "production";
}

/**
 * Resolución desde el entorno cuando no se recibe valor explícito:
 * `ISABELLA_RUNTIME_MODE` (autoridad de configuración) y, en su defecto,
 * `NODE_ENV` / señales de plataforma (Vercel, Vitest).
 */
function resolveRuntimeModeFromEnvironment(): RuntimeMode {
  const configured = normalizeRuntimeMode(runtimeModeSignal("ISABELLA_RUNTIME_MODE"));
  if (configured) return configured;
  const env = (runtimeModeSignal("NODE_ENV") || "development").toLowerCase();
  if (env === "production" || runtimeModeSignal("VERCEL") === "1") {
    return "production";
  }
  if (env === "test" || runtimeModeSignal("VITEST") === "true") {
    return "test";
  }
  if (env === "staging") {
    return "staging";
  }
  return "development";
}

export function resolveRuntimeMode(value?: string): RuntimeMode {
  return normalizeRuntimeMode(value) ?? resolveRuntimeModeFromEnvironment();
}

export function isProductionLike(mode?: string): boolean {
  const resolved = resolveRuntimeMode(mode);
  return resolved === "production" || resolved === "staging";
}

export function isDevMode(mode?: string): boolean {
  return resolveRuntimeMode(mode) === "development";
}

export function isTestMode(mode?: string): boolean {
  return resolveRuntimeMode(mode) === "test";
}
