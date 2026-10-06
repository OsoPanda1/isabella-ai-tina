import { describe, it, expect } from "vitest";

/**
 * FRAUD REVIEW + PAYOUT GUARD (test/unit/fraud-review.test.ts)
 * -----------------------------------------------------------------
 * risk scoring → hold/pass/fraud → decisión humana de un solo uso →
 * payout con doble aprobación y congelamiento por disputas.
 */

import {
  evaluateWithdrawalRisk,
  createFraudReviewQueue,
  assertPayoutAllowed,
} from "@/lib/monetization/fraud-review";

const BASE_INPUT = {
  userId: "u_fraud",
  amountCents: 5000,
  accountAgeDays: 120,
  withdrawalsLast24h: 0,
  failedAttemptsLast24h: 0,
  sanctioned: false,
  underFraudReview: false,
  identityVerified: true,
};

describe("risk scoring determinista", () => {
  it("cuenta limpia y monto bajo pasa", () => {
    const evaluation = evaluateWithdrawalRisk(BASE_INPUT);
    expect(evaluation.status).toBe("pass");
    expect(evaluation.score).toBe(0);
  });

  it("cuenta sancionada bloquea", () => {
    const evaluation = evaluateWithdrawalRisk({
      ...BASE_INPUT,
      sanctioned: true,
    });
    expect(evaluation.status).toBe("fraud_detected");
    expect(evaluation.signals).toContain("account-flagged");
  });

  it("cuenta nueva con monto alto va a hold", () => {
    const evaluation = evaluateWithdrawalRisk({
      ...BASE_INPUT,
      accountAgeDays: 5,
      amountCents: 60_000,
    });
    expect(evaluation.status).toBe("hold");
    expect(evaluation.signals).toContain("new-account-high-amount");
  });

  it("ráfaga de retiros va a hold", () => {
    const evaluation = evaluateWithdrawalRisk({
      ...BASE_INPUT,
      withdrawalsLast24h: 4,
    });
    expect(evaluation.status).toBe("hold");
  });
});

describe("cola de revisión humana", () => {
  it("decisión de un solo uso: segunda decisión se rechaza", async () => {
    const { createFraudReviewQueue } = await import("@/lib/monetization/fraud-review");
    const queue = createFraudReviewQueue({ audit: () => undefined });
    const evaluation = evaluateWithdrawalRisk({
      ...BASE_INPUT,
      withdrawalsLast24h: 4,
    });
    const opened = queue.open(evaluation, "u_fraud", 5000);
    expect(opened.status).toBe("hold");

    const first = queue.decide(opened.reviewId, "approve", "rev_1", "Verificado manualmente.");
    expect(first?.status).toBe("pass");
    const second = queue.decide(opened.reviewId, "deny", "rev_2", "Cambio de opinión.");
    expect(second).toBeNull();
  });

  it("deny congela en fraud_detected", async () => {
    const { createFraudReviewQueue } = await import("@/lib/monetization/fraud-review");
    const queue = createFraudReviewQueue({ audit: () => undefined });
    const evaluation = evaluateWithdrawalRisk({
      ...BASE_INPUT,
      sanctioned: true,
    });
    const opened = queue.open(evaluation, "u_fraud", 5000);
    const decided = queue.decide(opened.reviewId, "deny", "rev_1", "Fraude confirmado.");
    expect(decided?.status).toBe("fraud_detected");
  });
});

describe("payout guard", () => {
  function approvedCase(amountCents: number, reviewer: string) {
    const queue = createFraudReviewQueue({ audit: () => undefined });
    const evaluation = evaluateWithdrawalRisk({
      ...BASE_INPUT,
      withdrawalsLast24h: 4,
    });
    const opened = queue.open(evaluation, "u_fraud", amountCents);
    queue.decide(opened.reviewId, "approve", reviewer, "OK.");
    return { queue, reviewId: opened.reviewId };
  }

  it("monto bajo con hold aprobado autoriza", () => {
    const { queue, reviewId } = approvedCase(5000, "rev_1");
    const result = assertPayoutAllowed(
      {
        userId: "u_fraud",
        tenantId: "t1",
        amountCents: 5000,
        idempotencyKey: "idem_1",
        reviewId,
        reviewerIds: ["rev_1"],
      },
      queue,
      { audit: () => undefined },
    );
    expect(result.allowed).toBe(true);
  });

  it("monto alto exige doble aprobación distinta", () => {
    const { queue, reviewId } = approvedCase(200_000, "rev_1");
    const single = assertPayoutAllowed(
      {
        userId: "u_fraud",
        tenantId: "t1",
        amountCents: 200_000,
        idempotencyKey: "idem_2",
        reviewId,
        reviewerIds: ["rev_1"],
      },
      queue,
      { audit: () => undefined },
    );
    expect(single.allowed).toBe(false);
    expect(single.reason).toMatch(/doble aprobación/);

    const dual = assertPayoutAllowed(
      {
        userId: "u_fraud",
        tenantId: "t1",
        amountCents: 200_000,
        idempotencyKey: "idem_3",
        reviewId,
        reviewerIds: ["rev_1", "rev_2"],
      },
      queue,
      { audit: () => undefined },
    );
    expect(dual.allowed).toBe(true);
  });

  it("hold sin decisión no autoriza", () => {
    const queue = createFraudReviewQueue({ audit: () => undefined });
    const evaluation = evaluateWithdrawalRisk({
      ...BASE_INPUT,
      withdrawalsLast24h: 4,
    });
    const opened = queue.open(evaluation, "u_fraud", 5000);
    const result = assertPayoutAllowed(
      {
        userId: "u_fraud",
        tenantId: "t1",
        amountCents: 5000,
        idempotencyKey: "idem_4",
        reviewId: opened.reviewId,
        reviewerIds: [],
      },
      queue,
      { audit: () => undefined },
    );
    expect(result.allowed).toBe(false);
  });

  it("disputa abierta congela payouts aunque haya aprobación", () => {
    const { queue, reviewId } = approvedCase(5000, "rev_1");
    queue.openDispute({
      provider: "stripe",
      providerEventId: "dp_test_1",
      tenantId: "t1",
      amountMinor: 5000,
    });
    const result = assertPayoutAllowed(
      {
        userId: "u_fraud",
        tenantId: "t1",
        amountCents: 5000,
        idempotencyKey: "idem_5",
        reviewId,
        reviewerIds: ["rev_1"],
      },
      queue,
      { audit: () => undefined },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/congelados/);
  });

  it("disputa duplicada retorna la misma (idempotencia)", () => {
    const queue = createFraudReviewQueue({ audit: () => undefined });
    const first = queue.openDispute({
      provider: "stripe",
      providerEventId: "dp_dup",
      tenantId: "t1",
      amountMinor: 100,
    });
    const second = queue.openDispute({
      provider: "stripe",
      providerEventId: "dp_dup",
      tenantId: "t1",
      amountMinor: 100,
    });
    expect(second.disputeId).toBe(first.disputeId);
  });

  it("sin sink de auditoría no hay payouts", () => {
    const { queue, reviewId } = approvedCase(5000, "rev_1");
    const result = assertPayoutAllowed(
      {
        userId: "u_fraud",
        tenantId: "t1",
        amountCents: 5000,
        idempotencyKey: "idem_6",
        reviewId,
        reviewerIds: ["rev_1"],
      },
      queue,
    );
    expect(result.allowed).toBe(false);
  });
});
