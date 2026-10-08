/**
 * Pipeline orquestador de Isabella Villaseñor AI.
 *
 * Implementa el ciclo canónico:
 * Perceive → Remember → Policy Gate → Decide → Act → Audit
 *
 * Integra C.R.O.W.N., memoria y skills en un flujo unificado.
 */

import {
  createDefaultContext,
  assessIntent,
  evaluatePolicy,
  selectModules,
  resolveAllowedMemoryScopes,
  resolveAllowedTools,
  responseModeFor,
  buildAuditEvents,
  buildSystemPrompt,
  DEFAULT_IDENTITY,
  type RoutingDecision,
  type CrownAuditEvent,
} from "../crown";
import { memory, type MemoryRecord } from "./memory";
import { skillRegistry, type SkillWithStatus } from "./skills";

export type PipelineStage =
  "idle" | "perceive" | "remember" | "policy" | "decide" | "act" | "audit" | "complete" | "error";

export interface PipelineContext {
  requestId: string;
  traceId: string;
  input: string;
  timestamp: string;
  locale: string;
}

export interface PipelineResult {
  context: PipelineContext;
  stage: PipelineStage;
  routing: RoutingDecision;
  auditEvents: CrownAuditEvent[];
  memoryRecords: MemoryRecord[];
  availableSkills: SkillWithStatus[];
  systemPrompt: string;
  startedAt: string;
  completedAt: string;
  stageTimings: Record<PipelineStage, number>;
}

function generateRequestId(): string {
  return `req-${crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trackStage<T>(_stage: PipelineStage, fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  return { result, ms };
}

export class IsabellaPipeline {
  private currentStage: PipelineStage = "idle";
  private listeners: Array<(stage: PipelineStage) => void> = [];

  get stage(): PipelineStage {
    return this.currentStage;
  }

  subscribe(listener: (stage: PipelineStage) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private setStage(stage: PipelineStage): void {
    this.currentStage = stage;
    for (const listener of this.listeners) {
      listener(stage);
    }
  }

  async execute(
    input: string,
    options?: {
      locale?: string;
      identity?: {
        authenticated: boolean;
        actorId?: string | undefined;
        roles?: string[];
        permissions?: string[];
      };
    },
  ): Promise<PipelineResult> {
    const startedAt = nowIso();
    const stageTimings: Record<PipelineStage, number> = {
      idle: 0,
      perceive: 0,
      remember: 0,
      policy: 0,
      decide: 0,
      act: 0,
      audit: 0,
      complete: 0,
      error: 0,
    };

    const requestId = generateRequestId();

    // Stage 1: Perceive
    this.setStage("perceive");
    const { result: perceiveResult, ms: perceiveMs } = trackStage("perceive", () => {
      const context = createDefaultContext(input, {
        locale: options?.locale ?? "es-MX",
        source: "user",
      });
      return context;
    });
    stageTimings.perceive = perceiveMs;

    const traceId = `tr-${crypto.randomUUID()}`;

    // Stage 2: Remember
    this.setStage("remember");
    const { result: memoryRecords, ms: rememberMs } = trackStage("remember", () => {
      return memory.query({
        scope: ["immediate", "session"],
        search: input.slice(0, 200),
        limit: 5,
      });
    });
    stageTimings.remember = rememberMs;

    // Stage 3: Policy Gate
    this.setStage("policy");
    const { result: policyResult, ms: policyMs } = trackStage("policy", () => {
      const intent = assessIntent(perceiveResult.input);
      const policy = evaluatePolicy(perceiveResult, intent);
      return { intent, policy };
    });
    stageTimings.policy = policyMs;

    // Stage 4: Decide
    this.setStage("decide");
    const { result: routing, ms: decideMs } = trackStage("decide", () => {
      const route = selectModules(policyResult.intent);
      const normalizedIdentity: import("../crown").IdentityAssessment = options?.identity
        ? {
            authenticated: options.identity.authenticated,
            ...(options.identity.actorId !== undefined
              ? { actorId: options.identity.actorId }
              : {}),
            roles: options.identity.roles ?? [],
            permissions: options.identity.permissions ?? [],
            dataScopes: ["turn" as const, "session" as const, "project" as const],
          }
        : DEFAULT_IDENTITY;
      const memoryScopes = resolveAllowedMemoryScopes(policyResult.intent, normalizedIdentity);
      const allowedTools = resolveAllowedTools(policyResult.policy, policyResult.intent);
      const responseMode = responseModeFor(policyResult.policy);

      const decision: RoutingDecision = {
        requestId,
        traceId,
        crownVersion: "2.0.0",
        primary: route.primary,
        supporting: route.supporting,
        policy: policyResult.policy,
        identity: normalizedIdentity,
        intent: policyResult.intent,
        evidence: {
          level: "none",
          sources: [],
          verified: false,
          limitations: [],
        },
        memoryScopes,
        allowedTools,
        responseMode,
        createdAt: nowIso(),
      };

      return decision;
    });
    stageTimings.decide = decideMs;

    // Stage 5: Act (resolve available skills)
    this.setStage("act");
    const { result: availableSkills, ms: actMs } = trackStage("act", () => {
      const intent = policyResult.intent;
      const categoryMap: Record<string, string[]> = {
        knowledge: ["knowledge", "analysis"],
        coding: ["coding"],
        creative: ["creative"],
        analysis: ["analysis"],
        governance: ["governance"],
        conversation: ["communication"],
        security: ["governance"],
      };
      const relevantCategories = categoryMap[intent.category] ?? ["knowledge"];
      return skillRegistry.getActive().filter((s) => relevantCategories.includes(s.category));
    });
    stageTimings.act = actMs;

    // Stage 6: Audit
    this.setStage("audit");
    const { result: auditEvents, ms: auditMs } = trackStage("audit", () => {
      return buildAuditEvents(perceiveResult, routing);
    });
    stageTimings.audit = auditMs;

    const systemPrompt = buildSystemPrompt(routing);

    this.setStage("complete");

    const pipelineContext: PipelineContext = {
      requestId,
      traceId,
      input,
      timestamp: startedAt,
      locale: options?.locale ?? "es-MX",
    };

    return {
      context: pipelineContext,
      stage: "complete",
      routing,
      auditEvents,
      memoryRecords,
      availableSkills,
      systemPrompt,
      startedAt,
      completedAt: nowIso(),
      stageTimings,
    };
  }

  reset(): void {
    this.setStage("idle");
  }
}

export const pipeline = new IsabellaPipeline();
