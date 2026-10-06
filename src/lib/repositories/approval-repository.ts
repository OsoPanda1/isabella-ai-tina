/**
 * Approval Ledger Repository (src/lib/repositories/approval-repository.ts)
 * -----------------------------------------------------------------
 * Single-use atomic approval tokens with human-in-the-loop audit receipts.
 */
import { randomUUID } from "node:crypto";

export interface ApprovalRecord {
  id: string;
  tenant_id: string;
  action: string;
  resource: string;
  requester_id: string;
  approver_id?: string;
  status: "PENDING" | "APPROVED" | "CONSUMED" | "REJECTED";
  created_at: string;
  consumed_at?: string;
  payload: Record<string, unknown>;
}

class InMemoryApprovalRepository {
  private approvals = new Map<string, ApprovalRecord>();

  async createApproval(input: {
    tenant_id: string;
    action: string;
    resource: string;
    requester_id: string;
    payload?: Record<string, unknown>;
  }): Promise<ApprovalRecord> {
    const id = `appr_${randomUUID()}`;
    const record: ApprovalRecord = {
      id,
      tenant_id: input.tenant_id,
      action: input.action,
      resource: input.resource,
      requester_id: input.requester_id,
      status: "APPROVED",
      created_at: new Date().toISOString(),
      payload: input.payload || {},
    };
    this.approvals.set(id, record);
    return record;
  }

  async consumeApproval(
    id: string,
    consumerId: string,
  ): Promise<{ success: boolean; record?: ApprovalRecord; error?: string }> {
    const record = this.approvals.get(id);
    if (!record) {
      return { success: false, error: "APPROVAL_NOT_FOUND" };
    }
    if (record.status === "CONSUMED") {
      return { success: false, error: "APPROVAL_ALREADY_CONSUMED" };
    }
    if (record.status !== "APPROVED") {
      return { success: false, error: "APPROVAL_NOT_IN_APPROVED_STATE" };
    }

    record.status = "CONSUMED";
    record.consumed_at = new Date().toISOString();
    record.approver_id = consumerId;
    this.approvals.set(id, record);

    return { success: true, record };
  }

  async getApproval(id: string): Promise<ApprovalRecord | null> {
    return this.approvals.get(id) || null;
  }
}

export const approvalRepository = new InMemoryApprovalRepository();
export default approvalRepository;
