import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "@/lib/policy-engine";
import type { RegisteredTool } from "@/lib/tool-registry";

const baseTool: RegisteredTool = {
  name: "test.tool",
  purpose: "Unit-test tool",
  inputSchemaDescription: "test",
  outputDescription: "test",
  risk: "medium",
  requiredPermissions: ["test:execute"],
  maxTimeMs: 1000,
  maxRetries: 0,
  auditEvent: "tool.test",
  category: "system",
  requiresApproval: false,
  territorialBoundary: false,
};

describe("ARGUS policy engine", () => {
  it("allows low/medium actions below the approval threshold", () => {
    const result = evaluatePolicy({
      tool: baseTool,
      territorialBoundaryEnforced: false,
      humanInTheLoop: true,
      approvalThreshold: "medium",
      consentRequired: false,
      consentGranted: false,
    });

    expect(result.decision).toBe("allowed");
    expect(result.approvalRequired).toBe(false);
    expect(result.escalationRequired).toBe(false);
  });

  it("returns requires_approval instead of hard-denying a high-risk action when a human can approve", () => {
    const result = evaluatePolicy({
      tool: { ...baseTool, risk: "high" },
      territorialBoundaryEnforced: false,
      humanInTheLoop: true,
      approvalThreshold: "medium",
      consentRequired: false,
      consentGranted: false,
    });

    expect(result.decision).toBe("requires_approval");
    expect(result.approvalRequired).toBe(true);
    expect(result.escalationRequired).toBe(true);
  });

  it("allows an approval-gated tool once a valid approval is supplied", () => {
    const result = evaluatePolicy({
      tool: { ...baseTool, requiresApproval: true, risk: "high" },
      territorialBoundaryEnforced: false,
      humanInTheLoop: true,
      approvalThreshold: "medium",
      consentRequired: true,
      consentGranted: true,
    });

    expect(result.decision).toBe("allowed");
    expect(result.approvalRequired).toBe(true);
  });

  it("denies approval-gated actions when no human is available", () => {
    const result = evaluatePolicy({
      tool: { ...baseTool, requiresApproval: true, risk: "critical" },
      territorialBoundaryEnforced: false,
      humanInTheLoop: false,
      approvalThreshold: "medium",
      consentRequired: true,
      consentGranted: false,
    });

    expect(result.decision).toBe("denied");
    expect(result.approvalRequired).toBe(true);
  });

  it("hard-denies territorial boundary violations", () => {
    const result = evaluatePolicy({
      tool: { ...baseTool, territorialBoundary: true },
      territorialBoundaryEnforced: true,
      humanInTheLoop: true,
      approvalThreshold: "critical",
      consentRequired: false,
      consentGranted: true,
    });

    expect(result.decision).toBe("denied");
    expect(result.territorialBoundaryViolation).toBe(true);
    expect(result.approvalRequired).toBe(false);
  });

  it("hard-denies incomplete tool policy metadata", () => {
    const result = evaluatePolicy({
      tool: { ...baseTool, auditEvent: "" },
      territorialBoundaryEnforced: false,
      humanInTheLoop: true,
      approvalThreshold: "medium",
      consentRequired: false,
      consentGranted: false,
    });

    expect(result.decision).toBe("denied");
  });
});
