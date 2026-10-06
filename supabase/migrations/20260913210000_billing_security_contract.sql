-- 20260913210000_billing_security_contract.sql
-- Economic events, idempotency, billing security and accounting

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  prefix text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz,
  revoked_at timestamptz,
  rotated_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS economic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  amount_minor bigint NOT NULL DEFAULT 0,
  provider text NOT NULL DEFAULT 'stripe',
  provider_event_id text,
  idempotency_key text NOT NULL UNIQUE,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'PROCESSED'
);

CREATE TABLE IF NOT EXISTS billing_payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_checkout_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_run_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  max_cost_cents integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connector_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector text NOT NULL,
  event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_checkout_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_run_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON webhook_events FROM anon, authenticated;
REVOKE ALL ON billing_payment_intents FROM anon, authenticated;
REVOKE ALL ON billing_checkout_idempotency FROM anon, authenticated;
REVOKE ALL ON billing_run_authorizations FROM anon, authenticated;
REVOKE ALL ON connector_webhook_events FROM anon, authenticated;
