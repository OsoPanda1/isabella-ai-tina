export type FederationId =
  | "TERRITORY"
  | "ECONOMY"
  | "EDUCATION"
  | "INFRASTRUCTURE"
  | "SOVEREIGNTY"
  | "ETHICS_CULTURE"
  | "CIVILIZATIONAL_ARCHIVE";

export type SkillRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type SkillStatus = "SUCCESS" | "PARTIAL" | "BLOCKED" | "ESCALATED" | "FAILED";

export interface Evidence {
  id: string;
  source: string;
  excerpt?: string;
  uri?: string;
  score?: number;
  timestamp?: string;
}

export interface AuditEvent {
  id: string;
  type:
    | "SKILL_INVOKED"
    | "SKILL_COMPLETED"
    | "SKILL_BLOCKED"
    | "POLICY_VIOLATION"
    | "HUMAN_REVIEW_REQUIRED";
  skillId: string;
  actorId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface SkillContext {
  requestId: string;
  actorId?: string;
  locale: string;
  federation: FederationId;
  intent: string;
  text?: string;
  metadata?: Record<string, unknown>;
  evidence?: Evidence[];
  history?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp?: string;
  }>;
}

export interface SkillResult<T = unknown> {
  skillId: string;
  status: SkillStatus;
  summary: string;
  data: T;
  evidence: Evidence[];
  warnings: string[];
  auditEvents: AuditEvent[];
  requiresHumanReview?: boolean;
}

export interface IsabellaSkill<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly federation: FederationId;
  readonly risk: SkillRisk;
  readonly description: string;
  canRun(input: TInput, context: SkillContext): boolean;
  run(input: TInput, context: SkillContext): Promise<SkillResult<TOutput>>;
}

export const nowIso = () => new Date().toISOString();

export const createAuditEvent = (
  type: AuditEvent["type"],
  skillId: string,
  payload: Record<string, unknown>,
  actorId?: string,
): AuditEvent => ({
  id: crypto.randomUUID(),
  type,
  skillId,
  actorId,
  timestamp: nowIso(),
  payload,
});

export const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const unique = <T>(items: T[]) => [...new Set(items)];
