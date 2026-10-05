import { describe, expect, it } from "vitest";

import {
  chooseTemperature,
  chooseTopK,
  createMoERoute,
  executeMoE,
  executeTriangulatedMoE,
  listModels,
  recordIntelligenceMetric,
  type InferenceCandidate,
  type MoeExpertArtifact,
  type MoERoute,
  type TriHeptaExecutor,
  type TriHeptaOptions,
  type TriHeptaPolicyDecision,
  type TriHeptaRequest,
  type VerificationCandidate,
} from "@/lib/intelligence/tri-hepta";

const INPUT = [1, -2, 3];

const ANSWER = "La política de memoria permite conservar el ámbito de proyecto por 12 meses.";

function artifact(id: string, overrides: Partial<MoeExpertArtifact> = {}): MoeExpertArtifact {
  return {
    expertId: id,
    version: "1.0.0",
    modelHash: `hash-${id}`,
    datasetId: "tri-hepta-fixture",
    datasetVersion: "1",
    license: "MIT",
    capacity: 8,
    sideEffect: "NONE",
    execute: (input: number[]) => [...input],
    ...overrides,
  };
}

function expertIds(count: number): MoeExpertArtifact[] {
  return Array.from({ length: count }, (_, index) => artifact(`exp-${index}`));
}

function triHeptaRequest(overrides: Partial<TriHeptaRequest> = {}): TriHeptaRequest {
  return {
    requestId: "req_tri_1",
    traceId: "trace_tri_1",
    tenantId: "tenant_1",
    principalId: "principal_1",
    text: "Analiza la política de memoria vigente.",
    modality: "text",
    purpose: "analysis",
    sensitivity: "internal",
    risk: "R1",
    maxLatencyMs: 5000,
    maxCostCents: 3,
    requireCitations: false,
    requireLocalProcessing: false,
    ...overrides,
  };
}

function policyDecision(overrides: Partial<TriHeptaPolicyDecision> = {}): TriHeptaPolicyDecision {
  return {
    decisionId: "dec_tri_1",
    allowed: true,
    reasonCode: "OK",
    policyVersion: "v1",
    executionMode: "LOCAL_ONLY",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    obligations: [],
    ...overrides,
  };
}

function inferenceCandidate(
  pipeline: "ALPHA" | "BETA",
  overrides: Partial<InferenceCandidate> = {},
): InferenceCandidate {
  return {
    pipeline,
    expertId: pipeline === "ALPHA" ? "exp-alpha" : "exp-beta",
    answer: ANSWER,
    confidence: 0.9,
    grounding: 0.9,
    risk: "R1",
    evidenceLevel: "E3",
    citations: ["doc://politica-de-memoria"],
    latencyMs: 12,
    outputHash: `hash-${pipeline.toLowerCase()}`,
    ...overrides,
  };
}

function verificationCandidate(
  overrides: Partial<VerificationCandidate> = {},
): VerificationCandidate {
  return {
    pipeline: "GAMMA",
    verifierId: "verifier-1",
    verdict: "ALLOW",
    semanticAgreement: 1,
    evidenceAgreement: 1,
    policyAgreement: 1,
    riskAgreement: 1,
    confidence: 0.92,
    latencyMs: 8,
    reasons: ["consistencia-cubierta"],
    ...overrides,
  };
}

interface ExecutorControls {
  alpha?: InferenceCandidate | null;
  beta?: InferenceCandidate | null;
  gamma?: VerificationCandidate | null;
  numeric?: (expert: MoeExpertArtifact, input: readonly number[]) => number[];
}

interface ExecutorLog {
  alpha: number;
  beta: number;
  gamma: number;
  numeric: string[];
}

function createFakeExecutor(controls: ExecutorControls = {}): {
  executor: TriHeptaExecutor;
  log: ExecutorLog;
} {
  const log: ExecutorLog = { alpha: 0, beta: 0, gamma: 0, numeric: [] };
  const executor: TriHeptaExecutor = {
    async executeNumericExpert(expert, input) {
      log.numeric.push(expert.expertId);
      return controls.numeric ? controls.numeric(expert, input) : [...input];
    },
    async executeAlpha() {
      log.alpha += 1;
      return controls.alpha ?? null;
    },
    async executeBeta() {
      log.beta += 1;
      return controls.beta ?? null;
    },
    async executeGamma() {
      log.gamma += 1;
      return controls.gamma ?? null;
    },
  };
  return { executor, log };
}

function agreeingControls(overrides: ExecutorControls = {}): ExecutorControls {
  return {
    alpha: inferenceCandidate("ALPHA"),
    beta: inferenceCandidate("BETA"),
    gamma: verificationCandidate(),
    ...overrides,
  };
}

async function runTriangulated(
  route: MoERoute,
  logits: readonly number[],
  executor: TriHeptaExecutor,
  request: TriHeptaRequest = triHeptaRequest(),
  policy: TriHeptaPolicyDecision = policyDecision(),
  options: TriHeptaOptions = {},
) {
  return executeTriangulatedMoE(route, INPUT, logits, request, policy, executor, options);
}

function referenceSoftmax(logits: readonly number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

describe("tri-hepta policy gate", () => {
  it("denies execution with tri_moe_policy_denied:<reasonCode> before touching any expert", async () => {
    const route = createMoERoute(expertIds(2), { topK: 2 });
    const { executor, log } = createFakeExecutor(agreeingControls());

    await expect(
      runTriangulated(
        route,
        [1, 1],
        executor,
        triHeptaRequest(),
        policyDecision({ allowed: false, reasonCode: "tenant_isolation" }),
      ),
    ).rejects.toThrow("tri_moe_policy_denied:tenant_isolation");

    expect(log).toEqual({ alpha: 0, beta: 0, gamma: 0, numeric: [] });
  });

  it("rejects an expired policy decision with tri_moe_policy_expired", async () => {
    const route = createMoERoute(expertIds(2), { topK: 2 });
    const { executor, log } = createFakeExecutor(agreeingControls());

    await expect(
      runTriangulated(
        route,
        [1, 1],
        executor,
        triHeptaRequest(),
        policyDecision({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
      ),
    ).rejects.toThrow("tri_moe_policy_expired");

    expect(log).toEqual({ alpha: 0, beta: 0, gamma: 0, numeric: [] });
  });
});

describe("tri-hepta temperature and top-k mapping", () => {
  it("maps WARM → topK 2 and keeps COLD at topK 3", async () => {
    const route = createMoERoute(expertIds(5), { topK: 5 });
    const { executor } = createFakeExecutor(agreeingControls());

    const warm = await runTriangulated(
      route,
      [1, 1, 1, 1, 1],
      executor,
      triHeptaRequest({ risk: "R1", sensitivity: "internal" }),
    );
    expect(warm.temperature).toBe("WARM");
    expect(warm.route.topK).toBe(2);
    expect(warm.trace.selected).toHaveLength(2);

    const cold = await runTriangulated(
      route,
      [1, 1, 1, 1, 1],
      executor,
      triHeptaRequest({ risk: "R2", sensitivity: "confidential", requireCitations: false }),
    );
    expect(cold.temperature).toBe("COLD");
    expect(cold.route.topK).toBe(3);
    expect(cold.trace.selected).toHaveLength(3);
  });

  it("raises topK to 5 for R3 and stops at maxTopK", async () => {
    const route = createMoERoute(expertIds(6), { topK: 6 });
    const { executor } = createFakeExecutor(agreeingControls());

    const high = await runTriangulated(
      route,
      [1, 1, 1, 1, 1, 1],
      executor,
      triHeptaRequest({ risk: "R3", sensitivity: "restricted", requireCitations: false }),
    );
    expect(high.temperature).toBe("COLD");
    expect(high.route.topK).toBe(5);
    expect(high.trace.selected).toHaveLength(5);

    const clamped = await runTriangulated(
      route,
      [1, 1, 1, 1, 1, 1],
      executor,
      triHeptaRequest({ risk: "R3", sensitivity: "restricted", requireCitations: false }),
      policyDecision(),
      { maxTopK: 4 },
    );
    expect(clamped.route.topK).toBe(4);
  });

  it("keeps HOT unreachable inside the engine until the semantic cache exists", async () => {
    const route = createMoERoute(expertIds(5), { topK: 5 });
    const { executor, log } = createFakeExecutor(agreeingControls());
    const hotShaped = triHeptaRequest({
      risk: "R0",
      sensitivity: "public",
      requireCitations: false,
      requireLocalProcessing: false,
    });

    const result = await runTriangulated(route, [1, 1, 1, 1, 1], executor, hotShaped);

    // cacheHit is hardcoded false, so an otherwise HOT-shaped request runs COLD.
    expect(result.temperature).toBe("COLD");
    expect(result.route.topK).toBe(3);
    expect(log.beta).toBe(1);
    expect(log.gamma).toBe(1);
  });

  it("maps temperature and top-k exactly: HOT→1, WARM→2, high risk up to 5", () => {
    const hotShape = {
      risk: "R0",
      sensitivity: "public",
      requireCitations: false,
      requireLocalProcessing: false,
    } as const;

    expect(chooseTemperature(hotShape, true)).toBe("HOT");
    expect(chooseTemperature(hotShape, false)).toBe("COLD");
    expect(chooseTemperature({ ...hotShape, requireCitations: true }, true)).toBe("WARM");
    expect(chooseTemperature({ ...hotShape, risk: "R1" }, false)).toBe("WARM");
    expect(chooseTemperature({ ...hotShape, sensitivity: "confidential" }, false)).toBe("COLD");

    expect(chooseTopK("HOT", "R0", 5)).toBe(1);
    expect(chooseTopK("WARM", "R1", 5)).toBe(2);
    expect(chooseTopK("COLD", "R0", 5)).toBe(3);
    expect(chooseTopK("HOT", "R2", 5)).toBe(3);
    expect(chooseTopK("HOT", "R3", 5)).toBe(5);
    expect(chooseTopK("HOT", "R3", 4)).toBe(4);
  });
});

describe("tri-hepta softmax routing", () => {
  it("ranks artificial experts by softmax weight and keeps ranks 0..topK-1", () => {
    const route = createMoERoute(expertIds(4), { topK: 2 });
    const logits = [4, 1, 0, -2];
    const expected = referenceSoftmax(logits);

    const decisions = route.route(INPUT, logits);

    expect(decisions).toHaveLength(2);
    expect(decisions.map((decision) => decision.expertId)).toEqual(["exp-0", "exp-1"]);
    expect(decisions[0]!.weight).toBeCloseTo(expected[0]!, 10);
    expect(decisions[1]!.weight).toBeCloseTo(expected[1]!, 10);
    expect(decisions[0]!.logit).toBe(4);
    expect(decisions[0]!.rank).toBe(0);
    expect(decisions[1]!.rank).toBe(1);
    expect(decisions[0]!.weight).toBeGreaterThan(decisions[1]!.weight);
  });

  it("breaks softmax ties deterministically by expertId and rejects logit mismatches", () => {
    const route = createMoERoute(expertIds(3), { topK: 3 });
    const tied = route.route(INPUT, [1, 1, 1]);
    expect(tied.map((decision) => decision.expertId)).toEqual(["exp-0", "exp-1", "exp-2"]);
    expect(tied[0]!.weight).toBeCloseTo(tied[1]!.weight, 12);

    expect(() => route.route(INPUT, [1, 1])).toThrow("moe_logit_count_mismatch");
  });

  it("publishes the same softmax weights on the execution trace", async () => {
    const route = createMoERoute(expertIds(4), { topK: 4 });
    const { executor } = createFakeExecutor(agreeingControls());
    const logits = [4, 1, 0, -2];
    const expected = referenceSoftmax(logits);

    const result = await runTriangulated(
      route,
      logits,
      executor,
      triHeptaRequest({ risk: "R2", sensitivity: "confidential", requireCitations: false }),
    );

    expect(result.trace.selected).toHaveLength(3);
    expect(result.trace.selected[0]!.expertId).toBe("exp-0");
    expect(result.trace.selected[0]!.weight).toBeCloseTo(expected[0]!, 10);
    expect(result.trace.contributions).toHaveLength(3);
    for (const contribution of result.trace.contributions) {
      expect(contribution.outputHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("tri-hepta side-effect guards", () => {
  it("never runs a FINANCIAL expert inside the numeric loop", async () => {
    let financialArtifactExecutions = 0;
    const experts = [
      artifact("exp-safe"),
      artifact("exp-financial", {
        sideEffect: "FINANCIAL",
        execute: (input: number[]) => {
          financialArtifactExecutions += 1;
          return [...input];
        },
      }),
      artifact("exp-read", { sideEffect: "READ" }),
    ];
    const route = createMoERoute(experts, { topK: 3 });
    const { executor, log } = createFakeExecutor(agreeingControls());

    const result = await runTriangulated(route, [1, 5, 1.1], executor);

    expect(result.triangulation.verdict).toBe("ALLOW");
    expect(log.numeric).not.toContain("exp-financial");
    expect(log.numeric).toContain("exp-read");
    expect(financialArtifactExecutions).toBe(0);
    expect(result.trace.contributions.map((item) => item.expertId)).toEqual(["exp-read"]);
    expect(result.trace.overflow).toBe(false);
    expect(result.executedExpertCount).toBe(4);
  });

  it("skips WRITE and TRAINING experts while still answering from the safe mix", async () => {
    const experts = [
      artifact("exp-write", { sideEffect: "WRITE" }),
      artifact("exp-train", { sideEffect: "TRAINING" }),
      artifact("exp-safe"),
    ];
    const route = createMoERoute(experts, { topK: 3 });
    const { executor, log } = createFakeExecutor(agreeingControls());

    const result = await runTriangulated(
      route,
      [4, 3, 1],
      executor,
      triHeptaRequest({ risk: "R3", sensitivity: "restricted", requireCitations: false }),
    );

    expect(log.numeric).toEqual(["exp-safe"]);
    expect(result.trace.contributions.map((item) => item.expertId)).toEqual(["exp-safe"]);
    expect(result.selectedAnswer).toBe(ANSWER);
  });
});

describe("tri-hepta consensus and verdict", () => {
  it("lets a gamma DENY veto a STRONG consensus and clears the selected answer", async () => {
    const route = createMoERoute(expertIds(3), { topK: 3 });
    const { executor, log } = createFakeExecutor(
      agreeingControls({ gamma: verificationCandidate({ verdict: "DENY" }) }),
    );

    const result = await runTriangulated(route, [1, 1, 1], executor);

    expect(result.triangulation.consensus).toBe("STRONG");
    expect(result.triangulation.consensusScore).toBeCloseTo(1, 10);
    expect(result.triangulation.verdict).toBe("DENY");
    expect(result.selectedAnswer).toBeNull();
    expect(result.selectedExpertId).toBeNull();
    expect(result.trace.contributions).toHaveLength(0);
    expect(result.executedExpertCount).toBe(3);
    expect(log.numeric).toHaveLength(0);
    expect(result.trace.overflow).toBe(false);
  });

  it("selects the alpha answer when consensus is STRONG and gamma allows", async () => {
    const route = createMoERoute(expertIds(3), { topK: 3 });
    const { executor } = createFakeExecutor(agreeingControls());

    const result = await runTriangulated(route, [1, 1, 1], executor);

    expect(result.triangulation.consensus).toBe("STRONG");
    expect(result.triangulation.verdict).toBe("ALLOW");
    expect(result.selectedAnswer).toBe(ANSWER);
    expect(result.selectedExpertId).toBe("exp-alpha");
    expect(result.trace.contributions.length).toBeGreaterThan(0);
  });

  it("falls back to REVIEW without fabricating an answer when gamma is missing", async () => {
    const route = createMoERoute(expertIds(2), { topK: 2 });
    const { executor, log } = createFakeExecutor(agreeingControls({ gamma: null }));

    const result = await runTriangulated(route, [1, 1], executor);

    expect(log.gamma).toBe(1);
    expect(result.triangulation.gamma).toBeNull();
    expect(result.triangulation.verdict).toBe("REVIEW");
    expect(result.selectedAnswer).toBeNull();
    expect(result.triangulation.consensusScore).toBeLessThan(0.85);
  });
});

describe("tri-hepta numeric output validation", () => {
  it("fails closed when the only expert returns NaN", async () => {
    const route = createMoERoute([artifact("exp-nan")], { topK: 1 });
    const { executor, log } = createFakeExecutor(
      agreeingControls({ numeric: () => [Number.NaN, Number.NaN, Number.NaN] }),
    );

    await expect(runTriangulated(route, [1], executor)).rejects.toThrow(
      "tri_moe_no_numeric_expert_succeeded",
    );
    expect(log.numeric).toEqual(["exp-nan"]);
  });

  it("fails closed when an expert returns a vector of the wrong length", async () => {
    const route = createMoERoute([artifact("exp-short")], { topK: 1 });
    const { executor } = createFakeExecutor(agreeingControls({ numeric: () => [1, 2] }));

    await expect(runTriangulated(route, [1], executor)).rejects.toThrow(
      "tri_moe_no_numeric_expert_succeeded",
    );
  });

  it("degrades instead of aborting when a single expert is invalid, and flags overflow", async () => {
    const experts = [artifact("exp-bad"), artifact("exp-good")];
    const route = createMoERoute(experts, { topK: 2 });
    const { executor, log } = createFakeExecutor(
      agreeingControls({
        numeric: (expert) =>
          expert.expertId === "exp-bad" ? [Number.NaN, Number.NaN, Number.NaN] : [...INPUT],
      }),
    );

    const result = await runTriangulated(route, [5, 1], executor);

    expect(log.numeric).toEqual(["exp-bad", "exp-good"]);
    expect(result.trace.overflow).toBe(true);
    expect(result.trace.contributions.map((item) => item.expertId)).toEqual(["exp-good"]);
    expect(result.trace.contributions[0]!.outputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("tri-hepta determinism", () => {
  it("produces an identical result for identical input, logits and policy", async () => {
    const experts = expertIds(4);
    const logits = [2.5, 0.4, -1, 3];
    const request = triHeptaRequest({ risk: "R1", sensitivity: "internal" });

    const first = await runTriangulated(
      createMoERoute(experts, { topK: 4 }),
      logits,
      createFakeExecutor(agreeingControls()).executor,
      request,
    );
    const second = await runTriangulated(
      createMoERoute(experts, { topK: 4 }),
      logits,
      createFakeExecutor(agreeingControls()).executor,
      request,
    );

    // The route carries a `route()` closure, so compare its data instead of identity.
    const { route: firstRoute, ...firstRest } = first;
    const { route: secondRoute, ...secondRest } = second;
    expect(secondRest).toEqual(firstRest);
    expect({
      topK: secondRoute.topK,
      capacityFactor: secondRoute.capacityFactor,
      expertIds: secondRoute.experts.map((expert) => expert.expertId),
      registryIds: [...secondRoute.registry.keys()],
    }).toEqual({
      topK: firstRoute.topK,
      capacityFactor: firstRoute.capacityFactor,
      expertIds: firstRoute.experts.map((expert) => expert.expertId),
      registryIds: [...firstRoute.registry.keys()],
    });

    expect(second.trace.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.trace.inputHash).toBe(first.trace.inputHash);
  });
});

describe("tri-hepta legacy utilities", () => {
  it("keeps createMoERoute/executeMoE/listModels/recordIntelligenceMetric working", async () => {
    const route = createMoERoute(expertIds(3), { topK: 3 });

    const models = listModels(route);
    expect(models.map((model) => model.expertId)).toEqual(["exp-0", "exp-1", "exp-2"]);
    models.pop();
    expect(listModels(route)).toHaveLength(3);

    const legacy = await executeMoE(route, INPUT, [2, 1, 0]);
    expect(legacy.output).toHaveLength(INPUT.length);
    for (const value of legacy.output) expect(Number.isFinite(value)).toBe(true);
    expect(legacy.trace.selected).toHaveLength(3);
    expect(legacy.trace.fallbackUsed).toBe(false);

    const metric = recordIntelligenceMetric(legacy.trace);
    expect(metric.inputHash).toBe(legacy.trace.inputHash);
    expect(metric.selectedExperts).toEqual(legacy.trace.selected.map((item) => item.expertId));
    expect(metric.utilization).toBeCloseTo(1, 10);
    expect(metric.overflow).toBe(false);
    expect(metric.fallbackUsed).toBe(false);
  });
});
