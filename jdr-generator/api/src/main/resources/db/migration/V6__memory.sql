CREATE TABLE memory_links (
  id BINARY(16) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  relation VARCHAR(40) NOT NULL,
  weight DOUBLE NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  deleted_at TIMESTAMP(6) NULL,
  INDEX idx_mem_tenant (tenant_id),
  INDEX idx_mem_source (tenant_id, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
