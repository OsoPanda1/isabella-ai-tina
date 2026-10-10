package com.isabella.jdr.outbox;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface OutboxRepository extends JpaRepository<OutboxEntity, Long> {
    java.util.List<OutboxEntity> findByStatusOrderByCreatedAtAsc(
        OutboxEntity.Status status, org.springframework.data.domain.Pageable pageable);

    long countByStatus(OutboxEntity.Status status);
}
