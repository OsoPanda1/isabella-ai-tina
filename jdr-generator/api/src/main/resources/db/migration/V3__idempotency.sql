CREATE TABLE idempotency (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  idempotency_key BINARY(16) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  response_body LONGTEXT NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  UNIQUE KEY uk_idem_tenant_key (tenant_id, idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
