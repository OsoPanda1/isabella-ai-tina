ALTER TABLE memory_records
  ADD COLUMN IF NOT EXISTS session_id UUID NULL;

-- Existing session-scoped records predate explicit session IDs. Assign each one
-- its own ID rather than silently grouping unrelated records into one session.
UPDATE memory_records
SET session_id = id
WHERE scope = 'SESSION' AND session_id IS NULL;

ALTER TABLE memory_records
  ADD CONSTRAINT memory_session_scope_consistency
  CHECK (
    (scope = 'SESSION' AND session_id IS NOT NULL)
    OR (scope <> 'SESSION' AND session_id IS NULL)
  ) NOT VALID;
ALTER TABLE memory_records
  VALIDATE CONSTRAINT memory_session_scope_consistency;

CREATE INDEX IF NOT EXISTS idx_memory_session_scope
  ON memory_records (tenant_id, user_id, session_id, created_at DESC)
  WHERE scope = 'SESSION';
