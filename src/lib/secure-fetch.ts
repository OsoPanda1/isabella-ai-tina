/**
 * Isabella AI — Secure request policy and authenticated fetch client.
 *
 * Design goals:
 * - Prompt-injection signals are classified, not treated as a complete firewall.
 * - User text is never silently rewritten or HTML-decoded.
 * - External content must be marked as untrusted before entering an agent context.
 * - Requests are limited to an explicit origin allowlist.
 * - Authorization is not read from localStorage by default.
 * - Caller AbortSignals are preserved and composed with a timeout.
 * - Request bodies are bounded and cloned before inspection.
 * - Audit identifiers are generated locally and contain no secrets.
 *
 * IMPORTANT:
 * This browser helper is defense in depth. Authorization, prompt policy,
 * rate limiting, tenant isolation, tool permissions and output validation must
 * also be enforced server-side.
 */

/* node:crypto is unavailable in Vite's browser bundle.
   Use the Web Crypto API which is universal. */
const randomUUID = (): string => crypto.randomUUID();

/* ========================================================================== *
 * Public policy types
 * ========================================================================== */

export type PromptRisk = "low" | "medium" | "high" | "critical";
export type PromptDisposition = "allow" | "review" | "deny";
export type RequestAuthMode = "cookie" | "memory" | "none";

export interface PromptFinding {
  ruleId: string;
  risk: PromptRisk;
  category:
    | "instruction_override"
    | "role_manipulation"
    | "secret_exfiltration"
    | "code_or_query"
    | "encoding"
    | "tool_abuse";
  start: number;
  end: number;
}

export interface PromptPolicyResult {
  disposition: PromptDisposition;
  risk: PromptRisk;
  normalizedText: string;
  findings: PromptFinding[];
  reasonCode: string;
}

export interface IsabellaFetchOptions extends RequestInit {
  /** Optional structured prompt fields to inspect without recursively guessing fields. */
  promptFields?: readonly string[];
  /** Defaults to 30 seconds and is bounded by MAX_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Set only for explicitly approved cross-origin APIs. */
  allowCrossOrigin?: boolean;
  /** Used to distinguish content that is untrusted evidence from user instructions. */
  contentClass?: "user_input" | "trusted_internal" | "untrusted_external";
  /** Allows the caller to request review instead of immediate denial. */
  onPromptReview?: (result: PromptPolicyResult) => void;
}

export interface IsabellaFetchConfig {
  apiOrigins: readonly string[];
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  maxBodyBytes?: number;
  authMode?: RequestAuthMode;
  /** Access token remains in memory only; do not persist it in browser storage. */
  accessToken?: string | null;
  /** If true, high-risk prompts are returned for human review instead of denied. */
  reviewHighRisk?: boolean;
}

export class IsabellaRequestError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly auditId?: string;

  constructor(code: string, message: string, options?: { status?: number; auditId?: string }) {
    super(message);
    this.name = "IsabellaRequestError";
    this.code = code;
    this.status = options?.status;
    this.auditId = options?.auditId;
  }
}

/* ========================================================================== *
 * Policy
 * ========================================================================== */

interface PromptRule {
  id: string;
  category: PromptFinding["category"];
  risk: PromptRisk;
  expression: RegExp;
}

/**
 * These patterns are signals only. They do not establish malicious intent;
 * context and server-side policy must decide the final action.
 */
const PROMPT_RULES: readonly PromptRule[] = [
  {
    id: "PI-001",
    category: "instruction_override",
    risk: "high",
    expression: /\b(?:ignore|disregard|override)\b.{0,80}\b(?:previous|prior|above|system)\b/giu,
  },
  {
    id: "PI-002",
    category: "instruction_override",
    risk: "high",
    expression:
      /\b(?:reveal|print|show|dump|leak)\b.{0,80}\b(?:system prompt|hidden prompt|developer message|secret)\b/giu,
  },
  {
    id: "PI-003",
    category: "role_manipulation",
    risk: "medium",
    expression: /\b(?:you are now|act as|pretend to be|roleplay as)\b/giu,
  },
  {
    id: "PI-004",
    category: "secret_exfiltration",
    risk: "critical",
    expression:
      /\b(?:api[_ -]?key|access[_ -]?token|private[_ -]?key|password|credential)\b.{0,80}\b(?:send|post|upload|return|reveal|display)\b/giu,
  },
  {
    id: "PI-005",
    category: "code_or_query",
    risk: "high",
    expression: /\b(?:drop\s+table|union\s+select|insert\s+into|delete\s+from|xp_cmdshell)\b/giu,
  },
  {
    id: "PI-006",
    category: "encoding",
    risk: "medium",
    expression: /(?:data:text\/html|javascript:|<script\b|(?:%[0-9a-f]{2}){4,})/giu,
  },
  {
    id: "PI-007",
    category: "tool_abuse",
    risk: "high",
    expression:
      /\b(?:disable|bypass|remove)\b.{0,80}\b(?:safety|guardrail|approval|sandbox|policy|audit)\b/giu,
  },
];

const RISK_ORDER: Record<PromptRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const normalizeForAnalysis = (text: string): string =>
  text
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();

const classifyPrompt = (
  prompt: string,
  contentClass: IsabellaFetchOptions["contentClass"],
  reviewHighRisk: boolean,
): PromptPolicyResult => {
  if (typeof prompt !== "string") {
    return {
      disposition: "deny",
      risk: "critical",
      normalizedText: "",
      findings: [],
      reasonCode: "PROMPT_NOT_STRING",
    };
  }

  const normalizedText = normalizeForAnalysis(prompt);
  const findings: PromptFinding[] = [];

  for (const rule of PROMPT_RULES) {
    rule.expression.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.expression.exec(normalizedText)) !== null) {
      findings.push({
        ruleId: rule.id,
        risk: rule.risk,
        category: rule.category,
        start: match.index,
        end: match.index + match[0].length,
      });
      if (match[0].length === 0) rule.expression.lastIndex += 1;
    }
  }

  const highestRisk = findings.reduce<PromptRisk>(
    (highest, finding) => (RISK_ORDER[finding.risk] > RISK_ORDER[highest] ? finding.risk : highest),
    "low",
  );

  if (contentClass === "untrusted_external") {
    return {
      disposition: findings.some((finding) => finding.risk === "critical") ? "deny" : "review",
      risk: highestRisk,
      normalizedText,
      findings,
      reasonCode: findings.length ? "UNTRUSTED_CONTENT_REQUIRES_BOUNDARY" : "UNTRUSTED_CONTENT",
    };
  }

  if (highestRisk === "critical") {
    return {
      disposition: "deny",
      risk: highestRisk,
      normalizedText,
      findings,
      reasonCode: "CRITICAL_PROMPT_SIGNAL",
    };
  }
  if (highestRisk === "high") {
    return {
      disposition: reviewHighRisk ? "review" : "deny",
      risk: highestRisk,
      normalizedText,
      findings,
      reasonCode: reviewHighRisk ? "HIGH_RISK_REVIEW_REQUIRED" : "HIGH_RISK_PROMPT_SIGNAL",
    };
  }
  if (findings.length) {
    return {
      disposition: "review",
      risk: highestRisk,
      normalizedText,
      findings,
      reasonCode: "PROMPT_REVIEW_REQUIRED",
    };
  }
  return {
    disposition: "allow",
    risk: "low",
    normalizedText,
    findings,
    reasonCode: "NO_KNOWN_SIGNAL",
  };
};

const collectPromptFields = (
  body: Record<string, unknown>,
  fields: readonly string[],
): Array<{ field: string; value: string }> => {
  const values: Array<{ field: string; value: string }> = [];
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field) && typeof body[field] === "string") {
      values.push({ field, value: body[field] as string });
    }
  }
  return values;
};

export const analyzePrompt = (
  prompt: string,
  options: Pick<IsabellaFetchOptions, "contentClass" | "onPromptReview"> & {
    reviewHighRisk?: boolean;
  } = {},
): PromptPolicyResult => {
  const result = classifyPrompt(
    prompt,
    options.contentClass ?? "user_input",
    options.reviewHighRisk ?? false,
  );
  if (result.disposition === "review") options.onPromptReview?.(result);
  return result;
};

export const sanitizePrompt = (prompt: string): string => {
  const result = analyzePrompt(prompt);
  if (result.disposition !== "allow") {
    throw new IsabellaRequestError(
      "PROMPT_POLICY_REJECTED",
      "La entrada requiere revision de seguridad.",
    );
  }
  return result.normalizedText;
};

/* ========================================================================== *
 * Request helpers
 * ========================================================================== */

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

const getSafeOrigin = (url: string, allowCrossOrigin: boolean, origins: readonly string[]) => {
  let parsed: URL;
  try {
    parsed = new URL(url, isBrowser() ? window.location.origin : undefined);
  } catch {
    throw new IsabellaRequestError("INVALID_URL", "La URL de solicitud no es valida.");
  }

  if (
    parsed.protocol !== "https:" &&
    !(isBrowser() && parsed.origin === window.location.origin && parsed.protocol === "http:")
  ) {
    throw new IsabellaRequestError("INSECURE_URL", "La solicitud requiere un origen seguro.");
  }

  if (allowCrossOrigin && origins.includes(parsed.origin)) return parsed;
  if (isBrowser() && parsed.origin === window.location.origin) return parsed;
  throw new IsabellaRequestError(
    "ORIGIN_NOT_ALLOWED",
    "El origen de la solicitud no esta autorizado.",
  );
};

const bodyByteLength = (body: string) => new TextEncoder().encode(body).byteLength;

const getBodyWithPolicy = (
  body: BodyInit | null | undefined,
  promptFields: readonly string[],
  contentClass: IsabellaFetchOptions["contentClass"],
  reviewHighRisk: boolean,
  onPromptReview?: (result: PromptPolicyResult) => void,
  maxBodyBytes = 1_048_576,
): BodyInit | null | undefined => {
  if (body === null || body === undefined) return body;
  if (typeof body !== "string") return body;
  if (bodyByteLength(body) > maxBodyBytes) {
    throw new IsabellaRequestError(
      "BODY_TOO_LARGE",
      "El cuerpo de la solicitud excede el limite permitido.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return body;
  const object = parsed as Record<string, unknown>;
  const promptValues = collectPromptFields(object, promptFields);
  for (const { value } of promptValues) {
    const result = classifyPrompt(value, contentClass, reviewHighRisk);
    if (result.disposition === "review") onPromptReview?.(result);
    if (result.disposition === "deny") {
      throw new IsabellaRequestError(
        "PROMPT_POLICY_REJECTED",
        "La entrada requiere revision de seguridad.",
      );
    }
    const field = promptValues.find((item) => item.value === value)?.field;
    if (field) object[field] = result.normalizedText;
  }

  const rewritten = JSON.stringify(object);
  if (bodyByteLength(rewritten) > maxBodyBytes) {
    throw new IsabellaRequestError(
      "BODY_TOO_LARGE",
      "El cuerpo de la solicitud excede el limite permitido.",
    );
  }
  return rewritten;
};

const createTimeoutSignal = (timeoutMs: number, callerSignal?: AbortSignal) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("REQUEST_TIMEOUT"), timeoutMs);
  const abort = () => controller.abort(callerSignal?.reason ?? "REQUEST_ABORTED");
  if (callerSignal) {
    if (callerSignal.aborted) abort();
    else callerSignal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abort);
    },
  };
};

export const generateAuditId = (): string => `ISA-AUDIT-${randomUUID().toUpperCase()}`;

/* ========================================================================== *
 * Authenticated fetch
 * ========================================================================== */

const DEFAULT_CONFIG: IsabellaFetchConfig = {
  apiOrigins: [],
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 55_000,
  maxBodyBytes: 1_048_576,
  authMode: "cookie",
  accessToken: null,
  reviewHighRisk: false,
};

let runtimeConfig: IsabellaFetchConfig = { ...DEFAULT_CONFIG };

export const configureIsabellaFetch = (config: Partial<IsabellaFetchConfig>) => {
  const timeout = config.defaultTimeoutMs ?? runtimeConfig.defaultTimeoutMs ?? 30_000;
  const maxTimeout = config.maxTimeoutMs ?? runtimeConfig.maxTimeoutMs ?? 55_000;
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > maxTimeout) {
    throw new IsabellaRequestError("INVALID_TIMEOUT_CONFIG", "Configuracion de timeout invalida.");
  }
  if (!Number.isInteger(maxTimeout) || maxTimeout < timeout || maxTimeout > 120_000) {
    throw new IsabellaRequestError("INVALID_TIMEOUT_CONFIG", "Configuracion de timeout invalida.");
  }
  runtimeConfig = {
    ...runtimeConfig,
    ...config,
    apiOrigins: [...(config.apiOrigins ?? runtimeConfig.apiOrigins)],
    defaultTimeoutMs: timeout,
    maxTimeoutMs: maxTimeout,
    maxBodyBytes: config.maxBodyBytes ?? runtimeConfig.maxBodyBytes ?? 1_048_576,
  };
};

export const setInMemoryAccessToken = (accessToken: string | null) => {
  runtimeConfig = { ...runtimeConfig, accessToken, authMode: accessToken ? "memory" : "cookie" };
};

export const isabellaFetch = async (
  input: string | URL | Request,
  options: IsabellaFetchOptions = {},
): Promise<Response> => {
  const config = runtimeConfig;
  const method = (
    options.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const auditId = generateAuditId();
  const timeoutMs = Math.min(
    Math.max(options.timeoutMs ?? config.defaultTimeoutMs ?? 30_000, 1_000),
    config.maxTimeoutMs ?? 55_000,
  );
  const promptFields = options.promptFields ?? ["prompt", "input", "text"];

  const rawUrl = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
  const url = getSafeOrigin(rawUrl, options.allowCrossOrigin === true, config.apiOrigins);

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  headers.set("X-Isabella-Audit-ID", auditId);
  headers.set("Accept", headers.get("Accept") ?? "application/json");
  if (
    method !== "GET" &&
    method !== "HEAD" &&
    !headers.has("Content-Type") &&
    typeof options.body === "string"
  ) {
    headers.set("Content-Type", "application/json");
  }

  const body = getBodyWithPolicy(
    options.body,
    promptFields,
    options.contentClass ?? "user_input",
    config.reviewHighRisk ?? false,
    options.onPromptReview,
    config.maxBodyBytes ?? 1_048_576,
  );

  if (config.authMode === "memory" && config.accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${config.accessToken}`);
  }

  const timeout = createTimeoutSignal(timeoutMs, options.signal ?? undefined);
  try {
    const response = await fetch(url.toString(), {
      ...options,
      method,
      headers,
      body,
      credentials:
        options.credentials ?? (config.authMode === "cookie" ? "include" : "same-origin"),
      signal: timeout.signal,
    });

    if (!response.ok) {
      throw new IsabellaRequestError(
        "UPSTREAM_REQUEST_FAILED",
        "La solicitud no pudo completarse.",
        {
          status: response.status,
          auditId,
        },
      );
    }
    return response;
  } catch (error) {
    if (error instanceof IsabellaRequestError) throw error;
    if (timeout.signal.aborted) {
      throw new IsabellaRequestError(
        timeout.signal.reason === "REQUEST_TIMEOUT" ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED",
        "La solicitud fue cancelada o excedio el tiempo permitido.",
        { auditId },
      );
    }
    throw new IsabellaRequestError("NETWORK_ERROR", "No fue posible conectar con el servicio.", {
      auditId,
    });
  } finally {
    timeout.cleanup();
  }
};
