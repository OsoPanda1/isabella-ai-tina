-- Defense in depth: repository validation is authoritative for useful errors,
-- while PostgreSQL rejects malformed writes from alternate application paths.
-- NOT VALID avoids blocking deployment on historical rows; new inserts/updates
-- are checked immediately. Audit and repair legacy violations before VALIDATE.

ALTER TABLE memory_records
  ADD CONSTRAINT memory_content_bounds
  CHECK (char_length(btrim(content)) BETWEEN 1 AND 20000) NOT VALID;

ALTER TABLE memory_records
  ADD CONSTRAINT memory_provenance_bounds
  CHECK (char_length(btrim(provenance)) BETWEEN 1 AND 2000) NOT VALID;

ALTER TABLE memory_records
  ADD CONSTRAINT memory_importance_bounds
  CHECK (importance >= 0 AND importance <= 1) NOT VALID;

ALTER TABLE memory_records
  ADD CONSTRAINT memory_embedding_shape_bounds
  CHECK (
    CASE
      WHEN embedding IS NULL THEN TRUE
      WHEN jsonb_typeof(embedding) = 'array'
        THEN jsonb_array_length(embedding) <= 16384
      ELSE FALSE
    END
  ) NOT VALID;
