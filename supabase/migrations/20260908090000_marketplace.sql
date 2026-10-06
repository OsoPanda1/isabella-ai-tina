-- 20260908090000_marketplace.sql
-- Sovereign Skill and Model Marketplace

CREATE TABLE IF NOT EXISTS marketplace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  creator_id text NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('skill', 'agent', 'model', 'prompt_pack')),
  price_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PENDING_REVIEW', 'SUSPENDED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_category ON marketplace(category, status);

ALTER TABLE marketplace ENABLE ROW LEVEL SECURITY;
