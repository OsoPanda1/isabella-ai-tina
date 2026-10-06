import type { ExpertDescriptor } from "./contracts";

/** Versioned, immutable expert registry. Registration never grants production authority. */
export class ExpertRegistry {
  private readonly experts = new Map<string, ExpertDescriptor>();

  register(expert: ExpertDescriptor): void {
    if (!/^[a-zA-Z0-9._:/-]{2,160}$/.test(expert.expertId)) {
      throw new Error("moe_expert_id_invalid");
    }
    if (!expert.modelId || !expert.providerId || !expert.version) {
      throw new Error("moe_expert_identity_required");
    }
    this.experts.set(
      expert.expertId,
      Object.freeze({
        ...expert,
        capabilities: Object.freeze([...expert.capabilities]),
      }),
    );
  }

  get(expertId: string): ExpertDescriptor | undefined {
    const expert = this.experts.get(expertId);
    return expert ? { ...expert, capabilities: [...expert.capabilities] } : undefined;
  }

  list(): readonly ExpertDescriptor[] {
    return [...this.experts.values()].map((expert) => ({
      ...expert,
      capabilities: [...expert.capabilities],
    }));
  }
}

export function createExpertRegistry(experts: readonly ExpertDescriptor[] = []): ExpertRegistry {
  const registry = new ExpertRegistry();
  for (const expert of experts) registry.register(expert);
  return registry;
}
