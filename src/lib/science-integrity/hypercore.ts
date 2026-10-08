/**
 * Science Integrity — Rail Hypercore (B3)
 * -----------------------------------------------------------------
 * Hypercore es el rail de ejecución/aceleración gobernada del pipeline científico:
 * la verificación corre dentro de `executeHypercore` con adaptadores REALES
 * (CROWN, puerta constitucional, output-security) y el `mandatoryGate` SIEMPRE
 * se ejecuta (fail-closed). El ledger del reporte se escribe una sola vez (memo),
 * nunca duplicado por la verificación en paralelo.
 */
import { createProductionHypercoreAdapters } from "../acceleration/hypercore-adapters";
import { evaluateOutputSecurity } from "../output-security-gate";
import {
  executeHypercore,
  HypercoreTTLCache,
  type Candidate,
  type HypercoreAdapters,
  type HypercoreRequest,
  type HypercoreResult,
  type Verdict,
} from "../acceleration/hypercore";
import { parseScientificDocument } from "./contracts";
import {
  runScienceIntegrityPipeline,
  type ScienceIntegrityPipelineReport,
  type ScienceIntegrityRuntime,
} from "./pipeline";
import { createLogger } from "../logger";

const log = createLogger("science-integrity.hypercore");

const sharedScienceMemo = new Map<string, ScienceIntegrityPipelineReport>();

/** El prompt de Hypercore es string: se deserializa como JSON-LD antes de validar. */
function promptDocument(prompt: string): unknown {
  try {
    return JSON.parse(prompt) as unknown;
  } catch {
    return prompt;
  }
}

export interface ScienceHypercoreOptions {
  cache?: HypercoreTTLCache;
  memo?: Map<string, ScienceIntegrityPipelineReport>;
}

export function createScienceIntegrityHypercoreAdapters(
  runtime: ScienceIntegrityRuntime,
  memo: Map<string, ScienceIntegrityPipelineReport> = sharedScienceMemo,
): { adapters: HypercoreAdapters; memo: Map<string, ScienceIntegrityPipelineReport> } {

  async function runPipeline(request: HypercoreRequest): Promise<ScienceIntegrityPipelineReport> {
    const existing = memo.get(request.requestId);
    if (existing) return existing;
    const parsed = parseScientificDocument(promptDocument(request.prompt));
    if (!parsed.ok) throw new Error(`invalid_document:${parsed.reason}`);
    const result = await runScienceIntegrityPipeline(
      { document: parsed.value },
      {
        ledger: runtime.ledger,
        ncua: runtime.ncua,
      },
    );
    if (!result.ok) throw new Error(result.reason);
    memo.set(request.requestId, result.value);
    return result.value;
  }

  const adapters: HypercoreAdapters = {
    async classify(request, signal) {
      if (signal.aborted) throw new Error("deadline_exceeded");
      const parsed = parseScientificDocument(promptDocument(request.prompt));
      if (!parsed.ok) throw new Error("invalid_document");
      return {
        risk: parsed.value.domains.includes("medical") || parsed.value.domains.includes("legal")
          ? "high"
          : "medium",
        complexity: Math.min(1, parsed.value.claims.length / 50),
      };
    },

    async inputPolicy(request, signal) {
      if (signal.aborted) throw new Error("deadline_exceeded");
      const parsed = parseScientificDocument(promptDocument(request.prompt));
      if (!parsed.ok) return { ok: false, reason: parsed.reason };
      if (!parsed.value.tenantId.trim()) return { ok: false, reason: "missing_tenant" };
      return { ok: true, reason: "scientific_document_valid" };
    },

    async retrieve() {
      // No se inventan recuerdos: sin repositorio de memoria cableado, vacío honesto.
      return [];
    },

    async generate(request, _memory, signal, mode, _decision) {
      if (signal.aborted) throw new Error("deadline_exceeded");
      const report = await runPipeline(request);
      return {
        text: JSON.stringify(report),
        model: `science-integrity:${mode}`,
        tokensIn: 0,
        tokensOut: 0,
      } satisfies Candidate;
    },

    async policyCheck(request, candidate, signal) {
      if (signal.aborted) throw new Error("deadline_exceeded");
      const report = memo.get(request.requestId);
      if (!report) return { ok: false, reason: "pipeline_report_missing" };
      const base = createProductionHypercoreAdapters({
        tenantId: request.tenantId,
        userId: request.userId,
      });
      return base.policyCheck(request, candidate, signal);
    },

    async evidenceCheck(request, _candidate, memory, signal) {
      if (signal.aborted) throw new Error("deadline_exceeded");
      void memory;
      const report = memo.get(request.requestId);
      if (!report) return { ok: false, reason: "evidence_report_missing" };
      const grounded = report.components.claims.groundingScore >= 0.6;
      return {
        ok: grounded,
        reason: grounded ? "claims_grounded" : "claims_not_grounded",
        evidenceIds: [report.ledger.ingestEvent.currentHash],
      } satisfies Verdict;
    },

    async outputSafety(_request, candidate, signal) {
      if (signal.aborted) throw new Error("deadline_exceeded");
      const result = evaluateOutputSecurity(candidate.text);
      return { ok: result.verdict !== "deny", reason: `output_gate_${result.verdict}` };
    },
  };

  return { adapters, memo };
}

export async function runScienceHypercoreVerify(
  input: unknown,
  runtime: ScienceIntegrityRuntime,
  options: ScienceHypercoreOptions = {},
): Promise<HypercoreResult> {
  const { adapters } = createScienceIntegrityHypercoreAdapters(runtime, options.memo);
  const result = await executeHypercore(input, adapters, {
    cache: options.cache ?? new HypercoreTTLCache(),
    policyFingerprint: "science-integrity-v1",
    systemFingerprint: "isabella-science-integrity",
  });
  log.info("hypercore_science_verify", {
    ok: result.ok,
    mode: result.mode,
    reason: result.reason,
  });
  return result;
}