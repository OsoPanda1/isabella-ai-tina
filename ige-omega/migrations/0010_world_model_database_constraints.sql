-- Database-side bounds for direct SQL writers and future code paths.
-- NOT VALID keeps historical data from blocking migration; PostgreSQL enforces
-- these checks for new/updated rows immediately. Audit and validate separately.

ALTER TABLE world_entities
  ADD CONSTRAINT world_entity_name_bounds
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 500) NOT VALID;

ALTER TABLE world_entities
  ADD CONSTRAINT world_entity_type_bounds
  CHECK (char_length(btrim(entity_type)) BETWEEN 1 AND 100) NOT VALID;

ALTER TABLE world_entities
  ADD CONSTRAINT world_entity_provenance_bounds
  CHECK (char_length(btrim(provenance)) BETWEEN 1 AND 2000) NOT VALID;

ALTER TABLE world_relations
  ADD CONSTRAINT world_relation_label_bounds
  CHECK (char_length(btrim(relation)) BETWEEN 1 AND 200) NOT VALID;

ALTER TABLE causal_edges
  ADD CONSTRAINT causal_evidence_array_bounds
  CHECK (
    CASE
      WHEN jsonb_typeof(evidence) = 'array'
        THEN jsonb_array_length(evidence) <= 64
      ELSE FALSE
    END
  ) NOT VALID;
