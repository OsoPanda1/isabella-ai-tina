import { describe, it, expect } from "vitest";
import { grantApprovalAsync, hasApprovalAsync, approvalRepository } from "@/lib/repositories/approval-repository";
import { createBookpiPostgresRepository } from "@/lib/repositories/bookpi-postgres-repository";

describe("approval-repository", () => {
  it("grants and consumes in-memory approvals atomically", async () => {
    const record = await approvalRepository.createApproval({
      tenant_id: "tenant-a",
      action: "execute",
      resource: "rdm_territory_query",
      requester_id: "user-1",
    });
    expect(record.status).toBe("APPROVED");
    expect(record.id).toMatch(/^appr_/);

    const consumed = await approvalRepository.consumeApproval(record.id, "approver-1");
    expect(consumed.success).toBe(true);

    const replay = await approvalRepository.consumeApproval(record.id, "approver-2");
    expect(replay.success).toBe(false);
  });

  it("durable approval functions fail closed without DATABASE_URL", async () => {
    if (!process.env.DATABASE_URL) {
      await expect(
        grantApprovalAsync("trc_1", "rdm_territory_query", "user-1", "tenant-a"),
      ).rejects.toThrow(/APPROVAL_LEDGER_UNAVAILABLE/);
      await expect(
        hasApprovalAsync("trc_1", "rdm_territory_query", "user-1", "tenant-a"),
      ).rejects.toThrow(/APPROVAL_LEDGER_UNAVAILABLE/);
    }
  });
});

describe("bookpi marketplace purchase", () => {
  it("refuses to boot the durable repository without DATABASE_URL (fail-closed)", () => {
    if (!process.env.DATABASE_URL) {
      expect(() => createBookpiPostgresRepository()).toThrow(/BOOKPI_POSTGRES_UNAVAILABLE/);
    }
  });
});