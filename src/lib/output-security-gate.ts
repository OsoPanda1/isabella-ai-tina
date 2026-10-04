/**
 * Gate de seguridad de salida (output PDP) — ISA-140 / ISA-175.
 *
 * AEGIS y el redactor corrían solo a la ENTRADA; este módulo aplica política
 * al texto GENERADO antes de emitirlo por SSE (fail-closed, AGENTS.md §4.2
 * "Validación de salida"). Patrón PDP: decisión ALLOW/FLAG/DENY sobre la
 * salida, independiente del modelo que la produjo.
 *
 * Capas:
 *  1. Patrones de credencial de alto valor (clave privada, AWS, Google, GitHub,
 *     Stripe, JWT, URL de base de datos) → DENY siempre.
 *  2. Redactor de secretos del sistema (`redact`) → DENY si altera la salida
 *     (la salida coincidió con un patrón de secreto).
 *  3. AEGIS semántico sobre la salida (`analyzeAegisSemantic`) → DENY/FLAG
 *     según umbrales 0.8/0.45 (exfiltración, inyección, PII masiva…).
 *  4. Cualquier error interno → DENY (fail-closed; nunca emitir sin evaluar).
 */
import { analyzeAegisSemantic, scanRetrievedDoc, type AegisFinding } from "./aegis-semantic";
import { redact, redactLogArg } from "./secret-redactor";

export type OutputSecurityVerdict = "allow" | "flag" | "deny";

export interface OutputSecurityFinding {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
}

export interface OutputSecurityResult {
  verdict: OutputSecurityVerdict;
  findings: OutputSecurityFinding[];
}

export const OUTPUT_GATE_REFUSAL =
  "La respuesta fue bloqueada por el gate de seguridad de salida (ARGUS): el texto generado contenía material no permitido (secretos o violación de política). Reformula la solicitud.";

/** Cola máxima de texto acumulado que se re-escanea por chunk en streaming. */
export const OUTPUT_SCAN_WINDOW = 100_000;

const CREDENTIAL_PATTERNS: ReadonlyArray<{ code: string; re: RegExp }> = [
  { code: "PRIVATE_KEY_BLOCK", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { code: "AWS_ACCESS_KEY", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: "GOOGLE_API_KEY", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { code: "GITHUB_TOKEN", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { code: "OPENAI_STYLE_KEY", re: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
  { code: "STRIPE_LIVE_KEY", re: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/ },
  {
    code: "JWT_CREDENTIAL",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  { code: "DATABASE_URL_CREDENTIAL", re: /\bpostgres(?:ql)?:\/\/[^\s:/@]+:[^\s@]+@/ },
];

function mapAegisFinding(finding: AegisFinding): OutputSecurityFinding {
  return {
    code: `AEGIS_${finding.signal.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
    severity: finding.severity,
    message: finding.detail,
  };
}

/**
 * Evalúa una salida ya generada. Nunca lanza: cualquier error interno
 * produce DENY (fail-closed).
 */
export function evaluateOutputSecurity(text: string): OutputSecurityResult {
  try {
    const findings: OutputSecurityFinding[] = [];
    for (const { code, re } of CREDENTIAL_PATTERNS) {
      if (re.test(text)) {
        findings.push({
          code,
          severity: "critical",
          message: `Patrón de credencial en la salida (${code}).`,
        });
      }
    }
    if (redact(text) !== text) {
      findings.push({
        code: "REDACTOR_HIT",
        severity: "critical",
        message: "La salida coincidió con un patrón de secreto del redactor del sistema.",
      });
    }
    // El texto generado/traído por retrieval se evalúa como dato NO confiable
    // (frontera TINA): una salida que intenta volverse autoridad debe denegarse.
    const aegis = analyzeAegisSemantic(text, {
      untrustedData: [{ text, source: "model-output" }],
    });
    for (const finding of aegis.findings) findings.push(mapAegisFinding(finding));
    // Frontera TINA: una salida que se presenta como "directiva oficial" para
    // ignorar política es fabricación de autoridad; aplica aquí el detector de
    // retrieval-poisoning (policy-forgery = critical) sobre el texto generado.
    for (const finding of scanRetrievedDoc({ text, source: "model-output" })) {
      findings.push(mapAegisFinding(finding));
    }

    const hasCritical = findings.some((finding) => finding.severity === "critical");
    if (hasCritical || aegis.verdict === "deny") {
      return { verdict: "deny", findings };
    }
    const flagged =
      aegis.verdict === "flag" || findings.some((finding) => finding.severity === "high");
    return { verdict: flagged ? "flag" : "allow", findings };
  } catch (error) {
    return {
      verdict: "deny",
      findings: [
        {
          code: "OUTPUT_GATE_ERROR",
          severity: "critical",
          message: `El gate de salida falló; denegación por defecto: ${redactLogArg(
            error instanceof Error ? error.message : String(error),
          )}`,
        },
      ],
    };
  }
}

function extractFrameContent(payload: string): string | null {
  try {
    const event = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
      content?: unknown;
    };
    const candidate =
      event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content ?? event.content;
    return typeof candidate === "string" && candidate ? candidate : null;
  } catch {
    return null;
  }
}

export interface OutputGateDecision {
  (result: OutputSecurityResult): void;
}

/** Marco SSE de rechazo: emite la negativa en formato OpenAI y cierra. */
export function outputGateRefusalFrame(result: OutputSecurityResult): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content: OUTPUT_GATE_REFUSAL } }],
    output_gate: { verdict: "deny", findings: result.findings.map((f) => f.code) },
  })}\n\n`;
}

export interface OutputGateTracker {
  /** Acumula un fragmento emitible y lo evalúa contra la política de salida. */
  push(chunk: string): OutputSecurityResult;
}

/**
 * Rastreador de acumulación para emisión incremental: cada `push` re-evalúa
 * la ventana acumulada (cubre secretos partidos entre chunks).
 */
export function createOutputGateTracker(onDecision?: OutputGateDecision): OutputGateTracker {
  let accumulated = "";
  return {
    push(chunk: string): OutputSecurityResult {
      accumulated += chunk;
      const window =
        accumulated.length > OUTPUT_SCAN_WINDOW
          ? accumulated.slice(-OUTPUT_SCAN_WINDOW)
          : accumulated;
      const result = evaluateOutputSecurity(window);
      if (result.verdict !== "allow") onDecision?.(result);
      return result;
    },
  };
}

/**
 * Envuelve un stream SSE compatible OpenAI (`data: {choices:[{delta:{content}}]}`)
 * y evalúa CADA fragmento (acumulado) antes de emitirlo. En DENY cancela el
 * upstream, emite el marco de rechazo y cierra con `[DONE]`.
 */
export function gateOpenAiSseStream(
  source: ReadableStream<Uint8Array>,
  onDecision?: OutputGateDecision,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = source.getReader();
  let lineBuffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (line: string): void => controller.enqueue(encoder.encode(line));
      const sse = (payload: string): string => `data: ${payload}\n\n`;
      let denied = false;
      const gate = createOutputGateTracker(onDecision);

      const handleContent = (content: string): boolean => {
        const result = gate.push(content);
        if (result.verdict === "allow") return true;
        if (result.verdict === "deny") {
          denied = true;
          void reader.cancel().catch(() => undefined);
          emit(outputGateRefusalFrame(result));
          emit(sse("[DONE]"));
          controller.close();
          return false;
        }
        return true;
      };

      const handleLine = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (!trimmed.startsWith("data:")) {
          emit(`${trimmed}\n`);
          return true;
        }
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          emit(sse("[DONE]"));
          return true;
        }
        const content = extractFrameContent(payload);
        if (content && !handleContent(content)) return false;
        emit(`${line}\n\n`);
        return true;
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (denied) continue;
          lineBuffer += decoder.decode(value, { stream: true });
          const frames = lineBuffer.split(/\r?\n/);
          lineBuffer = frames.pop() ?? "";
          for (const raw of frames) {
            if (!handleLine(raw)) return;
          }
        }
        if (denied) return;
        const rest = lineBuffer.trim();
        if (rest && !handleLine(rest)) return;
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ya liberado por cancel() */
        }
      }
    },
  });
}


/**
 * Backward-compatible contract retained for Sovereign Pipeline and older
 * callers. The canonical inspection remains evaluateOutputSecurity().
 */
export interface OutputSecurityInspection {
  safe: boolean;
  sanitizedText: string;
  violations: string[];
  redactionApplied: boolean;
}

export function inspectAndSanitizeOutput(rawOutput: string): OutputSecurityInspection {
  if (typeof rawOutput !== "string" || rawOutput.length === 0) {
    return { safe: true, sanitizedText: "", violations: [], redactionApplied: false };
  }
  const result = evaluateOutputSecurity(rawOutput);
  const redacted = redact(rawOutput);
  const redactionApplied = redacted !== rawOutput;
  const sanitizedText =
    result.verdict === "deny"
      ? redactionApplied
        ? redacted
        : OUTPUT_GATE_REFUSAL
      : redacted;

  return {
    safe: result.verdict === "allow",
    sanitizedText,
    violations: result.findings.map((finding) => finding.code),
    redactionApplied,
  };
}
