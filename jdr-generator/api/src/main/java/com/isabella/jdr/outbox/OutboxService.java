package com.isabella.jdr.outbox;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.util.List;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OutboxService {
    private final OutboxRepository repository;
    private final EventPublisher publisher;
    private final int batchSize;

    public OutboxService(OutboxRepository repository, EventPublisher publisher,
                         org.springframework.core.env.Environment env, MeterRegistry meterRegistry) {
        this.repository = repository;
        this.publisher = publisher;
        this.batchSize = Integer.parseInt(env.getProperty("jdr.outbox.batch-size", "100"));
        meterRegistry.gauge("jdr_outbox_pending_total", repository,
            r -> r.countByStatus(OutboxEntity.Status.PENDING));
    }

    @Transactional
    public void emit(String tenantId, String aggregateType, String aggregateId,
                     String eventType, String payload) {
        OutboxEntity e = new OutboxEntity();
        e.setTenantId(tenantId);
        e.setAggregateType(aggregateType);
        e.setAggregateId(aggregateId);
        e.setEventType(eventType);
        e.setPayload(payload);
        e.setStatus(OutboxEntity.Status.PENDING);
        e.setCreatedAt(Instant.now());
        repository.save(e);
    }

    @Scheduled(fixedDelayString = "${jdr.outbox.poll-millis}")
    @Transactional
    public void publishPending() {
        List<OutboxEntity> pending = repository.findByStatusOrderByCreatedAtAsc(
            OutboxEntity.Status.PENDING, org.springframework.data.domain.PageRequest.of(0, batchSize));
        for (OutboxEntity e : pending) {
            publisher.publish(e);
            e.setStatus(OutboxEntity.Status.PUBLISHED);
            e.setPublishedAt(Instant.now());
        }
        repository.saveAll(pending);
    }
}
