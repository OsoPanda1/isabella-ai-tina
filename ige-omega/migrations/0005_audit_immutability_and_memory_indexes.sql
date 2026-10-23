-- Reduce accidental or application-level mutation of the evidence ledger.
-- Database owners/superusers can still disable triggers; this is not WORM storage.
CREATE OR REPLACE FUNCTION bookpi_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'bookpi_events is append-only; % is prohibited', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_bookpi_append_only ON bookpi_events;
CREATE TRIGGER trg_bookpi_append_only
BEFORE UPDATE OR DELETE ON bookpi_events
FOR EACH ROW EXECUTE FUNCTION bookpi_reject_mutation();

CREATE INDEX IF NOT EXISTS idx_memory_expiring
ON memory_records (expires_at)
WHERE expires_at IS NOT NULL;

-- Fail closed on invalid epistemic labels and blank provenance in future writes.
ALTER TABLE memory_records
  ADD CONSTRAINT memory_records_epistemic_state_check
  CHECK (epistemic_state IN (
    'UNVERIFIED', 'SOURCE_FOUND', 'CORROBORATED',
    'ACADEMICALLY_SUPPORTED', 'REPRODUCIBLE', 'VALIDATED',
    'ESTABLISHED', 'DISPUTED', 'REJECTED', 'DEPRECATED'
  )) NOT VALID;
ALTER TABLE memory_records
  VALIDATE CONSTRAINT memory_records_epistemic_state_check;
