-- 20261003090000_memory_owner_metadata.sql
-- Additive schema completion for the canonical PostgreSQL memory repository.
-- No destructive statements. Existing memory rows remain intact.
--
-- The runtime memory repository persists owner provenance in user_id and keeps
-- extensible non-authoritative metadata in metadata. Both columns are optional
-- for historical rows and safe to populate for new records.

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS user_id text;

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_memories_tenant_created
  ON public.memories (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_memories_tenant_user
  ON public.memories (tenant_id, user_id)
  WHERE user_id IS NOT NULL;
