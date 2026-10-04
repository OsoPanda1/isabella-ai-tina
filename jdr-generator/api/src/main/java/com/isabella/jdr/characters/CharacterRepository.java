package com.isabella.jdr.characters;

import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface CharacterRepository extends JpaRepository<CharacterEntity, UUID> {
    java.util.Optional<CharacterEntity> findByTenantIdAndIdAndDeletedAtIsNull(String tenantId, UUID id);

    java.util.List<CharacterEntity> findByTenantIdAndDeletedAtIsNullAndIdGreaterThanOrderByCreatedAtAsc(
        String tenantId, UUID cursor, Pageable pageable);

    long countByTenantIdAndDeletedAtIsNull(String tenantId);
}
