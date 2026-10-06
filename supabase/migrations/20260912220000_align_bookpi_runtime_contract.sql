-- 20260912220000_align_bookpi_runtime_contract.sql
-- BookPI and Audit Ledger with append-only integrity functions

CREATE OR REPLACE FUNCTION public.prevent_bookpi_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append_only_violation: % cannot be mutated', TG_TABLE_NAME;
END;
$$;

CREATE TABLE IF NOT EXISTS bookpi_ledger (
  index bigint NOT NULL,
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  operation text NOT NULL,
  category text NOT NULL,
  cost_decimal numeric(14,6) NOT NULL DEFAULT 0,
  tokens_consumed bigint NOT NULL DEFAULT 0,
  previous_hash text NOT NULL,
  block_hash text NOT NULL,
  signature_algorithm text NOT NULL,
  status text NOT NULL,
  nonce bigint NOT NULL,
  PRIMARY KEY (tenant_id, index)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  trace_id text NOT NULL,
  correlation_id text NOT NULL,
  actor_ip text NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  resource text NOT NULL,
  event text NOT NULL,
  severity text NOT NULL,
  result text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_hash text NOT NULL,
  previous_log_hash text NOT NULL
);

ALTER TABLE bookpi_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_bookpi_update') THEN
    CREATE TRIGGER trg_prevent_bookpi_update
    BEFORE UPDATE OR DELETE ON bookpi_ledger
    FOR EACH ROW EXECUTE FUNCTION public.prevent_bookpi_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_audit_update') THEN
    CREATE TRIGGER trg_prevent_audit_update
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION public.prevent_bookpi_mutation();
  END IF;
END $$;
