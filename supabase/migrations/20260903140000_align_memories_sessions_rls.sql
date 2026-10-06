-- 20260903140000_align_memories_sessions_rls.sql
-- Base schema, extensions, and sessions/memories alignment
-- pgvector extension support

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

-- Tenants table
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  tier text NOT NULL DEFAULT 'standard',
  quota_balance numeric NOT NULL DEFAULT 1000,
  quota_tier_limit numeric NOT NULL DEFAULT 10000,
  created_by text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  token_jti text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Memories table
CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  content jsonb NOT NULL,
  scope text NOT NULL DEFAULT 'session',
  sensitivity text NOT NULL DEFAULT 'medium',
  purpose text NOT NULL DEFAULT 'interaction_context',
  consent_required boolean NOT NULL DEFAULT false,
  consent boolean NOT NULL DEFAULT true,
  provenance text NOT NULL DEFAULT 'user_interaction',
  content_hash text NOT NULL,
  previous_chain_hash text NOT NULL,
  chain_hash text NOT NULL,
  expires_at timestamptz,
  source text NOT NULL DEFAULT 'chat',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
