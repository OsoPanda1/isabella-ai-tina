package com.isabella.jdr.idempotency;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface IdempotencyRepository extends JpaRepository<IdempotencyEntity, Long> {
    java.util.Optional<IdempotencyEntity> findByTenantIdAndIdempotencyKey(String tenantId, UUID idempotencyKey);
}
