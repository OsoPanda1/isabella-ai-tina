import { describe, expect, it } from "vitest";

import type {
  GovernanceDecision,
  IntelligenceProvider,
  IntelligenceRequest,
  Modality,
} from "@/lib/intelligence/contracts";
import {
  aggregateExpertAnswers,
  createExpertRegistry,
  createMoETelemetryEvent,
  createMoERoute as createMoERouteCanonical,
  evaluateMoERouting,
  executeMoE as executeMoECanonical,
  type EvidenceCitation,
  type ExpertDescriptor,
  type MoEProviderDescriptor,
  type RoutingRequest,
} from "@/lib/intelligence/moe";
import {
  createMoERoute as createMoERouteEngine,
  executeMoE as executeMoEEngine,
} from "@/lib/intelligence/moe-engine";
import {
  createMoERoute as createMoERouteTriHepta,
  executeMoE as executeMoETriHepta,
} from "@/lib/intelligence/tri-hepta";

function expertDescriptor(overrides: Partial<ExpertDescriptor> = {}): ExpertDescriptor {
  return {
    expertId: "exp-alpha",
    providerId: "prov-1",
    modelId: "model-1",
    version: "1.0.0",
    capabilities: ["text"],
    temperature: "COLD",
    enabled: true,
    productionApproved: true,
    riskCeiling: "HIGH",
    priority: 10,
    ...overrides,
  };
}

function citation(overrides: Partial<EvidenceCitation> = {}): EvidenceCitation {
  return {
    citationId: "cit-1",
    sourceHash: "hash-1",
    level: "E1",
    knowledgeVersion: "kv-1",
    scope: "tenant",
    ...overrides,
  };
}

function routingRequest(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    requestId: "req_routing_1",
    tenantId: "tenant_1",
    actorId: "actor_1",
    modality: "text",
    risk: "LOW",
    ...overrides,
  };
}

const ALLOW: GovernanceDecision = {
  decision: "ALLOW",
  riskScore: 0,
  policyIds: [],
  reasons: [],
};

function telemetryInput(overrides: Partial<Parameters<typeof createMoETelemetryEvent>[0]> = {}) {
  return {
    requestId: "req_moe_1",
    auditId: "moe-audit-1",
    selectedExperts: ["exp-alpha", "exp-beta"],
    latencyMs: 12,
    degraded: false,
    disagreement: false,
    ...overrides,
  };
}

describe("moe expert registry", () => {
  it("throws moe_expert_id_invalid for an expertId that fails the id contract", () => {
    const registry = createExpertRegistry();

    expect(() => registry.register(expertDescriptor({ expertId: "" }))).toThrow(
      "moe_expert_id_invalid",
    );
    expect(() => registry.register(expertDescriptor({ expertId: "x" }))).toThrow(
      "moe_expert_id_invalid",
    );
    expect(() => registry.register(expertDescriptor({ expertId: "id with spaces" }))).toThrow(
      "moe_expert_id_invalid",
    );
    expect(() => registry.register(expertDescriptor({ expertId: "id\nbreak" }))).toThrow(
      "moe_expert_id_invalid",
    );

    expect(registry.list()).toHaveLength(0);
  });

  it("throws moe_expert_identity_required when modelId, providerId or version is missing", () => {
    const registry = createExpertRegistry();

    expect(() => registry.register(expertDescriptor({ modelId: "" }))).toThrow(
      "moe_expert_identity_required",
    );
    expect(() => registry.register(expertDescriptor({ providerId: "" }))).toThrow(
      "moe_expert_identity_required",
    );
    expect(() => registry.register(expertDescriptor({ version: "" }))).toThrow(
      "moe_expert_identity_required",
    );
  });

  it("hands out independent copies so callers cannot mutate the registry from outside", () => {
    const registry = createExpertRegistry([expertDescriptor({ expertId: "exp-1" })]);

    const first = registry.get("exp-1");
    const second = registry.get("exp-1");
    expect(first).toEqual(second);
    expect(first).toBeDefined();
    expect(first).not.toBe(second);
    expect(first?.capabilities).not.toBe(second?.capabilities);

    const snapshot = registry.list();
    registry.register(expertDescriptor({ expertId: "exp-2" }));
    expect(snapshot).toHaveLength(1);
    expect(registry.list()).toHaveLength(2);
    expect(registry.get("exp-2")).toBeDefined();
  });
});

describe("moe aggregation", () => {
  it("penalises disagreement by exactly 0.15 on the averaged confidence", () => {
    const disagreed = aggregateExpertAnswers([
      { expertId: "exp-a", text: "El ámbito de proyecto dura 12 meses.", confidence: 0.9 },
      { expertId: "exp-b", text: "El ámbito de proyecto dura 24 meses.", confidence: 0.9 },
    ]);

    expect(disagreed.disagreement).toBe(true);
    expect(disagreed.text).toBe("El ámbito de proyecto dura 12 meses.");
    expect(disagreed.confidence).toBeCloseTo(0.75, 10);

    const agreed = aggregateExpertAnswers([
      { expertId: "exp-a", text: "Respuesta idéntica.", confidence: 0.8 },
      { expertId: "exp-b", text: "Respuesta idéntica.", confidence: 0.6 },
    ]);

    expect(agreed.disagreement).toBe(false);
    expect(agreed.confidence).toBeCloseTo(0.7, 10);
  });

  it("fails closed when there is nothing to aggregate", () => {
    expect(() => aggregateExpertAnswers([])).toThrow("moe_aggregation_requires_answers");
  });

  it("deduplicates evidence that repeats sourceHash + citationId + knowledgeVersion", () => {
    const shared = citation();
    const result = aggregateExpertAnswers([
      { expertId: "exp-a", text: "misma respuesta", confidence: 0.9, evidence: [shared] },
      {
        expertId: "exp-b",
        text: "misma respuesta",
        confidence: 0.8,
        evidence: [
          shared,
          citation({ citationId: "cit-2" }),
          citation({ knowledgeVersion: "kv-2" }),
        ],
      },
    ]);

    expect(result.evidence).toHaveLength(3);
    expect(
      new Set(result.evidence.map((item) => `${item.citationId}:${item.knowledgeVersion}`)).size,
    ).toBe(3);

    const duplicatedOnly = aggregateExpertAnswers([
      { expertId: "exp-a", text: "misma respuesta", confidence: 0.9, evidence: [shared] },
      { expertId: "exp-b", text: "misma respuesta", confidence: 0.8, evidence: [shared] },
    ]);

    expect(duplicatedOnly.evidence).toHaveLength(1);
    expect(duplicatedOnly.evidence[0]).toEqual(shared);
  });
});

describe("moe routing policy gate", () => {
  it("denies when tenant, actor or requestId identity is missing", () => {
    expect(evaluateMoERouting(routingRequest({ tenantId: "" }), ALLOW)).toMatchObject({
      decision: "DENY",
      riskScore: 100,
      policyIds: ["moe-identity-v1"],
      reasons: ["identity-required"],
    });
    expect(evaluateMoERouting(routingRequest({ actorId: "" }), ALLOW).decision).toBe("DENY");
    expect(evaluateMoERouting(routingRequest({ requestId: "" }), ALLOW).decision).toBe("DENY");
  });

  it("escalates CRITICAL risk to REVIEW instead of allowing it through", () => {
    const decision = evaluateMoERouting(routingRequest({ risk: "CRITICAL" }), ALLOW);

    expect(decision.decision).toBe("REVIEW");
    expect(decision.riskScore).toBe(95);
    expect(decision.reasons).toEqual(["critical-risk-requires-human-review"]);
  });

  it("keeps a non-ALLOW governance decision untouched and allows the rest", () => {
    const denied: GovernanceDecision = {
      decision: "DENY",
      riskScore: 70,
      policyIds: ["crown"],
      reasons: ["blocked-by-crown"],
    };

    expect(evaluateMoERouting(routingRequest(), denied)).toBe(denied);

    const allowed = evaluateMoERouting(routingRequest({ risk: "HIGH" }), ALLOW);
    expect(allowed.decision).toBe("ALLOW");
    expect(allowed.riskScore).toBe(70);
    expect(allowed.policyIds).toEqual(["crown-moe-routing-v1"]);
  });
});

describe("moe telemetry", () => {
  it("throws moe_latency_invalid for negative, NaN or infinite latency", () => {
    expect(() => createMoETelemetryEvent(telemetryInput({ latencyMs: -1 }))).toThrow(
      "moe_latency_invalid",
    );
    expect(() => createMoETelemetryEvent(telemetryInput({ latencyMs: Number.NaN }))).toThrow(
      "moe_latency_invalid",
    );
    expect(() =>
      createMoETelemetryEvent(telemetryInput({ latencyMs: Number.POSITIVE_INFINITY })),
    ).toThrow("moe_latency_invalid");
  });

  it("copies selectedExperts so later mutation cannot rewrite a recorded event", () => {
    const selectedExperts = ["exp-alpha"];
    const event = createMoETelemetryEvent(telemetryInput({ selectedExperts }));

    selectedExperts.push("exp-injected");

    expect(event.selectedExperts).toEqual(["exp-alpha"]);
    expect(event.latencyMs).toBe(12);
  });
});

describe("unified MoE entry points", () => {
  it("exposes one and the same createMoERoute/executeMoE from every legacy surface", () => {
    expect(createMoERouteCanonical).toBe(createMoERouteEngine);
    expect(createMoERouteCanonical).toBe(createMoERouteTriHepta);
    expect(executeMoECanonical).toBe(executeMoEEngine);
    expect(executeMoECanonical).toBe(executeMoETriHepta);
  });

  it("runs the numerically routed variant through the unified function", async () => {
    const experts = ["exp-0", "exp-1"].map((expertId) => ({
      expertId,
      version: "1.0.0",
      modelHash: `hash-${expertId}`,
      datasetId: "moe-unified-fixture",
      datasetVersion: "1",
      license: "MIT",
      capacity: 4,
      execute: (input: number[]) => [...input],
    }));

    const route = createMoERouteCanonical(experts, { topK: 2 });
    expect(route.topK).toBe(2);
    expect(route.experts).toHaveLength(2);

    const result = await executeMoECanonical(route, [1, -2, 3], [2, 1]);
    expect(result.output).toHaveLength(3);
    for (const value of result.output) expect(Number.isFinite(value)).toBe(true);
    expect(result.trace.selected).toHaveLength(2);
  });

  it("runs the provider routed variant through the same unified function", async () => {
    const response = (modelId: string) => async (request: IntelligenceRequest) => ({
      requestId: request.requestId,
      modelId,
      providerId: "prov-unified",
      text: `respuesta de ${modelId}`,
      latencyMs: 5,
      degraded: false,
      risk: "LOW" as const,
    });

    const provider = (modelId: string): IntelligenceProvider => ({
      providerId: "prov-unified",
      modelId,
      capabilities: new Set<Modality>(["text"]),
      health: async () => true,
      invoke: response(modelId),
    });

    const providers = new Map<string, IntelligenceProvider>([
      ["model-a", provider("model-a")],
      ["model-b", provider("model-b")],
    ]);
    const descriptors = new Map<string, MoEProviderDescriptor>([
      ["model-a", { modalities: ["text"], enabled: true, productionApproved: true }],
      ["model-b", { modalities: ["text"], enabled: true, productionApproved: false }],
    ]);
    const request: IntelligenceRequest = {
      requestId: "req_unified_1",
      tenantId: "tenant_1",
      actorId: "actor_1",
      messages: [{ role: "user", content: "Analiza la política de memoria." }],
    };

    const route = createMoERouteCanonical(request, providers, descriptors, 3);
    expect(route.strategy).toBe("capability-weighted-top-k");
    expect(route.selected.map((expert) => expert.modelId)).toEqual(["model-a", "model-b"]);
    expect(route.selected[0]?.productionApproved).toBe(true);

    const run = await executeMoECanonical(request, route, providers);
    expect(run.executedExpertCount).toBe(2);
    expect(run.selected.modelId).toBe("model-a");
    expect(run.route).toEqual(route);
  });
});
