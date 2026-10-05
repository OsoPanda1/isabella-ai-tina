/**
 * TINA ethical triage + content hash (src/lib/tina/ethical.ts)
 * Fail-closed: critical findings block non-FAST paths.
 */
import { createHash } from "node:crypto";
import { analyzeAegisSemantic } from "../aegis-semantic";

export type TinaFindingSeverity = "critical" | "warning" | "info";

export interface TinaFinding {
  code: string;
  severity: TinaFindingSeverity;
  category: string;
  message: string;
  evidence?: string[];
}

export interface TinaEthicalResult {
  valid: boolean;
  score: number;
  flags: TinaFinding[];
  hash: string;
  limitations: string[];
  aegisVerdict?: "allow" | "flag" | "deny";
}

export interface TinaEthicalOptions {
  threshold?: number;
  failOnCritical?: boolean;
  maxLength?: number;
  useAegis?: boolean;
  history?: string[];
}

const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x7f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
];

function stripInvisible(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    const hidden = INVISIBLE_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
    if (!hidden) out += ch;
  }
  return out;
}

const PATTERNS: Array<{
  code: string;
  severity: TinaFindingSeverity;
  category: string;
  re: RegExp;
  message: string;
}> = [
  {
    code: "GOVERNANCE_BYPASS",
    severity: "critical",
    category: "governance",
    re: /\b(ignora(?:r|s|mos|n|ba|ban|se)? las pol[ií]ticas|salta(?:r|s|mos|n)? la autorizaci[oó]n|elimina(?:r|s|mos|n)? el audit trail|desactiv(?:a|ar|as|emos|en) la auditor[ií]a)\b/iu,
    message: "Posible elusión de controles.",
  },
  {
    code: "SECRET_INDICATOR",
    severity: "warning",
    category: "privacy",
    re: /\b(exfiltrar|clave privada|token secreto|contraseña)\b/iu,
    message: "Posible referencia a secretos o exfiltración.",
  },
  {
    code: "OPACITY_INDICATOR",
    severity: "warning",
    category: "opacity",
    re: /\b(ocultar|encubrir|engañar|falsear)\b/iu,
    message: "Indicador léxico que requiere contexto.",
  },
];

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export async function auditTinaContent(
  content: unknown,
  opts: TinaEthicalOptions = {},
): Promise<TinaEthicalResult> {
  const threshold = opts.threshold ?? 0.6;
  const failOnCritical = opts.failOnCritical ?? true;
  const maxLength = opts.maxLength ?? 1_000_000;
  const useAegis = opts.useAegis ?? true;

  if (typeof content !== "string") throw new TypeError("content debe ser string");
  if (content.length > maxLength) throw new RangeError("Contenido demasiado grande");

  const normalized = stripInvisible(content.normalize("NFKC")).replace(/\r\n?/g, "\n").trim();

  const flags: TinaFinding[] = [];
  for (const p of PATTERNS) {
    if (p.re.test(normalized)) {
      flags.push({
        code: p.code,
        severity: p.severity,
        category: p.category,
        message: p.message,
        evidence: [p.re.source],
      });
    }
  }

  let aegisVerdict: TinaEthicalResult["aegisVerdict"];
  if (useAegis) {
    const analysis = analyzeAegisSemantic(normalized, { history: opts.history ?? [] });
    aegisVerdict = analysis.verdict;
    if (analysis.verdict === "deny") {
      flags.push({
        code: "AEGIS_DENY",
        severity: "critical",
        category: "security",
        message: "AEGIS semántico denegó el contenido.",
        evidence: analysis.findings
          .slice(0, 5)
          .map((f) => String((f as { code?: string }).code ?? "finding")),
      });
    } else if (analysis.verdict === "flag") {
      flags.push({
        code: "AEGIS_FLAG",
        severity: "warning",
        category: "security",
        message: "AEGIS semántico marcó el contenido para revisión.",
      });
    }
  }

  if (
    !/\b(ética|transparencia|gobernanza|privacidad|trazabilidad|bienestar)\b/iu.test(normalized)
  ) {
    flags.push({
      code: "MISSING_ANCHOR",
      severity: "info",
      category: "quality",
      message: "No se detectó anclaje ético explícito; no demuestra una violación.",
    });
  }

  let score = 1;
  for (const f of flags) {
    score -= f.severity === "critical" ? 0.6 : f.severity === "warning" ? 0.2 : 0.05;
  }
  score = Math.max(0, Math.min(1, score));

  const hasCritical = flags.some((f) => f.severity === "critical");
  const valid = score >= threshold && (!failOnCritical || !hasCritical);

  return {
    valid,
    score,
    flags,
    hash: sha256Hex(normalized),
    aegisVerdict,
    limitations: [
      "El léxico no demuestra por sí solo una violación ética.",
      "SHA-256 demuestra integridad comparable, no verdad ni ética.",
      "La autoridad final debe estar en backend/CROWN.",
    ],
  };
}
