package com.isabella.jdr.memory;

import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface MemoryLinkRepository extends JpaRepository<MemoryLinkEntity, UUID> {
    java.util.List<MemoryLinkEntity> findByTenantIdAndDeletedAtIsNullOrderByCreatedAtAsc(String tenantId, Pageable pageable);
}
