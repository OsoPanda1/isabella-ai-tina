-- Attribute ABX decisions to the authenticated principal without trusting request IDs.
ALTER TABLE abx_decisions
  ADD COLUMN IF NOT EXISTS actor_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_abx_tenant_actor_created
  ON abx_decisions (tenant_id, actor_user_id, created_at DESC);
