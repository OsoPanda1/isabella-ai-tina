import { createAuditEvent, SkillContext, SkillResult } from "./contracts";

export type HumanReviewPriority = "NORMAL" | "HIGH" | "CRITICAL";

export interface HumanReviewRequest {
  reviewId: string;
  requestId: string;
  actorId?: string;
  skillId: string;
  reason: string;
  priority: HumanReviewPriority;
  createdAt: string;
  expiresAt: string;
  status: "PENDING";
  metadata: Record<string, unknown>;
}

export interface HumanReviewSink {
  enqueue(request: HumanReviewRequest): Promise<void>;
}

export class InMemoryHumanReviewSink implements HumanReviewSink {
  private readonly queue: HumanReviewRequest[] = [];

  async enqueue(request: HumanReviewRequest): Promise<void> {
    this.queue.push(structuredClone(request));
  }

  list(): readonly HumanReviewRequest[] {
    return this.queue.map((item) => structuredClone(item));
  }
}

export async function escalateToHuman<T>(
  result: SkillResult<T>,
  context: SkillContext,
  sink: HumanReviewSink,
  reason: string,
  priority: HumanReviewPriority = "HIGH",
): Promise<SkillResult<T>> {
  const now = new Date();
  const request: HumanReviewRequest = {
    reviewId: crypto.randomUUID(),
    requestId: context.requestId,
    actorId: context.actorId,
    skillId: result.skillId,
    reason,
    priority,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    status: "PENDING",
    metadata: {
      federation: context.federation,
      locale: context.locale,
    },
  };

  await sink.enqueue(request);

  return {
    ...result,
    status: "ESCALATED",
    requiresHumanReview: true,
    warnings: [...result.warnings, "La decisión requiere revisión humana explícita."],
    auditEvents: [
      ...result.auditEvents,
      createAuditEvent(
        "HUMAN_REVIEW_REQUIRED",
        result.skillId,
        {
          reviewId: request.reviewId,
          priority,
          reason,
        },
        context.actorId,
      ),
    ],
  };
}
