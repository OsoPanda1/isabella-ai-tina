import { normalizeKnowledgeText } from "./identity";

const SECRET_PATTERNS = [
  /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*\S+/gi,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
];

export interface SanitizationResult {
  readonly content: string;
  readonly redactions: number;
  readonly warnings: readonly string[];
  readonly safeForIndexing: boolean;
}

export function sanitizeKnowledgeContent(content: string): SanitizationResult {
  let sanitized = normalizeKnowledgeText(content);
  let redactions = 0;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, () => {
      redactions += 1;
      return "[REDACTED_SECRET]";
    });
  }
  const warnings = redactions > 0 ? ["secret_or_credential_redacted"] : [];
  return {
    content: sanitized,
    redactions,
    warnings,
    safeForIndexing: !sanitized.includes("-----BEGIN"),
  };
}
