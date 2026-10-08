/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — DUAL HEXAGONAL KERNEL / COORDINATOR
 * Orquesta Alpha (comprende, investiga, propone) y
 * Beta (autentica, gobierna, ejecuta, verifica).
 * Flujo: intención → Alpha → propuesta → Beta → respuesta
 * ================================================================
 */

import { randomUUID } from "node:crypto";

import type {
  EvidenceRecord,
  IsabellaDualRequest,
  IsabellaDualResponse,
  OperationState,
  Proposal,
  ProvenanceRecord,
  SensitivityLevel,
  TelemetryRecord,
} from "./contracts";

/* Alpha modules */
import { perceptionEngine } from "./alpha/perception";
import { contextBuilder } from "./alpha/context";
import { alphaMemory } from "./alpha/memory";
import { researchEngine } from "./alpha/research";
import { hypothesisEngine } from "./alpha/hypothesis";
import { proposalEngine } from "./alpha/proposal";

/* Beta modules */
import { identityResolver } from "./beta/identity";
import { classificationEngine } from "./beta/classification";
import { riskEngine } from "./beta/risk";
import { policyEngine } from "./beta/policy";
import { capabilityRegistry } from "./beta/capability";
import { verificationEngine } from "./beta/verification";

/* =========================================================================
   TYPE BRIDGES
   ========================================================================= */

const CLASSIFICATION_LEVELS = [
  "public",
  "internal",
  "private",
  "sensitive",
  "restricted",
  "critical",
] as const;

function toSensitivityMax(classification: string): SensitivityLevel {
  const classIndex = CLASSIFICATION_LEVELS.indexOf(
    classification as (typeof CLASSIFICATION_LEVELS)[number],
  );
  if (classIndex <= 1) return "public";
  if (classIndex <= 3) return "internal";
  if (classIndex <= 4) return "confidential";
  return "secret";
}

/* =========================================================================
   DUAL KERNEL
   ========================================================================= */

export class DualKernel {
  /**
   * Process a request through the full Alpha → Beta pipeline.
   */
  async process(request: IsabellaDualRequest): Promise<IsabellaDualResponse> {
    const startTime = Date.now();
    let state: OperationState = "received";
    const evidence: EvidenceRecord[] = [];

    try {
      /* ─── BETA: Identity Resolution ───────────────────────── */
      state = "identified";
      const identity = identityResolver.resolve({
        actorId: request.actorId,
        tenantId: request.tenantId,
        ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
      });

      /* ─── BETA: Classification ────────────────────────────── */
      state = "classified";
      const classification = classificationEngine.classify(request.intent, {
        intentCategory: request.mode,
      });

      /* ─── ALPHA: Perception ───────────────────────────────── */
      state = "alpha_processing";
      const perception = await perceptionEngine.process(request.intent);

      /* ─── ALPHA: Context Building ─────────────────────────── */
      state = "context_ready";
      contextBuilder.build({
        session: {
          sessionId: request.sessionId ?? randomUUID(),
          startedAt: new Date().toISOString(),
          turnCount: 0,
          lastActivityAt: new Date().toISOString(),
          memoryEnabled: request.context?.memoryEnabled ?? true,
        },
        project: {
          ...(request.context?.projectId !== undefined
            ? { projectId: request.context.projectId }
            : {}),
        },
        territory: {
          territoryName: request.context?.territory ?? "Mineral del Monte",
        },
        constraints: {
          ...(request.constraints?.maxLatencyMs !== undefined
            ? { maxLatencyMs: request.constraints.maxLatencyMs }
            : {}),
          ...(request.constraints?.maxCostUsd !== undefined
            ? { maxCostUsd: request.constraints.maxCostUsd }
            : {}),
          ...(request.constraints?.maxSteps !== undefined
            ? { maxSteps: request.constraints.maxSteps }
            : {}),
          requiredCapabilities: request.requestedCapabilities ?? [],
          forbiddenCapabilities: [],
        },
      });

      /* ─── ALPHA: Memory Retrieval ─────────────────────────── */
      if (request.context?.memoryEnabled !== false) {
        const memories = await alphaMemory.retrieve({
          query: request.intent,
          scopes: ["session", "project", "territorial"],
          sensitivityMax: toSensitivityMax(classification.classification),
          maxResults: 10,
        });

        for (const mem of memories) {
          evidence.push({
            evidenceId: randomUUID(),
            type: "data",
            claim: mem.content,
            confidence: mem.confidence,
            source: mem.source,
            retrievedAt: mem.createdAt,
          });
        }
      }

      /* ─── ALPHA: Research ─────────────────────────────────── */
      const research = await researchEngine.research({
        query: request.intent,
        methods: ["lexical", "vector"],
        maxResults: 5,
        minRelevance: 0.5,
      });

      for (const result of research.results) {
        evidence.push({
          evidenceId: randomUUID(),
          type: "source",
          claim: result.content,
          confidence: result.confidence,
          source: result.source,
          retrievedAt: result.retrievedAt,
        });
      }

      /* ─── ALPHA: Hypothesis Generation ────────────────────── */
      const hypotheses = hypothesisEngine.generate({
        query: request.intent,
        researchConfidence: research.overallConfidence,
        entities: perception.entities,
        intentCategory: perception.intent,
      });

      /* ─── ALPHA: Proposal Generation ──────────────────────── */
      state = "proposal_ready";
      const proposal = proposalEngine.generate({
        query: request.intent,
        intent: perception.intent,
        hypothesis: hypotheses[0]?.statement ?? request.intent,
        alternatives: hypotheses[0]?.alternatives ?? [],
        risks: hypotheses[0]?.risks ?? [],
        experiments: hypotheses[0]?.experiments ?? [],
        ...(request.constraints !== undefined ? { constraints: request.constraints } : {}),
      });

      /* ─── BETA: Risk Assessment ───────────────────────────── */
      const risk = riskEngine.assess({
        intent: request.intent,
        classification: classification.classification,
        involvesFinancial: request.mode === "monetization",
        involvesGovernance: request.mode === "implementation",
      });

      /* ─── BETA: Policy Evaluation (CROWN) ─────────────────── */
      state = "beta_evaluating";
      const governance = policyEngine.evaluate({
        identity: {
          actorId: identity.actorId,
          tenantId: identity.tenantId,
          roles: identity.roles,
          scopes: identity.scopes,
          assuranceLevel: identity.assuranceLevel,
        },
        risk: {
          level: risk.level,
          requiresApproval: risk.requiresApproval,
        },
        classification: classification.classification,
        intent: request.intent,
        requestedCapabilities: request.requestedCapabilities ?? [],
      });

      /* ─── BETA: Capability Selection ──────────────────────── */
      if (governance.result === "allow" || governance.result === "review") {
        const capability = capabilityRegistry.select({
          intent: request.intent,
          requestedCapabilities: request.requestedCapabilities ?? [],
          allowedScopes: identity.scopes,
          ...(request.constraints !== undefined ? { constraints: request.constraints } : {}),
        });

        if (capability) {
          evidence.push({
            evidenceId: randomUUID(),
            type: "data",
            claim: `Selected capability: ${capability.capabilityId}`,
            confidence: 0.9,
            source: "capability_registry",
            retrievedAt: new Date().toISOString(),
          });
        }
      }

      /* ─── BETA: Verification ──────────────────────────────── */
      state = "verifying";
      const answer = this.generateAnswer(proposal, perception.intent);

      const provenance: ProvenanceRecord = {
        auditId: randomUUID(),
        requestHash: this.hashString(request.intent),
        outputHash: this.hashString(answer),
        policyHash: this.hashString(JSON.stringify(governance)),
        toolRefs: [],
        memoryRefs: evidence.map((e) => e.evidenceId),
        createdAt: new Date().toISOString(),
      };

      const verification = verificationEngine.verify({
        response: answer,
        governance,
        evidence,
        provenance,
        costUsd: request.constraints?.maxCostUsd ?? 0,
        reversible: governance.reversible,
      });

      /* ─── BUILD RESPONSE ──────────────────────────────────── */
      state = governance.result === "review" ? "approval_required" : "completed";

      const telemetry: TelemetryRecord = {
        traceId: randomUUID().replace(/-/g, "").slice(0, 32),
        alpha: {
          intentConfidence: perception.intentConfidence,
          memoryHitRate: evidence.length > 0 ? 0.8 : 0,
          retrievalRelevance: research.overallConfidence,
          hypothesisCount: hypotheses.length,
          claimUncertainty: 1 - research.overallConfidence,
          proposalGenerationMs: Date.now() - startTime,
        },
        beta: {
          policyAllowTotal: governance.result === "allow" ? 1 : 0,
          policyDenyTotal: governance.result === "deny" ? 1 : 0,
          reviewRequiredTotal: governance.result === "review" ? 1 : 0,
          scopeDenialTotal: governance.scopeDenials.length,
          verificationFailureTotal: verification.checks.filter((c) => !c.passed).length,
          fallbackTotal: 0,
        },
        runtime: {
          modelLatencyMs: Date.now() - startTime,
          queueLatencyMs: 0,
          toolLatencyMs: 0,
          costUsd: request.constraints?.maxCostUsd ?? 0,
        },
      };

      return {
        requestId: request.requestId,
        status: governance.result === "review" ? "review_required" : "completed",
        answer,
        proposal,
        governance,
        evidence,
        provenance,
        telemetry,
        state,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      state = "degraded";
      return {
        requestId: request.requestId,
        status: "degraded",
        answer: `Processing error: ${error instanceof Error ? error.message : "Unknown error"}`,
        governance: {
          decisionId: randomUUID(),
          result: "defer",
          riskLevel: "R2_moderate",
          classification: "internal",
          policyIds: [],
          reason: "Error during processing",
          scopeDenials: [],
          reviewRequired: true,
          reversible: true,
          evaluatedAt: new Date().toISOString(),
        },
        evidence: [],
        provenance: {
          auditId: randomUUID(),
          requestHash: "",
          outputHash: "",
          policyHash: "",
          toolRefs: [],
          memoryRefs: [],
          createdAt: new Date().toISOString(),
        },
        telemetry: {
          traceId: randomUUID().replace(/-/g, "").slice(0, 32),
          alpha: {
            intentConfidence: 0,
            memoryHitRate: 0,
            retrievalRelevance: 0,
            hypothesisCount: 0,
            claimUncertainty: 1,
            proposalGenerationMs: Date.now() - startTime,
          },
          beta: {
            policyAllowTotal: 0,
            policyDenyTotal: 0,
            reviewRequiredTotal: 1,
            scopeDenialTotal: 0,
            verificationFailureTotal: 1,
            fallbackTotal: 1,
          },
          runtime: {
            modelLatencyMs: Date.now() - startTime,
            queueLatencyMs: 0,
            toolLatencyMs: 0,
            costUsd: 0,
          },
        },
        state,
        createdAt: new Date().toISOString(),
      };
    }
  }

  private generateAnswer(proposal: Proposal, _intent: string): string {
    return (
      `Based on analysis, here is a structured response regarding: ${proposal.problem}\n\n` +
      `Value: ${proposal.valueProposition}\n\n` +
      `First deliverable: ${proposal.firstDeliverable}\n\n` +
      `Alternatives available: ${proposal.alternatives.length}`
    );
  }

  private hashString(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }
}

export const dualKernel = new DualKernel();
