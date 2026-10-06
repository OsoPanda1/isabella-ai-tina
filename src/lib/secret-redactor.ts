import { config } from "./config";
import { secrets } from "./secrets";

/** Deterministic secret redaction for logs and structured telemetry. */

// Canonical secret registry. Keep synchronized with env-schema.ts.
const BUILTIN_KEYS = [
  "AUTH_JWT_SECRET",
  "SESSION_SECRET",
  "PROVISION_OWNER_TOKEN",
  "ENCRYPTION_MASTER_KEY",
  "CROWN_POLICY_SIGNING_KEY",
  "AEGIS_AUDIT_SECRET",
  "BOOKPI_SIGNING_KEY",
  "API_KEY_HASH_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "MUX_TOKEN_ID",
  "MUX_TOKEN_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_DATABASE_SUPABASE_JWT_SECRET",
  "SUPABASE_DATABASE_SUPABASE_SECRET_KEY",
  "SUPABASE_DATABASE_SUPABASE_SERVICE_ROLE_KEY",
  "TURSO_AUTH_TOKEN",
  "REDIS_TOKEN",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_TOKEN",
  "OPENAI_COMPATIBLE_API_KEY",
];

export interface Redactor {
  redact(input: string): string;
  redactObject(input: unknown): unknown;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSecretPatterns(values: string[]): RegExp {
  const seeded = values.filter((v) => v && v.length >= 8).map(escapeRegExp);
  const literals = seeded.join("|");
  const generic =
    /(\b(?:api[_-]?key|secret|token|password|passwd|auth|bearer|authorization|credential)\b\s*[:=]\s*["']?)([^\s"']{12,})(["']?)/gi;
  const bearer = /(\bBearer\s+)[A-Za-z0-9_\-.+=/]{20,}/gi;
  const querySecret = /([?&](?:token|key|secret|password|signature)=)[^&\s]{8,}/gi;
  const parts = [generic.source, bearer.source, querySecret.source];
  if (literals) parts.push(`(?:${literals})`);
  return new RegExp(parts.join("|"), "gi");
}

export function createRedactor(extraValues: string[] = []): Redactor {
  const cfg = config();
  const extraKeys = cfg.REDACT_EXTRA_KEYS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dynamicValues: string[] = [];
  const cfgRecord = cfg as unknown as Record<string, unknown>;
  const secureEnvLookup = (key: string): string | undefined => {
    const value = cfgRecord[key];
    return typeof value === "string" && value.length >= 8 ? value : undefined;
  };
  for (const key of [...BUILTIN_KEYS, ...extraKeys]) {
    const value = secureEnvLookup(key);
    if (value) dynamicValues.push(value);
  }
  for (const value of [
    secrets.getOptional("AUTH_JWT_SECRET"),
    secrets.getOptional("GEMINI_API_KEY"),
    secrets.getOptional("ENCRYPTION_MASTER_KEY"),
  ]) {
    if (value) dynamicValues.push(value);
  }

  const pattern = buildSecretPatterns([...dynamicValues, ...extraValues]);
  const patternKeys = new RegExp(
    `("?(?:${BUILTIN_KEYS.concat(extraKeys).map(escapeRegExp).join("|")})"?\\s*:\\s*")[^"]{4,}(")`,
    "gi",
  );

  function redact(input: string): string {
    const out = input.replace(pattern, (_match, prefix = "") => `${prefix}[REDACTED]`);
    return out.replace(patternKeys, "$1[REDACTED]$2");
  }

  function redactObject(input: unknown): unknown {
    if (typeof input === "string") return redact(input);
    if (Array.isArray(input)) return input.map(redactObject);
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        out[key] =
          typeof value === "string" && isSensitiveKey(key) ? "[REDACTED]" : redactObject(value);
      }
      return out;
    }
    return input;
  }

  return { redact, redactObject };
}

function isSensitiveKey(key: string): boolean {
  return /(secret|token|password|passwd|api[_-]?key|jwt|signing|encryption|bearer|credential|private[_-]?key)/i.test(
    key,
  );
}

export const redactor: Redactor = createRedactor();
export const redact = (input: string): string => redactor.redact(input);
export const redactObject = (input: unknown): unknown => redactor.redactObject(input);

/**
 * Redacta cualquier argumento de log (string, Error u objeto) antes de
 * emitirlo a consola/telemetría. Los mensajes de error pueden contener
 * tokens, URLs con credenciales o payloads del cliente (ISA-447).
 */
export function redactLogArg(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (value instanceof Error) {
    const head = redact(`${value.name}: ${value.message}`);
    return value.stack ? `${head}\n${redact(value.stack)}` : head;
  }
  try {
    return redactObject(value);
  } catch {
    return "[log no serializable]";
  }
}

const SENSITIVE_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // JWT tokens: header.payload.signature
  {
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replacement: "[REDACTED_JWT]",
  },
  // Private keys (RSA, EC, Ed25519)
  {
    pattern: /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  // Bearer tokens in headers or strings
  {
    pattern: /Bearer\s+[A-Za-z0-9_.\-~+/=]+/gi,
    replacement: "Bearer [REDACTED_TOKEN]",
  },
  // Postgres / database connection strings
  {
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+\/[^\s"']+/gi,
    replacement: "postgresql://[REDACTED_USER]:[REDACTED_PASSWORD]@[REDACTED_HOST]/[REDACTED_DB]",
  },
  // Stripe secrets / API keys
  {
    pattern: /(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}/g,
    replacement: "[REDACTED_STRIPE_KEY]",
  },
  // Generic API keys (isa_live, sk-, ai-studio, etc.)
  {
    pattern: /(?:isa_(?:live|test)_[a-f0-9]{32,}|AIza[0-9A-Za-z\\-_]{35})/g,
    replacement: "[REDACTED_API_KEY]",
  },
  // Passwords / secrets in JSON strings
  {
    pattern: /"(password|secret|token|apiKey|api_key|access_token|refresh_token)":\s*"[^"]+"/gi,
    replacement: '"$1":"[REDACTED]"',
  },
];

/**
 * Redacción determinista de secretos estructurales (JWT, private keys, Bearer,
 * connection strings, Stripe/API keys y credenciales JSON). Usada por el motor
 * de attestation antes de firmar/verificar evidencia: debe ser estable entre
 * `signAttestation` y `verifyAttestation` para que el hash coincida.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let redacted = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}
