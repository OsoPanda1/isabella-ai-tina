CREATE TABLE audit_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  subject VARCHAR(255),
  action VARCHAR(80) NOT NULL,
  route VARCHAR(160),
  request_id VARCHAR(64),
  status INT NOT NULL,
  latency_ms BIGINT NOT NULL,
  payload_hash VARCHAR(64),
  created_at TIMESTAMP(6) NOT NULL,
  INDEX idx_audit_tenant (tenant_id),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
