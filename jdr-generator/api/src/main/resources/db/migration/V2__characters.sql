CREATE TABLE characters (
  id BINARY(16) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  owner_subject VARCHAR(255) NOT NULL,
  name VARCHAR(120) NOT NULL,
  character_class VARCHAR(80) NOT NULL,
  race VARCHAR(80) NOT NULL,
  level INT NOT NULL,
  attributes_json JSON NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  deleted_at TIMESTAMP(6) NULL,
  INDEX idx_char_tenant_active (tenant_id, deleted_at),
  INDEX idx_char_owner (tenant_id, owner_subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
