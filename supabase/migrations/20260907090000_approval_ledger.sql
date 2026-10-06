-- 20260907090000_approval_ledger.sql
-- Durable approval ledger for human-in-the-loop governance

CREATE TABLE IF NOT EXISTS approval_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  action text NOT NULL,
  resource text NOT NULL,
  requester_id text NOT NULL,
  approver_id text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'CONSUMED', 'REJECTED')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_approval_ledger_tenant_status ON approval_ledger(tenant_id, status);

ALTER TABLE approval_ledger ENABLE ROW LEVEL SECURITY;
