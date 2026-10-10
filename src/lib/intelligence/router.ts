import { randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import { isProductionLike, resolveRuntimeMode } from "@/lib/runtime-mode";
import type {
  GovernanceDecision,
  IntelligenceProvider,
  IntelligenceRequest,
  IntelligenceResponse,
} from "./contracts";
import { approveModel, listModels, registerProvider } from "./model-registry";
import { createMoERoute, executeMoE } from "./moe-engine";
import { recordIntelligenceMetric } from "./observability";
import { authorizeModelForRuntime, assertModelRuntimeAuthority } from "./production-model-gate";
import { inspectInferenceInput } from "./inference-firewall";

const providers = new Map<string, IntelligenceProvider>();
const failures = new Map<string, { count: number; openUntil: number }>();
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;

function circuitOpen(modelId: string): boolean {
  const state = failures.get(modelId);
  if (!state) return false;
  if (state.openUntil > Date.now()) return true;
  // Cooldown elapsed: half-open. Reset the streak so a single new failure does
  // not immediately re-open the circuit, and drop the stale entry.
  failures.delete(modelId);
  return false;
}

function recordFailure(modelId: string): void {
  const current = failures.get(modelId) ?? { count: 0, openUntil: 0 };
  const count = current.count + 1;
  failures.set(modelId, {
    count,
    openUntil: count >= FAILURE_THRESHOLD ? Date.now() + COOLDOWN_MS : 0,
  });
}

function recordSuccess(modelId: string): void {
  failures.delete(modelId);
}

export function addProvider(provider: IntelligenceProvider, productionApproved = false): void {
  providers.set(provider.modelId, provider);
  registerProvider(provider);
  if (productionApproved) approveModel(provider.modelId);
}

function evaluateGovernance(request: IntelligenceRequest): GovernanceDecision {
  if (!request.tenantId || !request.actorId)
    return {
      decision: "DENY",
      reasons: ["tenant-and-actor-required"],
      riskScore: 100,
      policyIds: [],
    };
  if (request.messages.length === 0 || request.messages.length > 40)
    return {
      decision: "DENY",
      reasons: ["invalid-message-count"],
      riskScore: 80,
      policyIds: [],
    };
  const temperature = request.temperature ?? 0.7;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
    return {
      decision: "DENY",
      reasons: ["temperature-out-of-range"],
      riskScore: 50,
      policyIds: [],
    };
  const maxTokens = request.maxTokens ?? 1024;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32_000)
    return {
      decision: "DENY",
      reasons: ["max-tokens-out-of-range"],
      riskScore: 60,
      policyIds: ["inference-firewall-v1"],
    };
  return {
    decision: "ALLOW",
    reasons: [],
    riskScore: 0,
    policyIds: ["inference-firewall-v1"],
  };
}

export async function assertIntelligenceRuntimeAuthority(params: {
  tenantId: string;
  modelId: string;
  providerId: string;
}): Promise<void> {
  const provider: IntelligenceProvider = {
    providerId: params.providerId,
    modelId: params.modelId,
    capabilities: new Set(["text"]),
    health: async () => false,
    invoke: async () => {
      throw new Error("runtime_authority_probe_not_executable");
    },
  };
  await assertModelRuntimeAuthority(params.tenantId, provider);
}

export function governIntelligence(request: IntelligenceRequest): GovernanceDecision {
  const base = evaluateGovernance(request);
  if (base.decision !== "ALLOW") return base;
  const firewall = inspectInferenceInput(request.messages);
  if (!firewall.allowed)
    return {
      decision: "DENY",
      reasons: firewall.reasons,
      riskScore: 95,
      policyIds: ["inference-firewall-v1"],
    };
  return base;
}

export async function invokeIntelligence(
  input: Omit<IntelligenceRequest, "requestId"> & { requestId?: string },
): Promise<IntelligenceResponse> {
  const firewall = inspectInferenceInput(input.messages);
  if (!firewall.allowed) throw new Error(`intelligence_DENY:${firewall.reasons.join(",")}`);
  const request: IntelligenceRequest = {
    ...input,
    messages: firewall.sanitized,
    requestId: input.requestId ?? randomUUID(),
  };
  const governance = evaluateGovernance(request);
  if (governance.decision !== "ALLOW")
    throw new Error(`intelligence_${governance.decision.toLowerCase()}`);

  const production = isProductionLike(resolveRuntimeMode(config().ISABELLA_RUNTIME_MODE));
  const descriptors = new Map(
    listModels().map(
      (model) =>
        [
          model.modelId,
          {
            modalities: model.modalities,
            enabled: model.enabled,
            productionApproved: model.productionApproved,
          },
        ] as const,
    ),
  );
  const route = createMoERoute(request, providers, descriptors, 3);
  const eligible = route.selected.filter((expert) => !production || expert.productionApproved);
  if (!eligible.length) throw new Error("inference_unavailable:no_production_approved_expert");

  const authorizedExperts = [];
  for (const expert of eligible) {
    if (circuitOpen(expert.modelId)) continue;
    const provider = providers.get(expert.modelId);
    if (!provider) continue;
    if (production) {
      try {
        await authorizeModelForRuntime(request.tenantId, provider);
      } catch {
        recordFailure(expert.modelId);
        continue;
      }
    }
    authorizedExperts.push(expert);
  }
  if (!authorizedExperts.length) throw new Error("inference_unavailable:no_authorized_expert");

  const started = performance.now();
  try {
    const result = await executeMoE(request, { ...route, selected: authorizedExperts }, providers);
    for (const response of result.responses) {
      recordSuccess(response.modelId);
      recordIntelligenceMetric({
        providerId: response.providerId,
        modelId: response.modelId,
        latencyMs: response.latencyMs,
        success: true,
        degraded: response.degraded,
        timestamp: new Date().toISOString(),
      });
    }
    return {
      ...result.selected,
      latencyMs: Math.max(result.selected.latencyMs, performance.now() - started),
    };
  } catch (error) {
    for (const expert of authorizedExperts) recordFailure(expert.modelId);
    throw error;
  }
}
