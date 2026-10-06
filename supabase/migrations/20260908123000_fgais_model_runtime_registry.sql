-- 20260908123000_fgais_model_runtime_registry.sql
-- FGAIS Model Runtime Registry and Federation

CREATE TABLE IF NOT EXISTS fgais_model_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id text NOT NULL UNIQUE,
  provider text NOT NULL,
  version text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluation_score numeric NOT NULL DEFAULT 95.0,
  certified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fgais_federation_replay (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  federation_id text NOT NULL,
  event_hash text NOT NULL,
  payload jsonb NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS isabella_learning_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  adapter_id text NOT NULL,
  version text NOT NULL,
  weights_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fgais_model_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE fgais_federation_replay ENABLE ROW LEVEL SECURITY;
ALTER TABLE isabella_learning_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON fgais_model_registry FROM anon, authenticated;
REVOKE ALL ON fgais_federation_replay FROM anon, authenticated;
REVOKE ALL ON isabella_learning_state FROM anon, authenticated;
