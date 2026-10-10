/**
 * Approval Ledger Repository (src/lib/repositories/approval-repository.ts)
 * -----------------------------------------------------------------
 * Single-use atomic approval tokens with human-in-the-loop audit receipts.
 * Durable approvals use the `approval_ledger` Postgres table
 * (supabase/migrations/20260907090000_approval_ledger.sql) when DATABASE_URL
 * is available; the in-memory repository remains for embedded/runtime use.
 */
import { randomUUID } from "node:crypto";
import { getPgPool } from "../persistence/postgres";

const APPROVAL_TTL_MS = 15 * 60 * 1000;

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

/**
 * Grants a durable single-use approval token bound to a (traceId, tool)
 * operation. Persisted to `approval_ledger` as `APPROVED` with a 15-minute TTL.
 */
export async function grantApprovalAsync(
  traceId: string,
  tool: string,
  requesterId: string,
  tenantId: string,
): Promise<{ approvalId: string; expiresAt: string }> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error("APPROVAL_LEDGER_UNAVAILABLE: DATABASE_URL is required for durable approvals.");
  }
  const { rows } = await pool.query(
    `INSERT INTO approval_ledger (tenant_id, action, resource, requester_id, status, payload)
     VALUES ($1, $2, $3, $4, 'APPROVED', $5::jsonb)
     RETURNING id, created_at`,
    [tenantId, "execute", tool, requesterId, JSON.stringify({ traceId, tool })],
  );
  if (!rows[0]) {
    throw new Error("APPROVAL_GRANT_FAILED");
  }
  const createdAt = rows[0].created_at as string;
  const expiresAt = new Date(new Date(createdAt).getTime() + APPROVAL_TTL_MS).toISOString();
  return { approvalId: String(rows[0].id), expiresAt };
}

/**
 * Reports whether an active (non-expired) approval exists for the given
 * (traceId, tool, requester, tenant) tuple within the 15-minute window.
 */
export async function hasApprovalAsync(
  traceId: string,
  tool: string,
  requesterId: string,
  tenantId: string,
): Promise<boolean> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error("APPROVAL_LEDGER_UNAVAILABLE: DATABASE_URL is required for durable approvals.");
  }
  const { rows } = await pool.query(
    `SELECT 1 FROM approval_ledger
      WHERE tenant_id = $1
        AND status = 'APPROVED'
        AND requester_id = $2
        AND payload->>'traceId' = $3
        AND payload->>'tool' = $4
        AND created_at > now() - ($5::int * interval '1 millisecond')
      LIMIT 1`,
    [tenantId, requesterId, traceId, tool, APPROVAL_TTL_MS],
  );
  return rows.length > 0;
}
