CREATE TABLE IF NOT EXISTS bookpi_events(sequence BIGSERIAL UNIQUE NOT NULL,event_id UUID PRIMARY KEY,trace_id UUID NOT NULL,event_type TEXT NOT NULL,world_state_hash TEXT NOT NULL,expert_set_hash TEXT NOT NULL,reasoning_hash TEXT NOT NULL,outcome_hash TEXT NOT NULL,previous_hash TEXT NOT NULL,event_hash TEXT NOT NULL UNIQUE,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_bookpi_trace ON bookpi_events(trace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookpi_previous ON bookpi_events(previous_hash);
