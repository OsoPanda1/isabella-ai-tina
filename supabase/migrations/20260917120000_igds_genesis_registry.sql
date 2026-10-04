-- ============================================================================
-- IGDS — ISABELLA GENESIS DOCUMENT SEAL REGISTRY
-- Fecha: 2026-09-17
--
-- Registro soberano append-only para sellos documentales (IGDS):
--   * igds_entries      — cadena de hashes (seal / revocation).
--   * igds_checkpoints  — checkpoints Merkle firmados.
--   * igds_revocations  — proyección consultable de revocaciones.
--
-- Reglas:
--   * Inmutabilidad impuesta por trigger (misma función que BookPI/audit).
--   * RLS habilitado sin políticas para conexiones no privilegiadas; el
--     backend productivo conecta como owner y aplica autorización server-side.
--   * Sin datos ni credenciales.
-- ============================================================================
-- Nota: sin BEGIN/COMMIT — el runner envuelve todo en una sola transacción

CREATE TABLE IF NOT EXISTS public.igds_entries (
    sequence            BIGINT PRIMARY KEY,
    entry_id            VARCHAR(160) NOT NULL UNIQUE,
    entry_type          VARCHAR(32) NOT NULL CHECK (entry_type IN ('seal', 'revocation')),
    document_id         VARCHAR(255) NOT NULL,
    document_digest     VARCHAR(160) NOT NULL,
    manifest_digest     VARCHAR(160) NOT NULL,
    previous_entry_hash CHAR(64) NOT NULL,
    entry_hash          CHAR(64) NOT NULL UNIQUE,
    signature           JSONB NOT NULL,
    revocation          JSONB,
    payload             JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (char_length(entry_hash) = 64),
    CHECK (char_length(previous_entry_hash) = 64)
);
CREATE INDEX IF NOT EXISTS idx_igds_entries_document
    ON public.igds_entries(document_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_igds_entries_type
    ON public.igds_entries(entry_type, sequence DESC);

CREATE TABLE IF NOT EXISTS public.igds_checkpoints (
    id              BIGSERIAL PRIMARY KEY,
    tree_size       BIGINT NOT NULL CHECK (tree_size > 0),
    root_hash       CHAR(64) NOT NULL,
    first_sequence  BIGINT NOT NULL,
    last_sequence   BIGINT NOT NULL,
    generated_at    TIMESTAMPTZ NOT NULL,
    signature       JSONB NOT NULL,
    timestamp_token JSONB,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (char_length(root_hash) = 64),
    UNIQUE (tree_size, root_hash)
);

CREATE TABLE IF NOT EXISTS public.igds_revocations (
    revocation_id VARCHAR(160) PRIMARY KEY,
    target_type   VARCHAR(64) NOT NULL,
    target_id     VARCHAR(255) NOT NULL,
    reason        VARCHAR(64) NOT NULL,
    scope         VARCHAR(64) NOT NULL,
    issued_by     VARCHAR(255) NOT NULL,
    effective_at  TIMESTAMPTZ NOT NULL,
    entry_hash    CHAR(64) NOT NULL,
    payload       JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_igds_revocations_target
    ON public.igds_revocations(target_type, target_id, effective_at);

-- Inmutabilidad: append-only estricto.
DROP TRIGGER IF EXISTS trg_prevent_igds_entries_update ON public.igds_entries;
CREATE TRIGGER trg_prevent_igds_entries_update
    BEFORE UPDATE ON public.igds_entries
    FOR EACH ROW EXECUTE FUNCTION public.prevent_bookpi_mutation();

DROP TRIGGER IF EXISTS trg_prevent_igds_entries_delete ON public.igds_entries;
CREATE TRIGGER trg_prevent_igds_entries_delete
    BEFORE DELETE ON public.igds_entries
    FOR EACH ROW EXECUTE FUNCTION public.prevent_bookpi_mutation();

DROP TRIGGER IF EXISTS trg_prevent_igds_checkpoints_update ON public.igds_checkpoints;
CREATE TRIGGER trg_prevent_igds_checkpoints_update
    BEFORE UPDATE ON public.igds_checkpoints
    FOR EACH ROW EXECUTE FUNCTION public.prevent_bookpi_mutation();

DROP TRIGGER IF EXISTS trg_prevent_igds_checkpoints_delete ON public.igds_checkpoints;
CREATE TRIGGER trg_prevent_igds_checkpoints_delete
    BEFORE DELETE ON public.igds_checkpoints
    FOR EACH ROW EXECUTE FUNCTION public.prevent_bookpi_mutation();

DROP TRIGGER IF EXISTS trg_prevent_igds_revocations_update ON public.igds_revocations;
CREATE TRIGGER trg_prevent_igds_revocations_update
    BEFORE UPDATE ON public.igds_revocations
    FOR EACH ROW EXECUTE FUNCTION public.prevent_bookpi_mutation();

DROP TRIGGER IF EXISTS trg_prevent_igds_revocations_delete ON public.igds_revocations;
CREATE TRIGGER trg_prevent_igds_revocations_delete
    BEFORE DELETE ON public.igds_revocations
    FOR EACH ROW EXECUTE FUNCTION public.prevent_bookpi_mutation();

-- Defensa para conexiones no privilegiadas (sin políticas = deny por defecto).
ALTER TABLE public.igds_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.igds_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.igds_revocations ENABLE ROW LEVEL SECURITY;
