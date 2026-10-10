/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — TOOL DISPATCH (Module 7)
 * Validates tool calls, checks permissions, executes via registry.
 * ================================================================
 */
import { REGISTERED_TOOLS, executeTool } from "../../domains/ai/infrastructure/tools-catalog";
import type { IsabellaDecisionToolCall } from "../../contracts/isabella";

export interface ToolDispatchResult {
  readonly toolName: string;
  readonly success: boolean;
  readonly result: Record<string, unknown>;
  readonly executionMs: number;
  readonly authorized: boolean;
  readonly denyReason?: string;
}

const TOOL_AUTHORIZATION: Record<string, { minRisk?: string; requiresConsent?: boolean }> = {
  rdm_territory_query: { minRisk: "low" },
  isabella_synthesize_voice: { minRisk: "low" },
  crown_cognitive_arbitrate: { minRisk: "low" },
  argus_security_audit: { minRisk: "low" },
  sovereign_ledger_commit: { minRisk: "medium", requiresConsent: true },
};

export function authorizeToolCall(
  toolName: string,
  riskLevel: string,
): { allowed: boolean; reason?: string } {
  const policy = TOOL_AUTHORIZATION[toolName];
  if (!policy)
    return {
      allowed: false,
      reason: `Tool '${toolName}' is not registered in the authorization policy.`,
    };

  const tool = REGISTERED_TOOLS.find((t) => t.name === toolName);
  if (!tool) return { allowed: false, reason: `Tool '${toolName}' not found in catalog.` };
  if (!tool.allowed) return { allowed: false, reason: `Tool '${toolName}' is disabled by policy.` };

  const riskOrder = ["low", "medium", "high"];
  const minIdx = riskOrder.indexOf(policy.minRisk || "low");
  const actIdx = riskOrder.indexOf(riskLevel);
  if (actIdx > minIdx)
    return {
      allowed: false,
      reason: `Risk '${riskLevel}' exceeds tool maximum '${policy.minRisk}'.`,
    };

  return { allowed: true };
}

export async function resolveToolCall(
  tc: { name: string; arguments: Record<string, unknown> },
  _userId: string,
  _tenantId: string,
): Promise<ToolDispatchResult> {
  const auth = authorizeToolCall(tc.name, "low");
  if (!auth.allowed) {
    return {
      toolName: tc.name,
      success: false,
      result: { error: auth.reason },
      executionMs: 0,
      authorized: false,
      denyReason: auth.reason,
    };
  }

  const toolCall: IsabellaDecisionToolCall = { toolName: tc.name, arguments: tc.arguments };
  const result = await executeTool(toolCall);
  return {
    toolName: tc.name,
    success: result.success,
    result: result.result,
    executionMs: result.executionTimeMs,
    authorized: true,
  };
}
