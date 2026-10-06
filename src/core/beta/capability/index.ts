/**
 * Beta — Capability Registry
 *
 * Selecciona la herramienta, modelo, edge target,
 * proveedor o ruta cuántica permitida.
 */

import type { ToolCapability } from "../../contracts";

export interface CapabilitySelection {
  capabilityId: string;
  toolId: string;
  reason: string;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
  reversible: boolean;
  requiredScopes: string[];
}

export class CapabilityRegistry {
  private capabilities: Map<string, ToolCapability> = new Map();

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register a tool capability.
   */
  register(capability: ToolCapability): void {
    this.capabilities.set(capability.capabilityId, capability);
  }

  /**
   * Select the best capability for a given task.
   */
  select(params: {
    intent: string;
    requestedCapabilities: string[];
    allowedScopes: string[];
    constraints?: {
      maxCostUsd?: number;
      maxLatencyMs?: number;
    };
  }): CapabilitySelection | null {
    const candidates = Array.from(this.capabilities.values()).filter((cap) => {
      // Check if capability is requested
      if (params.requestedCapabilities.length > 0) {
        if (!params.requestedCapabilities.includes(cap.capabilityId)) {
          return false;
        }
      }

      // Check scopes
      const hasScope = cap.requiredScopes.every(
        (scope) => params.allowedScopes.includes(scope) || params.allowedScopes.includes("*"),
      );
      if (!hasScope) return false;

      // Check constraints
      if (params.constraints?.maxCostUsd && cap.riskLevel === "critical") {
        return false; // Critical tools need explicit approval
      }

      return true;
    });

    if (candidates.length === 0) return null;

    // Select by risk level (lower is better)
    const sorted = candidates.sort((a, b) => {
      const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    });

    const selected = sorted[0];
    if (!selected) return null;

    return {
      capabilityId: selected.capabilityId,
      toolId: selected.capabilityId,
      reason: `Selected by risk level: ${selected.riskLevel}`,
      estimatedCostUsd: 0,
      estimatedLatencyMs: selected.timeoutMs,
      reversible: selected.reversible,
      requiredScopes: selected.requiredScopes,
    };
  }

  /**
   * List all available capabilities.
   */
  list(): ToolCapability[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Get a specific capability.
   */
  get(capabilityId: string): ToolCapability | undefined {
    return this.capabilities.get(capabilityId);
  }

  private registerDefaults(): void {
    this.register({
      capabilityId: "memory_search",
      version: "1.0.0",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      outputSchema: { type: "object", properties: { results: { type: "array" } } },
      requiredScopes: ["memory:read"],
      riskLevel: "low",
      networkAccess: "none",
      reversible: true,
      timeoutMs: 5000,
    });

    this.register({
      capabilityId: "web_search",
      version: "1.0.0",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      outputSchema: { type: "object", properties: { results: { type: "array" } } },
      requiredScopes: ["cognitive:read"],
      riskLevel: "low",
      networkAccess: "allowlist",
      reversible: true,
      timeoutMs: 10000,
    });

    this.register({
      capabilityId: "code_analysis",
      version: "1.0.0",
      inputSchema: { type: "object", properties: { code: { type: "string" } } },
      outputSchema: { type: "object", properties: { analysis: { type: "object" } } },
      requiredScopes: ["cognitive:read", "cognitive:write"],
      riskLevel: "medium",
      networkAccess: "none",
      reversible: true,
      timeoutMs: 15000,
    });

    this.register({
      capabilityId: "policy_check",
      version: "1.0.0",
      inputSchema: { type: "object", properties: { action: { type: "string" } } },
      outputSchema: { type: "object", properties: { allowed: { type: "boolean" } } },
      requiredScopes: ["pipeline:execute"],
      riskLevel: "low",
      networkAccess: "none",
      reversible: true,
      timeoutMs: 2000,
    });

    this.register({
      capabilityId: "territory_query",
      version: "1.0.0",
      inputSchema: { type: "object", properties: { territoryId: { type: "string" } } },
      outputSchema: { type: "object", properties: { data: { type: "object" } } },
      requiredScopes: ["cognitive:read"],
      riskLevel: "low",
      networkAccess: "none",
      reversible: true,
      timeoutMs: 5000,
    });
  }
}

export const capabilityRegistry = new CapabilityRegistry();
