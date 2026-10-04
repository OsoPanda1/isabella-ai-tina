import { z } from "zod";

const enumish = <T extends readonly [string, ...string[]]>(values: T, def: T[number]) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(values).default(def),
  );

export const runtimeModeSchema = enumish(
  ["development", "staging", "production", "emergency", "maintenance"] as const,
  "development",
);
export type RuntimeMode = z.infer<typeof runtimeModeSchema>;
const coercedInt = (def: number) => z.coerce.number().int().nonnegative().default(def);
const optionalString = () =>
  z.preprocess(
    (v) =>
      typeof v === "string" && v.trim() && !["undefined", "null"].includes(v.trim())
        ? v.trim()
        : undefined,
    z.string().optional(),
  );
const optionalMinString = (min: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
    z.string().min(min).optional(),
  );
const optionalUrl = () =>
  z.preprocess((v) => {
    if (typeof v !== "string" || !v.trim()) return undefined;
    try {
      new URL(v.trim());
      return v.trim();
    } catch {
      return undefined;
    }
  }, z.string().url().optional());
const bool = (def: boolean) =>
  z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
    }
    return undefined;
  }, z.boolean().default(def));

export const envSchema = z
  .object({
    // --- ENVIRONMENT ---
    NODE_ENV: enumish(["development", "test", "production"] as const, "development"),
    ISABELLA_RUNTIME_MODE: runtimeModeSchema,
    PUBLIC_URL: z.string().url().default("http://localhost:3000"),
    VERCEL_URL: optionalString(),
    VERCEL_GIT_COMMIT_SHA: optionalString(),
    DATABASE_URL: optionalString(),
    DATABASE_DIRECT_URL: optionalString(),
    ISABELLA_STORAGE_PROVIDER: optionalString(),
    TURSO_DATABASE_URL: optionalUrl(),
    TURSO_AUTH_TOKEN: optionalString(),
    INTERNAL_ORIGIN: optionalUrl(),
    // Modo del proxy de confianza para resolver la IP real del cliente
    // (resolveTrustedClientIp): "vercel" | "cloudflare" | "generic" | vacío.
    TRUSTED_PROXY_MODE: optionalString(),
    // --- POSTGRES / SUPABASE ---
    SUPABASE_URL: optionalUrl(),
    SUPABASE_ANON_KEY: optionalString(),
    SUPABASE_SERVICE_ROLE_KEY: optionalString(),
    SUPABASE_JWT_SECRET: optionalString(),
    // --- JWT / OIDC ---
    AUTH_JWT_SECRET: optionalMinString(16),
    AUTH_ISSUER: optionalUrl(),
    AUTH_AUDIENCE: z.string().default("isabella"),
    AUTH_ACCESS_TOKEN_TTL: coercedInt(3600),
    AUTH_REFRESH_TOKEN_TTL: coercedInt(604800),
    OIDC_JWKS_URL: optionalUrl(),
    JWKS_CACHE_TTL: coercedInt(3600),
    // --- SESSIONS / COOKIES ---
    // Secreto para firmar la cookie de sesión del cliente (mín. 16 caracteres).
    // Opcional: sin él la firma deriva de AUTH_JWT_SECRET; en producción se
    // recomienda una clave dedicada para poder rotarla sin invalidar los JWT.
    SESSION_SECRET: optionalMinString(16),
    // --- DEV SESSION / PROVISIONING ---
    // Solo desarrollo: habilita el login OIDC/OAuth manual de pruebas y la acción
    // `authenticate` (NUNCA en staging/production). Fail-closed por defecto.
    AUTH_DEV_SESSION_ENABLED: z
      .preprocess(
        (val) => {
          if (typeof val !== "string") return undefined;
          const trimmed = val.trim().toLowerCase();
          if (trimmed === "" || trimmed === "undefined" || trimmed === "null") return undefined;
          return trimmed;
        },
        z.enum(["true", "false"]).default("false"),
      )
      .transform((val) => val === "true"),
    ALLOW_GUEST_CHAT: z
      .preprocess(
        (val) => {
          if (typeof val !== "string") return undefined;
          const t = val.trim().toLowerCase();
          if (t === "" || t === "undefined" || t === "null") return undefined;
          return t;
        },
        z.enum(["true", "false"]).default("false"),
      )
      .transform((val) => val === "true"),
    // Token de aprovisionamiento soberano del primer tenant/owner (bootstrap).
    // Sin este token, `provision-owner` niega la operación (fail-closed).
    PROVISION_OWNER_TOKEN: optionalString(),
    // --- CRYPTO ---
    ENCRYPTION_MASTER_KEY: optionalMinString(32),
    ENCRYPTION_ALGORITHM: z.string().default("aes-256-gcm"),
    // --- CROWN ---
    CROWN_CONSTITUTION_VERSION: z.string().min(1).default("v4.2.0-sovereign"),
    CROWN_POLICY_SIGNING_KEY: optionalString(),
    AEGIS_AUDIT_SECRET: optionalMinString(32),
    CROWN_ENFORCEMENT_MODE: enumish(["enforce", "dry-run"] as const, "enforce"),
    // --- BOOKPI ---
    BOOKPI_SIGNATURE_ALGORITHM: z.string().default("NOT_IMPLEMENTED"),
    BOOKPI_SIGNING_KEY: optionalMinString(32),
    // x402 USDC recipient. Required and validated before live settlement.
    X402_PAYMENT_VAULT_ADDRESS: optionalString(),
    // --- FEDERATION SIGNING ---
    FEDERATION_SIGNING_KEYS_JSON: optionalString(),
    // --- ATTESTATION SIGNATURES (RSA-2048 / SHA-256 / PKCS#1 v1.5) ---
    // Firma externa verificable. La firma NO es clave: se verifica contra la
    // clave pública PEM y el payload almacenados en ISABELLA_ATTESTATION_DIR.
    // Fail-closed: sin clave pública o payload, la ranura queda NO VERIFICADA.
    ISABELLA_ATTESTATION_DIR: optionalString(),
    ISABELLA_ATTESTATION_1_SIGNATURE: optionalString(),
    ISABELLA_ATTESTATION_2_SIGNATURE: optionalString(),
    ISABELLA_ATTESTATION_3_SIGNATURE: optionalString(),
    // --- REDIS ---
    REDIS_URL: optionalString(),
    REDIS_TOKEN: optionalString(),
    REDIS_PREFIX: z.string().default("isabella"),
    // Upstash/Redis (rate limiting y caché distribuida). KV_* es el nombre que
    // inyecta la integración Vercel KV/Upstash; REDIS_* es el canónico.
    KV_URL: optionalString(),
    KV_REST_API_TOKEN: optionalString(),
    KV_REST_API_READ_ONLY_TOKEN: optionalString(),
    UPSTASH_REDIS_TOKEN: optionalString(),
    // --- RATE LIMIT ---
    RATE_LIMIT_DEFAULT_PER_MINUTE: coercedInt(120),
    RATE_LIMIT_INFERENCE_PER_MINUTE: coercedInt(40),
    RATE_LIMIT_VOICE_PER_MINUTE: coercedInt(20),
    // --- AI GATEWAY ---
    GEMINI_API_KEY: optionalString(),
    AI_GATEWAY_API_KEY: optionalString(),
    LLM_DEFAULT_MODEL: z.string().default("google/gemini-3.1-flash"),
    VOICE_API_URL: optionalUrl(),
    ELEVENLABS_API_KEY: optionalString(),
    GOOGLE_TTS_API_KEY: optionalString(),
    GROQ_API_KEY: optionalString(),
    XAI_API_KEY: optionalString(),
    // Free federation is opt-in and only accepts explicitly configured, HTTPS endpoints.
    FREE_AI_FEDERATION_ENABLED: bool(false),
    FREE_AI_FEDERATION_ENDPOINTS: optionalString(),
    LLM_VOICE_MODEL: z.string().default("openai/gpt-4o-mini-tts"),
    LLM_UPSTREAM_TIMEOUT_MS: coercedInt(8500),
    // --- TELEMETRY ---
    STATSIG_SERVER_API_KEY: optionalString(),
    VITE_PUBLIC_APP_URL: optionalUrl(),
    VITE_STATSIG_CLIENT_KEY: optionalString(),
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl(),
    OTEL_SERVICE_NAME: z.string().default("isabella-ai"),
    // --- REDACTION ---
    REDACT_EXTRA_KEYS: z.string().default(""),
    // --- INPUT LIMITS ---
    INPUT_MAX_BODY_BYTES: coercedInt(12 * 1024 * 1024),
    INPUT_MAX_MESSAGES: coercedInt(200),
    INPUT_MAX_ATTACHMENT_BYTES: coercedInt(8 * 1024 * 1024),
    INPUT_MAX_TOOLS_PER_REQUEST: coercedInt(20),
    // --- API KEYS ---
    API_KEY_HASH_SECRET: optionalMinString(16),
    API_KEY_PREFIX: z.string().default("isk_live"),
    API_KEY_DEFAULT_TTL: coercedInt(2592000), // 30 days
    API_KEY_MAX_TTL: coercedInt(31536000), // 365 days
    API_KEY_ROTATION_GRACE_SECONDS: coercedInt(300),
    // --- PERSISTENCE ---
    DURABLE_JSON_ALLOWED: z
      .preprocess((val) => {
        if (typeof val === "boolean") return val;
        if (typeof val !== "string") return undefined;
        const t = val.trim().toLowerCase();
        if (t === "true") return true;
        if (t === "false") return false;
        return undefined;
      }, z.boolean().default(false))
      .describe(
        "Allow JSON file persistence in production — must be false in prod, true only for dev/test",
      ),
    // --- QUANTUM BRIDGE ---
    PYTHON_PATH: optionalString(),
    QUANTUM_BRIDGE_PATH: optionalString(),
    QUANTUM_BRIDGE_MAX_STDOUT_BYTES: coercedInt(4194304),
    // --- QUP (Quantum Utility Protocol) ---
    QUP_ZNE_LEVEL: coercedInt(3),
    QUP_PEC_ENABLED: bool(true),
    QUP_QEC_DECODER: enumish(
      ["mwpm", "uf", "tensor-network", "neural-network"] as const,
      "tensor-network",
    ),
    QUP_STRICT_ISOLATION: bool(true),
    SANDBOX_ENABLED: bool(false),
    // --- OLLAMA ---
    OLLAMA_ENABLED: bool(false),
    OLLAMA_BASE_URL: optionalUrl(),
    OLLAMA_MODEL: optionalString(),
    // --- OPENAI COMPATIBLE ---
    OPENAI_COMPATIBLE_LOCAL_ENABLED: bool(false),
    OPENAI_COMPATIBLE_BASE_URL: optionalUrl(),
    OPENAI_COMPATIBLE_MODEL: optionalString(),
    OPENAI_COMPATIBLE_API_KEY: optionalString(),
    // --- VERCEL ---
    VERCEL: bool(false),
    // --- NATIVE COMPREHENSION ---
    NATIVE_COMPREHENSION_ENABLED: bool(false),
    // --- IGDS ---
    IGDS_SIGNING_KEY: optionalString(),
    IGDS_KEY_ID: z.string().default("isabella-ed25519-2026-01"),
    IGDS_TSA_URL: optionalUrl(),
    // --- STRIPE & PAYOUTS ---
    STRIPE_SECRET_KEY: optionalString(),
    STRIPE_WEBHOOK_SECRET: optionalString(),
    ISABELLA_PAYOUT_CIRCUIT_CERTIFIED: bool(false),
    // --- CONNECTOR WEBHOOKS (firma verificada de proveedores) ---
    GITHUB_WEBHOOK_SECRET: optionalMinString(16),
    SLACK_SIGNING_SECRET: optionalMinString(16),
    LINEAR_WEBHOOK_SECRET: optionalMinString(16),
    // --- MEDIA / MUX ---
    MUX_TOKEN_ID: optionalString(),
    MUX_TOKEN_SECRET: optionalString(),
    MUX_INTRO_ASSET_ID: optionalString(),
    MUX_PLAYBACK_ID: optionalString(),
    MUX_INTRO_FALLBACK_TYPE: enumish(["none", "procedural", "static"] as const, "procedural"),
    // --- FEATURE FLAGS & AUDIT ---
    ISABELLA_FEATURE_FLAGS: optionalString(),
    GENESIS_MAX_TEST_FILES: coercedInt(8),
  })
  .passthrough();

export type Env = z.infer<typeof envSchema>;
export const PUBLIC_ENV_KEYS = [] as const;
export type EnvVarCriticality = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type EnvVarVisibility = "secret" | "public";
export type EnvVarProvider =
  | "postgres"
  | "neon"
  | "supabase"
  | "stripe"
  | "gemini"
  | "mux"
  | "openai"
  | "redis"
  | "crown"
  | "bookpi"
  | "otel"
  | "oidc"
  | "vercel"
  | "self";
export interface EnvVarDescriptor {
  name: keyof Env;
  visibility: EnvVarVisibility;
  required: RuntimeMode[];
  forbidden: RuntimeMode[];
  provider?: EnvVarProvider;
  criticality: EnvVarCriticality;
  rotation?: string;
  description?: string;
}

export const ENV_VAR_CATALOG: EnvVarDescriptor[] = [
  {
    name: "NODE_ENV",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "vercel",
    criticality: "HIGH",
  },
  {
    name: "ISABELLA_RUNTIME_MODE",
    visibility: "public",
    required: ["staging", "production"],
    forbidden: [],
    provider: "self",
    criticality: "CRITICAL",
  },
  {
    name: "PUBLIC_URL",
    visibility: "public",
    required: ["staging", "production"],
    forbidden: [],
    provider: "vercel",
    criticality: "HIGH",
  },
  {
    name: "ISABELLA_STORAGE_PROVIDER",
    visibility: "public",
    required: ["staging", "production"],
    forbidden: [],
    provider: "postgres",
    criticality: "CRITICAL",
  },
  {
    name: "DATABASE_URL",
    visibility: "secret",
    required: ["staging", "production"],
    forbidden: [],
    provider: "postgres",
    criticality: "CRITICAL",
  },
  {
    name: "AUTH_JWT_SECRET",
    visibility: "secret",
    required: ["staging", "production"],
    forbidden: [],
    provider: "self",
    criticality: "CRITICAL",
  },
  {
    name: "ENCRYPTION_MASTER_KEY",
    visibility: "secret",
    required: ["staging", "production"],
    forbidden: [],
    provider: "self",
    criticality: "CRITICAL",
  },
  {
    name: "CROWN_POLICY_SIGNING_KEY",
    visibility: "secret",
    required: ["staging", "production"],
    forbidden: [],
    provider: "crown",
    criticality: "CRITICAL",
  },
  {
    name: "AEGIS_AUDIT_SECRET",
    visibility: "secret",
    required: ["staging", "production"],
    forbidden: [],
    provider: "crown",
    criticality: "CRITICAL",
  },
  {
    name: "BOOKPI_SIGNING_KEY",
    visibility: "secret",
    required: ["staging", "production"],
    forbidden: [],
    provider: "bookpi",
    criticality: "CRITICAL",
  },
  {
    name: "X402_PAYMENT_VAULT_ADDRESS",
    visibility: "public",
    required: ["staging", "production"],
    forbidden: [],
    provider: "bookpi",
    criticality: "CRITICAL",
    description:
      "Dirección EVM de 20 bytes que recibe liquidaciones USDC x402; debe ser una dirección real configurada por el operador.",
  },
  {
    name: "GEMINI_API_KEY",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "gemini",
    criticality: "CRITICAL",
  },
  {
    name: "GROQ_API_KEY",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "CRITICAL",
  },
  {
    name: "XAI_API_KEY",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "CRITICAL",
  },
  {
    name: "PROVISION_OWNER_TOKEN",
    visibility: "secret",
    required: ["staging", "production"],
    forbidden: [],
    provider: "self",
    criticality: "CRITICAL",
  },
  {
    name: "STRIPE_SECRET_KEY",
    visibility: "secret",
    required: ["staging", "production"],
    forbidden: [],
    provider: "stripe",
    criticality: "CRITICAL",
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    visibility: "secret",
    required: ["staging", "production"],
    forbidden: [],
    provider: "stripe",
    criticality: "CRITICAL",
  },
  {
    name: "AUTH_DEV_SESSION_ENABLED",
    visibility: "public",
    required: [],
    forbidden: ["staging", "production"],
    provider: "self",
    criticality: "CRITICAL",
  },
  {
    name: "ALLOW_GUEST_CHAT",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
  },
  {
    name: "CROWN_ENFORCEMENT_MODE",
    visibility: "public",
    required: [],
    forbidden: ["staging", "production"],
    provider: "crown",
    criticality: "CRITICAL",
  },
  {
    name: "DURABLE_JSON_ALLOWED",
    visibility: "public",
    required: [],
    forbidden: ["staging", "production"],
    provider: "self",
    criticality: "CRITICAL",
  },
  {
    name: "SANDBOX_ENABLED",
    visibility: "public",
    required: [],
    forbidden: ["emergency", "maintenance"],
    provider: "self",
    criticality: "CRITICAL",
  },
  {
    name: "BOOKPI_SIGNATURE_ALGORITHM",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "bookpi",
    criticality: "HIGH",
  },
  {
    name: "FEDERATION_SIGNING_KEYS_JSON",
    visibility: "secret",
    required: ["staging", "production"],
    forbidden: [],
    provider: "self",
    criticality: "CRITICAL",
    rotation: "90d",
    description:
      "JSON object containing one independent HMAC signing secret per federation (F1..F7).",
  },
  {
    name: "REDIS_URL",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "redis",
    criticality: "HIGH",
  },
  {
    name: "REDIS_TOKEN",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "redis",
    criticality: "HIGH",
  },
  {
    name: "OTEL_EXPORTER_OTLP_ENDPOINT",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "otel",
    criticality: "MEDIUM",
  },
  {
    name: "LLM_DEFAULT_MODEL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "gemini",
    criticality: "HIGH",
  },
  {
    name: "LLM_UPSTREAM_TIMEOUT_MS",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
  },
  {
    name: "RATE_LIMIT_INFERENCE_PER_MINUTE",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
  },
  {
    name: "INPUT_MAX_BODY_BYTES",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
  },
  {
    name: "INPUT_MAX_ATTACHMENT_BYTES",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
  },
  {
    name: "MUX_TOKEN_ID",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "mux",
    criticality: "MEDIUM",
    description: "Identificador de token Mux para operaciones server-side.",
  },
  {
    name: "MUX_TOKEN_SECRET",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "mux",
    criticality: "HIGH",
    rotation: "90d",
    description: "Secreto de token Mux para operaciones server-side.",
  },
  {
    name: "MUX_INTRO_ASSET_ID",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Mux asset provenance identifier for the cinematic introduction.",
  },
  {
    name: "MUX_PLAYBACK_ID",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Canonical public playback identifier for the cinematic introduction.",
  },
  {
    name: "MUX_INTRO_FALLBACK_TYPE",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
  },
  {
    name: "OLLAMA_ENABLED",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
  },
  {
    name: "OLLAMA_BASE_URL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
  },
  {
    name: "OLLAMA_MODEL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
  },
  {
    name: "OPENAI_COMPATIBLE_LOCAL_ENABLED",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
  },
  {
    name: "OPENAI_COMPATIBLE_BASE_URL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
  },
  {
    name: "OPENAI_COMPATIBLE_MODEL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
  },
  {
    name: "OPENAI_COMPATIBLE_API_KEY",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "openai",
    criticality: "HIGH",
  },
  {
    name: "VERCEL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "vercel",
    criticality: "LOW",
  },
  {
    name: "NATIVE_COMPREHENSION_ENABLED",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "LOW",
  },
  {
    name: "IGDS_SIGNING_KEY",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "bookpi",
    criticality: "HIGH",
    description: "Clave privada Ed25519 (PEM PKCS8) para el sello IGDS.",
  },
  {
    name: "IGDS_KEY_ID",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "bookpi",
    criticality: "MEDIUM",
  },
  {
    name: "IGDS_TSA_URL",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Endpoint RFC 3161 para sellado temporal externo (opcional).",
  },
  {
    name: "ISABELLA_ATTESTATION_DIR",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description:
      "Directorio local (gitignored) con <slot>.pub.pem y <slot>.payload.txt de las atestaciones RSA-2048.",
  },
  {
    name: "ISABELLA_ATTESTATION_1_SIGNATURE",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    rotation: "180d",
    description:
      "Firma RSA-2048/SHA-256/PKCS#1 v1.5 en base64 de la ranura 1. Se verifica contra 1.pub.pem + 1.payload.txt.",
  },
  {
    name: "ISABELLA_ATTESTATION_2_SIGNATURE",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    rotation: "180d",
    description:
      "Firma RSA-2048/SHA-256/PKCS#1 v1.5 en base64 de la ranura 2. Se verifica contra 2.pub.pem + 2.payload.txt.",
  },
  {
    name: "ISABELLA_ATTESTATION_3_SIGNATURE",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    rotation: "180d",
    description:
      "Firma RSA-2048/SHA-256/PKCS#1 v1.5 en base64 de la ranura 3. Se verifica contra 3.pub.pem + 3.payload.txt.",
  },
  {
    name: "GITHUB_WEBHOOK_SECRET",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "CRITICAL",
    rotation: "90d",
    description:
      "Secreto HMAC para verificar firmas x-hub-signature-256 de webhooks de GitHub (ISA-199).",
  },
  {
    name: "SLACK_SIGNING_SECRET",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "CRITICAL",
    rotation: "90d",
    description:
      "Secreto de signing para verificar x-slack-signature con ventana de replay de 300s (ISA-199/ISA-201).",
  },
  {
    name: "LINEAR_WEBHOOK_SECRET",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    rotation: "90d",
    description:
      "Secreto reservado: mientras no exista esquema de firma documentado para Linear, la ruta de webhook permanece denegada (ISA-213).",
  },
  {
    name: "AI_GATEWAY_API_KEY",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    rotation: "90d",
    description: "Clave opcional del agregador AI Gateway.",
  },
  {
    name: "API_KEY_DEFAULT_TTL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "LOW",
    description: "TTL por defecto de llaves de API (segundos).",
  },
  {
    name: "API_KEY_HASH_SECRET",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "CRITICAL",
    rotation: "90d",
    description:
      "HMAC dedicado de huella de llaves de API (min. 16; sin derivar de AUTH_JWT_SECRET).",
  },
  {
    name: "API_KEY_MAX_TTL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "LOW",
    description: "TTL máximo de llaves de API (segundos).",
  },
  {
    name: "API_KEY_PREFIX",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "LOW",
    description: "Prefijo de formato de llaves de API.",
  },
  {
    name: "API_KEY_ROTATION_GRACE_SECONDS",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "LOW",
    description: "Ventana de gracia de rotación de llaves (segundos).",
  },
  {
    name: "AUTH_ACCESS_TOKEN_TTL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "oidc",
    criticality: "MEDIUM",
    description: "Vigencia del access token (segundos).",
  },
  {
    name: "AUTH_AUDIENCE",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "oidc",
    criticality: "HIGH",
    description: "Audiencia (aud) esperada en los JWT.",
  },
  {
    name: "AUTH_ISSUER",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "oidc",
    criticality: "HIGH",
    description: "Emisor (iss) de la autoridad OIDC/JWT.",
  },
  {
    name: "AUTH_REFRESH_TOKEN_TTL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "oidc",
    criticality: "MEDIUM",
    description: "Vigencia del refresh token (segundos).",
  },
  {
    name: "CROWN_CONSTITUTION_VERSION",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "crown",
    criticality: "MEDIUM",
    description: "Versión de la constitución CROWN aplicada.",
  },
  {
    name: "DATABASE_DIRECT_URL",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "neon",
    criticality: "CRITICAL",
    rotation: "90d",
    description: "Cadena directa (sin pool) reservada a migraciones.",
  },
  {
    name: "ENCRYPTION_ALGORITHM",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Algoritmo de cifrado de datos sensibles.",
  },
  {
    name: "FREE_AI_FEDERATION_ENABLED",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    description: "Opt-in de federación con endpoints externos.",
  },
  {
    name: "FREE_AI_FEDERATION_ENDPOINTS",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    description: "Endpoints HTTPS explícitos aceptados por la federación.",
  },
  {
    name: "GENESIS_MAX_TEST_FILES",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "LOW",
    description: "Máximo de archivos que escanea el test de génesis.",
  },
  {
    name: "INPUT_MAX_MESSAGES",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Máximo de mensajes por petición.",
  },
  {
    name: "INPUT_MAX_TOOLS_PER_REQUEST",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Máximo de tools invocables por petición.",
  },
  {
    name: "INTERNAL_ORIGIN",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "vercel",
    criticality: "MEDIUM",
    description: "Origen interno permitido para llamadas server-to-server.",
  },
  {
    name: "ISABELLA_FEATURE_FLAGS",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Flags de funcionalidad.",
  },
  {
    name: "ISABELLA_PAYOUT_CIRCUIT_CERTIFIED",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "stripe",
    criticality: "HIGH",
    description: "Certificación del circuito de payouts.",
  },
  {
    name: "JWKS_CACHE_TTL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "oidc",
    criticality: "MEDIUM",
    description: "Segundos de caché del JWKS.",
  },
  {
    name: "KV_REST_API_READ_ONLY_TOKEN",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "redis",
    criticality: "MEDIUM",
    rotation: "90d",
    description: "Token solo-lectura Upstash/KV.",
  },
  {
    name: "KV_REST_API_TOKEN",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "redis",
    criticality: "MEDIUM",
    rotation: "90d",
    description: "Token Upstash/KV (rate limit y caché distribuida).",
  },
  {
    name: "KV_URL",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "redis",
    criticality: "MEDIUM",
    rotation: "90d",
    description: "Endpoint Upstash/KV con credenciales incrustadas.",
  },
  {
    name: "LLM_VOICE_MODEL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Modelo de voz por defecto.",
  },
  {
    name: "OIDC_JWKS_URL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "oidc",
    criticality: "HIGH",
    description: "URL del JWKS del proveedor OIDC.",
  },
  {
    name: "OTEL_SERVICE_NAME",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "otel",
    criticality: "LOW",
    description: "Nombre del servicio para OpenTelemetry.",
  },
  {
    name: "PYTHON_PATH",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "LOW",
    description: "Intérprete de Python del puente AEGIS/cuántico.",
  },
  {
    name: "QUANTUM_BRIDGE_MAX_STDOUT_BYTES",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "LOW",
    description: "Tope de stdout del puente cuántico.",
  },
  {
    name: "QUANTUM_BRIDGE_PATH",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "LOW",
    description: "Ruta del script del puente cuántico.",
  },
  {
    name: "QUP_PEC_ENABLED",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Activa mitigación de errores PEC en QUP.",
  },
  {
    name: "QUP_QEC_DECODER",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Decodificador QEC de QUP.",
  },
  {
    name: "QUP_STRICT_ISOLATION",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    description: "Aislamiento estricto del runtime cuántico.",
  },
  {
    name: "QUP_ZNE_LEVEL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Nivel de Zero-Noise Extrapolation.",
  },
  {
    name: "RATE_LIMIT_DEFAULT_PER_MINUTE",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Límite global de peticiones por minuto.",
  },
  {
    name: "RATE_LIMIT_VOICE_PER_MINUTE",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Límite de peticiones de voz por minuto.",
  },
  {
    name: "REDACT_EXTRA_KEYS",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Claves adicionales a redactar en logs y salida.",
  },
  {
    name: "REDIS_PREFIX",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "redis",
    criticality: "LOW",
    description: "Prefijo de claves en Redis.",
  },
  {
    name: "SESSION_SECRET",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    rotation: "90d",
    description: "Firma de cookie de sesión (min. 16; rotable sin invalidar JWT).",
  },
  {
    name: "STATSIG_SERVER_API_KEY",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    rotation: "90d",
    description: "Clave servidor de experimentación Statsig.",
  },
  {
    name: "SUPABASE_ANON_KEY",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "supabase",
    criticality: "MEDIUM",
    rotation: "90d",
    description: "Clave pública anon de Supabase; el aislamiento lo da RLS.",
  },
  {
    name: "SUPABASE_JWT_SECRET",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "supabase",
    criticality: "CRITICAL",
    rotation: "90d",
    description: "Legacy JWT Secret de Supabase; firma HS256 de los tokens RLS.",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "supabase",
    criticality: "CRITICAL",
    rotation: "90d",
    description: "Service-role: solo provisionamiento aislado; nunca en runtime.",
  },
  {
    name: "SUPABASE_URL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "supabase",
    criticality: "MEDIUM",
    description: "URL del proyecto Supabase.",
  },
  {
    name: "TRUSTED_PROXY_MODE",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    description: "Proxy de confianza para IP real: vercel | cloudflare | generic.",
  },
  {
    name: "TURSO_AUTH_TOKEN",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    rotation: "90d",
    description: "Token de autenticación de Turso.",
  },
  {
    name: "TURSO_DATABASE_URL",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    rotation: "90d",
    description: "URL de la base Turso (libSQL).",
  },
  {
    name: "UPSTASH_REDIS_TOKEN",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "redis",
    criticality: "MEDIUM",
    rotation: "90d",
    description: "Token Upstash Redis (alias de KV_REST_API_TOKEN).",
  },
  {
    name: "VERCEL_GIT_COMMIT_SHA",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "vercel",
    criticality: "LOW",
    description: "SHA del commit; inyectado por Vercel en el build.",
  },
  {
    name: "VERCEL_URL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "vercel",
    criticality: "LOW",
    description: "URL del deploy; inyectada por Vercel.",
  },
  {
    name: "VITE_PUBLIC_APP_URL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "vercel",
    criticality: "MEDIUM",
    description: "URL pública del cliente compilada por Vite.",
  },
  {
    name: "VITE_STATSIG_CLIENT_KEY",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Clave cliente de Statsig embebida en el bundle.",
  },
  {
    name: "VOICE_API_URL",
    visibility: "public",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "MEDIUM",
    description: "Endpoint del servicio de voz.",
  },
  {
    name: "ELEVENLABS_API_KEY",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    description: "Clave del proveedor TTS ElevenLabs (solo server-side).",
  },
  {
    name: "GOOGLE_TTS_API_KEY",
    visibility: "secret",
    required: [],
    forbidden: [],
    provider: "self",
    criticality: "HIGH",
    description: "Clave del proveedor TTS de Google (solo server-side).",
  },
];

export function requiredEnvKeys(mode: RuntimeMode): Array<keyof Env> {
  return ENV_VAR_CATALOG.filter((item) => item.required.includes(mode)).map((item) => item.name);
}
