-- Index the tenant-scoped traversal paths used by the persistent World Model.
CREATE INDEX IF NOT EXISTS idx_world_entities_tenant_name
  ON world_entities (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_world_relations_tenant_source
  ON world_relations (tenant_id, source);
CREATE INDEX IF NOT EXISTS idx_world_relations_tenant_target
  ON world_relations (tenant_id, target);
CREATE INDEX IF NOT EXISTS idx_causal_edges_tenant_effect
  ON causal_edges (tenant_id, effect);

-- Enforce tenant ownership at the database boundary as well as in Rust.
CREATE OR REPLACE FUNCTION worldmodel_validate_relation_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM world_entities
    WHERE tenant_id = NEW.tenant_id AND entity_id = NEW.source
  ) OR NOT EXISTS (
    SELECT 1 FROM world_entities
    WHERE tenant_id = NEW.tenant_id AND entity_id = NEW.target
  ) THEN
    RAISE EXCEPTION 'world relation endpoints must belong to relation tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION worldmodel_validate_causal_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM world_entities
    WHERE tenant_id = NEW.tenant_id AND entity_id = NEW.cause
  ) OR NOT EXISTS (
    SELECT 1 FROM world_entities
    WHERE tenant_id = NEW.tenant_id AND entity_id = NEW.effect
  ) THEN
    RAISE EXCEPTION 'causal edge endpoints must belong to causal edge tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_world_relation_tenant ON world_relations;
CREATE TRIGGER trg_world_relation_tenant
BEFORE INSERT OR UPDATE ON world_relations
FOR EACH ROW EXECUTE FUNCTION worldmodel_validate_relation_tenant();

DROP TRIGGER IF EXISTS trg_world_causal_tenant ON causal_edges;
CREATE TRIGGER trg_world_causal_tenant
BEFORE INSERT OR UPDATE ON causal_edges
FOR EACH ROW EXECUTE FUNCTION worldmodel_validate_causal_tenant();
