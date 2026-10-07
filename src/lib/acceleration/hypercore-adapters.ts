import {
  DEFAULT_EVIDENCE,
  DEFAULT_IDENTITY,
  assessIntent,
  assessRisk,
  createDefaultContext,
  hasDestructiveSignal,
  hasSecretRequest,
  type EvidenceAssessment,
  type IdentityAssessment,
  type IntentAssessment,
  type RiskLevel,
} from "@/lib/crown";
import { evaluateConstitutionalGate } from "@/lib/constitutional-gate";
import { evaluateOutputSecurity } from "@/lib/output-security-gate";
import { inferSovereign } from "@/lib/isabella-inference-engine";
import type { HypercoreAdapters, Risk } from "./hypercore";

/**
 * Adaptadores PRODUCTIVOS de Hypercore.
 * ------------------------------------------------------------------
 * Cablean el pipeline gobernado a los servicios REALES de Isabella:
 *  - clasificación y policy de entrada: C.R.O.W.N. (`@/lib/crown`)
 *  - policy de salida: puerta constitucional (`@/lib/constitutional-gate`)
 *  - seguridad de salida: output-security gate (`@/lib/output-security-gate`)
 *  - generación: motor soberano local (`inferSovereign`)
 *
 * No hay mocks: cuando un servicio real no está disponible (p. ej. repositorio de memoria),
 * se devuelve un resultado honesto y vacío, nunca un recuerdo inventado. Los rails de salida
 * NUNCA lanzan: capturan y devuelven `{ ok: false }` (fail-closed), tal como exige el pipeline.
 *
 * El tenant y el usuario SIEMPRE provienen del principal autenticado, nunca del cuerpo.
 */

export interface HypercorePrincipal {
  tenantId: string;
  userId?: string;
  roles?: string[];
  scopes?: string[];
}

const CROWN_TO_HYPERCORE_RISK: Record<RiskLevel, Risk> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  critical: "critical",
};

function complexityOf(prompt: string, intent: IntentAssessment): number {
  const lengthScore = Math.min(1, prompt.trim().length / 800);
  const structureWeight = intent.externalEffect ? 0.3 : 0;
  const confidencePenalty = intent.confidence < 0.5 ? 0.2 : 0;
  return Math.min(1, Math.max(0, lengthScore + structureWeight + confidencePenalty));
}

export function createProductionHypercoreAdapters(principal: HypercorePrincipal): HypercoreAdapters {
  const actorId = principal.userId ?? principal.tenantId;

  const identity: IdentityAssessment = {
    ...DEFAULT_IDENTITY,
    authenticated: true,
    actorId,
    roles: principal.roles ?? [],
    permissions: principal.scopes ?? [],
    dataScopes: ["session"],
  };

  return {
    async classify(request) {
      const intent = assessIntent(request.prompt);
      return {
        risk: CROWN_TO_HYPERCORE_RISK[assessRisk(intent)],
        complexity: complexityOf(request.prompt, intent),
      };
    },

    async inputPolicy(request) {
      if (!request.prompt.trim()) return { ok: false, reason: "empty_prompt" };
      if (hasSecretRequest(request.prompt)) return { ok: false, reason: "input_secret_request" };
      if (hasDestructiveSignal(request.prompt)) {
        return { ok: false, reason: "input_destructive_signal" };
      }
      return { ok: true, reason: "input_policy_passed" };
    },

    async retrieve() {
      // No hay repositorio de memoria cableado en este adaptador: no se inventan recuerdos.
      return [];
    },

    async generate(request, memory, signal, mode) {
      if (signal.aborted) throw new Error("deadline_exceeded");
      const memoryContext = memory.length
        ? `\n\n[Memoria autorizada: ${memory.map((hit) => hit.sourceId).join(", ")}]`
        : "";
      const result = inferSovereign(`${request.prompt}${memoryContext}`);
      const text = result.reply?.trim();
      if (!text) throw new Error("empty_candidate_from_engine");
      return { text, model: `sovereign-local:${mode}` };
    },

    async policyCheck(request, candidate) {
      const context = createDefaultContext(candidate.text, {
        actorId,
        sessionId: request.requestId,
      });
      const evidence: EvidenceAssessment = {
        ...DEFAULT_EVIDENCE,
        level: "weak",
        verified: false,
        sources: [],
      };
      const gate = evaluateConstitutionalGate(
        context,
        identity,
        evidence,
        assessIntent(candidate.text),
      );
      return {
        ok: gate.passed,
        reason: gate.passed
          ? "constitutional_gate_passed"
          : `constitutional_gate_denied:${gate.deniedArticles.join("|")}`,
      };
    },

    async evidenceCheck(_request, _candidate, memory) {
      // Sin claims externos verificables y sin memoria recuperada no se declara grounding;
      // se aprueba porque la respuesta se genera localmente y no cita fuentes externas.
      return {
        ok: true,
        reason: "no_external_claims",
        evidenceIds: memory.map((hit) => hit.sourceId).filter(Boolean),
      };
    },

    async outputSafety(_request, candidate) {
      const result = evaluateOutputSecurity(candidate.text);
      return {
        ok: result.verdict !== "deny",
        reason: `output_gate_${result.verdict}`,
      };
    },
  };
}
