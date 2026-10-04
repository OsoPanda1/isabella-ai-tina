/**
 * Fachada del gate de salida heredada de PR #389 — ahora delega en el PDP de
 * salida canónico (`@/lib/output-security-gate`, ISA-140/175) para que exista
 * UNA sola implementación: patrones de credencial + redactor + AEGIS semántico,
 * fail-closed. Se conserva la API (`scanOutput`/`safeOutputOrBlock`) que usan
 * las pruebas de seguridad (output-gate, tina-output-gate, pii-egress).
 */
import { analyzeAegisSemantic, type AegisAnalysis } from "@/lib/aegis-semantic";
import { evaluateOutputSecurity } from "@/lib/output-security-gate";

export interface OutputGateResult {
  allowed: boolean;
  text: string;
  analysis: AegisAnalysis;
  reasons: string[];
}

export function scanOutput(text: string, source = "model-output"): OutputGateResult {
  const decision = evaluateOutputSecurity(text);
  const analysis = analyzeAegisSemantic(text, { untrustedData: [{ text, source }] });
  const allowed = decision.verdict === "allow";
  const reasons = [...new Set(decision.findings.map((finding) => finding.code))];
  return allowed
    ? { allowed, text, analysis, reasons: [] }
    : { allowed, text: "", analysis, reasons };
}

export function safeOutputOrBlock(text: string, source = "model-output"): string {
  const result = scanOutput(text, source);
  return result.allowed
    ? result.text
    : "La salida fue retenida por el gate de seguridad de Isabella.";
}
