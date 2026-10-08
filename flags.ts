import { FEATURE_FLAGS, type FeatureFlagKey } from "./src/config/feature-flags/catalog";
import "./src/lib/flags/safe-defaults";

export interface UserIdentification {
  userID: string;
  custom?: Record<string, string | number | boolean | undefined>;
}

export function createFeatureGate(key: FeatureFlagKey) {
  return async (): Promise<boolean> => {
    // Evaluation defaults safely based on governed environment policy
    const env = process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
    const def = FEATURE_FLAGS[key];
    if (!def) return false;
    if (!def.allowedEnvironments.includes(env)) return false;
    return env === "production" ? def.productionValue : def.defaultValue;
  };
}

export const isabellaFlags = {
  federationsRouting: createFeatureGate("tamv_7_federations_routing"),
  aiModelFallback: createFeatureGate("isabella_ai_model_fallback"),
  conversationalCanvasV2: createFeatureGate("isabella_conversational_canvas_v2"),
  strictRateLimiting: createFeatureGate("isabella_strict_rate_limiting"),
  graphMemory: createFeatureGate("isabella_graph_memory"),
  quantumRoute: createFeatureGate("isabella_quantum_route"),
};
