CREATE TABLE quantum_jobs (
  id BINARY(16) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  subject VARCHAR(255),
  provider VARCHAR(24),
  wires INT NOT NULL,
  shots INT NOT NULL,
  operations INT NOT NULL,
  status VARCHAR(12) NOT NULL,
  error_message VARCHAR(255),
  result_json JSON,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  INDEX idx_q_tenant (tenant_id),
  INDEX idx_q_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
