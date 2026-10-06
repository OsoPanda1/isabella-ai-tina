package com.isabella.jdr.quantum;

import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface QuantumJobRepository extends JpaRepository<QuantumJobEntity, UUID> {
    java.util.Optional<QuantumJobEntity> findByTenantIdAndId(String tenantId, UUID id);

    java.util.List<QuantumJobEntity> findByTenantIdOrderByCreatedAtDesc(String tenantId, Pageable pageable);
}
