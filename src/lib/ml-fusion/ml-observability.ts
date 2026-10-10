/**
 * ML OBSERVABILITY — Metrics and Telemetry for Fusion Engine
 * ═════════════════════════════════════════════════════════════════════
 */

import type { CopilotMLSignal, NCUASignal } from "./copilot-ml-engine";

export interface MLMetrics {
  totalRequests: number;
  copilotAverageConfidence: number;
  ncuaAverageConfidence: number;
  fusionAverageConfidence: number;
  decisionDistribution: Record<"allow" | "requires_approval" | "deny", number>;
  categoryDistribution: Record<string, number>;
  lastUpdated: Date;
}

export class MLObservabilityEngine {
  private metrics: MLMetrics = {
    totalRequests: 0,
    copilotAverageConfidence: 0,
    ncuaAverageConfidence: 0,
    fusionAverageConfidence: 0,
    decisionDistribution: { allow: 0, requires_approval: 0, deny: 0 },
    categoryDistribution: {},
    lastUpdated: new Date(),
  };

  recordDecision(
    copilotSignal: CopilotMLSignal,
    ncuaSignal: NCUASignal,
    fusedConfidence: number,
    decision: "allow" | "requires_approval" | "deny",
    category: string,
  ): void {
    const n = this.metrics.totalRequests;

    // Update rolling averages
    this.metrics.copilotAverageConfidence =
      (this.metrics.copilotAverageConfidence * n + copilotSignal.confidence) / (n + 1);
    this.metrics.ncuaAverageConfidence =
      (this.metrics.ncuaAverageConfidence * n + ncuaSignal.confidence) / (n + 1);
    this.metrics.fusionAverageConfidence =
      (this.metrics.fusionAverageConfidence * n + fusedConfidence) / (n + 1);

    // Track distribution
    this.metrics.decisionDistribution[decision]++;
    this.metrics.categoryDistribution[category] =
      (this.metrics.categoryDistribution[category] || 0) + 1;
    this.metrics.totalRequests++;
    this.metrics.lastUpdated = new Date();
  }

  getMetrics(): MLMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      totalRequests: 0,
      copilotAverageConfidence: 0,
      ncuaAverageConfidence: 0,
      fusionAverageConfidence: 0,
      decisionDistribution: { allow: 0, requires_approval: 0, deny: 0 },
      categoryDistribution: {},
      lastUpdated: new Date(),
    };
  }
}

export const mlObservability = new MLObservabilityEngine();
