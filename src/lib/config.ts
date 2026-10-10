import { createHash } from "node:crypto";
import { envSchema, requiredEnvKeys, type Env, type RuntimeMode } from "./env-schema";
export type { Env, RuntimeMode } from "./env-schema";
type RawEnv = NodeJS.ProcessEnv;
let cached: Env | undefined;
let cachedFingerprint: string | undefined;
let loadError: string | null = null;
function environmentFingerprint(source: RawEnv): string {
  return createHash("sha256")
    .update(
      Object.keys(source)
        .sort()
        .map((key) => `${key}=${source[key] ?? ""}`)
        .join("\n"),
    )
    .digest("hex");
}
function cleanEnvValue(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || ["undefined", "null"].includes(trimmed.toLowerCase())) return undefined;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    return trimmed.slice(1, -1).trim() || undefined;
  return trimmed;
}
function resolvePublicUrl(source: RawEnv): string | undefined {
  const explicit = cleanEnvValue(source.PUBLIC_URL);
  if (explicit) return explicit;
  const vercelUrl = cleanEnvValue(source.VERCEL_URL);
  if (vercelUrl) return /^https?:\/\//i.test(vercelUrl) ? vercelUrl : `https://${vercelUrl}`;
  const branchUrl = cleanEnvValue(source.VERCEL_BRANCH_URL);
  if (branchUrl) return /^https?:\/\//i.test(branchUrl) ? branchUrl : `https://${branchUrl}`;
  return undefined;
}
function resolveEnv(source: RawEnv): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success)
    throw new Error(
      `Configuración de entorno inválida: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  return parsed.data;
}
function assertRequired(mode: RuntimeMode, source: RawEnv): void {
  for (const key of requiredEnvKeys(mode)) {
    // PUBLIC_URL and the storage-provider selector are derivable in Vercel.
    // Durable authority is still enforced below through DATABASE_URL.
    if (key === "PUBLIC_URL" || key === "GEMINI_API_KEY" || key === "ISABELLA_STORAGE_PROVIDER")
      continue;
    const raw = source[key];
    if (raw === undefined || raw === null || raw === "")
      throw new Error(
        `Variable de entorno obligatoria no definida en modo "${mode}": ${String(key)}`,
      );
  }
}
function assertProductionProvider(mode: RuntimeMode, parsed: Env): void {
  if (mode !== "production" && mode !== "staging") return;
  if (!parsed.GEMINI_API_KEY && !parsed.GROQ_API_KEY && !parsed.XAI_API_KEY)
    throw new Error(
      "Se requiere al menos un proveedor de inferencia autorizado: GEMINI_API_KEY, GROQ_API_KEY o XAI_API_KEY.",
    );
}
function assertProductionCrypto(mode: RuntimeMode, parsed: Env): void {
  if (mode !== "production" && mode !== "staging") return;
  const algorithm = String(parsed.BOOKPI_SIGNATURE_ALGORITHM ?? "").trim();
  if (!["ECDSA-P384", "RSA-SHA256"].includes(algorithm)) {
    throw new Error(
      "CRITICAL_SECURITY_ERROR: BOOKPI_SIGNATURE_ALGORITHM must be explicitly ECDSA-P384 or RSA-SHA256 in staging/production.",
    );
  }
  if (!parsed.BOOKPI_SIGNING_KEY || parsed.BOOKPI_SIGNING_KEY.trim().length < 32) {
    throw new Error(
      "CRITICAL_SECURITY_ERROR: BOOKPI_SIGNING_KEY is required (>=32 characters) in staging/production.",
    );
  }
  if (!parsed.CROWN_POLICY_SIGNING_KEY || parsed.CROWN_POLICY_SIGNING_KEY.trim().length < 32) {
    throw new Error(
      "CRITICAL_SECURITY_ERROR: CROWN_POLICY_SIGNING_KEY is required (>=32 characters) in staging/production.",
    );
  }
  const x402Vault = parsed.X402_PAYMENT_VAULT_ADDRESS?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(x402Vault)) {
    throw new Error(
      "CRITICAL_SECURITY_ERROR: X402_PAYMENT_VAULT_ADDRESS must be a valid 20-byte EVM address in staging/production.",
    );
  }
}
function isSameDatabaseInstance(url1Str: string, url2Str: string): boolean {
  const u1Trim = url1Str.trim();
  const u2Trim = url2Str.trim();
  if (u1Trim === u2Trim) return true;
  try {
    const u1 = new URL(u1Trim);
    const u2 = new URL(u2Trim);
    const host1 = u1.hostname.replace("-pooler", "");
    const host2 = u2.hostname.replace("-pooler", "");
    return host1 === host2 && u1.pathname === u2.pathname && u1.username === u2.username;
  } catch {
    return false;
  }
}
function assertProductionStorageProvider(mode: RuntimeMode, source: RawEnv, parsed: Env): void {
  if (mode !== "production" && mode !== "staging") return;
  const provider = (cleanEnvValue(source.ISABELLA_STORAGE_PROVIDER)?.toLowerCase() ||
    parsed.ISABELLA_STORAGE_PROVIDER) as string;
  if (provider !== "postgres" && provider !== "neon")
    throw new Error(
      "ISABELLA_STORAGE_PROVIDER debe resolver a postgres o neon en staging/production.",
    );
  if (parsed.ISABELLA_STORAGE_PROVIDER !== provider)
    throw new Error("ISABELLA_STORAGE_PROVIDER no coincide con el proveedor normalizado.");
  if (typeof source.DATABASE_URL !== "string" || source.DATABASE_URL.trim() === "")
    throw new Error(
      "DATABASE_URL debe declararse como autoridad durable única en staging/production.",
    );
  const providerAliases = [
    "NEON_DATABASE_POSTGRES_URL",
    "NEON_DATABASE_DATABASE_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
    "SUPABASE_DATABASE_POSTGRES_URL",
  ] as const;
  const mainDbUrl = source.DATABASE_URL.trim();
  const conflictingAliases = providerAliases.filter((key) => {
    const value = source[key];
    if (typeof value !== "string" || value.trim() === "") return false;
    return !isSameDatabaseInstance(value, mainDbUrl);
  });
  if (conflictingAliases.length > 0)
    throw new Error(
      `DATABASE_URL es la única autoridad durable permitida en staging/production; variables alternativas detectadas: ${conflictingAliases.join(", ")}.`,
    );
}
export function loadConfig(source: RawEnv = process.env): Env {
  const fingerprint = environmentFingerprint(source);
  if (cached && cachedFingerprint === fingerprint) return cached;
  const databaseUrl = cleanEnvValue(source.DATABASE_URL);
  const effectiveSource: RawEnv = {
    ...source,
    ISABELLA_RUNTIME_MODE:
      cleanEnvValue(source.ISABELLA_RUNTIME_MODE) ||
      (source.NODE_ENV === "production" ? "production" : "development"),
    PUBLIC_URL: resolvePublicUrl(source),
    AUTH_DEV_SESSION_ENABLED: cleanEnvValue(source.AUTH_DEV_SESSION_ENABLED) || "false",
    ALLOW_GUEST_CHAT: cleanEnvValue(source.ALLOW_GUEST_CHAT) || "false",
    DATABASE_URL: databaseUrl,
    AUTH_JWT_SECRET: cleanEnvValue(source.AUTH_JWT_SECRET),
    SUPABASE_URL:
      cleanEnvValue(source.SUPABASE_URL) || cleanEnvValue(source.SUPABASE_DATABASE_SUPABASE_URL),
    SUPABASE_ANON_KEY:
      cleanEnvValue(source.SUPABASE_ANON_KEY) ||
      cleanEnvValue(source.SUPABASE_DATABASE_SUPABASE_ANON_KEY),
    SUPABASE_JWT_SECRET:
      cleanEnvValue(source.SUPABASE_JWT_SECRET) ||
      cleanEnvValue(source.SUPABASE_DATABASE_SUPABASE_JWT_SECRET),
    TURSO_AUTH_TOKEN: cleanEnvValue(source.TURSO_AUTH_TOKEN),
    TURSO_DATABASE_URL: cleanEnvValue(source.TURSO_DATABASE_URL),
    MUX_TOKEN_ID: cleanEnvValue(source.MUX_TOKEN_ID),
    MUX_TOKEN_SECRET: cleanEnvValue(source.MUX_TOKEN_SECRET),
    MUX_INTRO_ASSET_ID: cleanEnvValue(source.MUX_INTRO_ASSET_ID),
    ISABELLA_STORAGE_PROVIDER:
      cleanEnvValue(source.ISABELLA_STORAGE_PROVIDER)?.toLowerCase() ||
      (databaseUrl ? "postgres" : undefined),
  };
  const parsed = resolveEnv(effectiveSource);
  const mode: RuntimeMode = parsed.ISABELLA_RUNTIME_MODE;
  try {
    assertRequired(mode, effectiveSource);
    assertProductionProvider(mode, parsed);
    // La autoridad durable debe fallar primero para evitar diagnósticos engañosos
    // cuando hay aliases de base de datos contradictorios.
    assertProductionStorageProvider(mode, effectiveSource, parsed);
    assertProductionCrypto(mode, parsed);
    if (mode === "production" || mode === "staging") {
      if (parsed.NODE_ENV !== "production")
        throw new Error(
          `NODE_ENV="${parsed.NODE_ENV}" es incompatible con ISABELLA_RUNTIME_MODE="${mode}". Producción/staging requieren NODE_ENV=production.`,
        );
      if (parsed.DURABLE_JSON_ALLOWED)
        throw new Error("DURABLE_JSON_ALLOWED debe ser false en modos no locales");
      if (parsed.AUTH_DEV_SESSION_ENABLED)
        throw new Error("AUTH_DEV_SESSION_ENABLED debe estar desactivado");
      if (parsed.ALLOW_GUEST_CHAT)
        throw new Error("ALLOW_GUEST_CHAT debe estar desactivado en staging/production");
      if (!parsed.DATABASE_URL)
        throw new Error("Se requiere DATABASE_URL como autoridad durable explícita");
      if (!parsed.AUTH_JWT_SECRET)
        throw new Error(
          "Se requiere AUTH_JWT_SECRET dedicado; no se aceptan credenciales Supabase como fallback",
        );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    loadError = msg;
    if (mode === "production" || mode === "staging")
      throw new Error(`[SovereignConfig Fail-Fast] ${msg}`);
  }
  cached = parsed;
  cachedFingerprint = fingerprint;
  return parsed;
}
export function config(): Env {
  return loadConfig();
}
export function isPayoutCircuitCertified(source: RawEnv = process.env): boolean {
  return cleanEnvValue(source.ISABELLA_PAYOUT_CIRCUIT_CERTIFIED)?.toLowerCase() === "true";
}
export function resetConfigCache(): void {
  cached = undefined;
  cachedFingerprint = undefined;
  loadError = null;
}
export function getConfigLoadError(): string | null {
  return loadError;
}
export function isStorageProviderExplicitlyDeclared(source: RawEnv = process.env): boolean {
  return (
    typeof source.ISABELLA_STORAGE_PROVIDER === "string" &&
    source.ISABELLA_STORAGE_PROVIDER.trim() !== ""
  );
}
/**
 * Señales de plataforma y de modo runtime (públicas, no sensibles).
 * Existe para que `runtime-mode.ts` resuelva el modo sin tocar `process.env`
 * fuera de este módulo: son señales de despliegue, no configuración validada
 * por el esquema (por eso no se derivan de `config()` ni alteran el spawn).
 */
export function runtimeModeSignal(
  key: "ISABELLA_RUNTIME_MODE" | "NODE_ENV" | "VERCEL" | "VITEST",
): string | undefined {
  return process.env[key];
}

export function isCiEnvironment(source: RawEnv = process.env): boolean {
  return source.GITHUB_ACTIONS === "true" || source.CI === "true";
}
export function getCiRunId(source: RawEnv = process.env): string {
  return source.GITHUB_RUN_ID ?? "local";
}

/**
 * Único punto de lectura de variables de entorno "crudas" fuera del esquema
 * validado (AGENTS.md: `process.env` sólo vive en este módulo). La lista es
 * una allowlist explícita de claves NO sensibles: secretos, URLs y tokens
 * jamás aparecen aquí.
 */
export const PASSTHROUGH_ENV_KEYS = [
  "NODE_ENV",
  "COMMIT_SHA",
  "PATH",
  "PYTHONPATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
] as const;
export type PassthroughEnvKey = (typeof PASSTHROUGH_ENV_KEYS)[number];

export function passthroughEnv(key: PassthroughEnvKey): string | undefined {
  return process.env[key];
}

/** Copia mínima del entorno para procesos hijos (spawn) — sin secretos. */
export function passthroughChildEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of PASSTHROUGH_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Claves no sensibles usadas por el fingerprint de build (`computeEnvFingerprint`).
 * Se exponen aquí para que ningún otro módulo toque `process.env` directamente.
 */
export function fingerprintEnvSource(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    PUBLIC_URL: process.env.PUBLIC_URL,
    LLM_DEFAULT_MODEL: process.env.LLM_DEFAULT_MODEL,
    CROWN_CONSTITUTION_VERSION: process.env.CROWN_CONSTITUTION_VERSION,
    BOOKPI_SIGNATURE_ALGORITHM: process.env.BOOKPI_SIGNATURE_ALGORITHM,
  };
}
