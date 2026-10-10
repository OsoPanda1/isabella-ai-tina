/**
 * CANONICAL TYPES — Isabella Sovereign Architecture
 * ═════════════════════════════════════════════════════════════════════
 *
 * Core type definitions for Isabella's governance model.
 * All critical objects must conform to these contracts.
 */

export interface IsabellaPerception {
  traceId: string;
  correlationId: string;
  tenantId: string;
  userId: string;
  input: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface IsabellaDecision {
  decisionId: string;
  intent: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  policyDecision: "ALLOWED" | "REQUIRES_APPROVAL" | "DENIED";
  toolAuthorizations: string[];
  reasoning: string;
}

export interface ExecutionRecord {
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  exitCode: number;
  duration: number; // milliseconds
  error?: string;
}

export interface AuditBundle {
  digest: string;
  signature: string;
  timestamp: Date;
  actor: string;
  policyVersion: string;
}

export interface DecisionRecord {
  id: string;
  perception: IsabellaPerception;
  decision: IsabellaDecision;
  execution: ExecutionRecord | null;
  auditBundle: AuditBundle;
}
