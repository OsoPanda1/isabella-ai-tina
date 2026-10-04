package com.isabella.jdr.memory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.isabella.jdr.audit.AuditService;
import com.isabella.jdr.common.PageResponse;
import com.isabella.jdr.common.RequestContext;
import com.isabella.jdr.outbox.OutboxService;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MemoryLinkService {
    private final MemoryLinkRepository repository;
    private final ObjectMapper objectMapper;
    private final AuditService audit;
    private final OutboxService outbox;

    public MemoryLinkService(MemoryLinkRepository repository, ObjectMapper objectMapper,
                             AuditService audit, OutboxService outbox, MeterRegistry meterRegistry) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.audit = audit;
        this.outbox = outbox;
    }

    @Transactional
    public MemoryLinkDtos.MemoryLinkResponse create(String tenantId, String subject,
                                                     MemoryLinkDtos.CreateMemoryLinkRequest req, RequestContext ctx) {
        long start = System.currentTimeMillis();
        MemoryLinkEntity e = new MemoryLinkEntity();
        e.setId(UUID.randomUUID());
        e.setTenantId(tenantId);
        e.setSourceId(req.sourceId());
        e.setTargetId(req.targetId());
        e.setRelation(req.relation());
        e.setWeight(req.weight());
        e.setCreatedAt(Instant.now());
        MemoryLinkEntity saved = repository.save(e);
        audit.record(tenantId, subject, "memory.link.create", ctx.route(), ctx.requestId(),
            201, System.currentTimeMillis() - start, "");
        outbox.emit(tenantId, "memory_link", saved.getId().toString(), "MemoryLinkCreated",
            writeJson(saved));
        return toResponse(saved);
    }

    @Transactional(readOnly = true)
    public PageResponse<MemoryLinkDtos.MemoryLinkResponse> list(String tenantId, int limit) {
        int size = Math.min(limit, 100);
        List<MemoryLinkEntity> rows = repository.findByTenantIdAndDeletedAtIsNullOrderByCreatedAtAsc(
            tenantId, PageRequest.of(0, size));
        List<MemoryLinkDtos.MemoryLinkResponse> data = rows.stream().map(this::toResponse).toList();
        return new PageResponse<>(data, null, size);
    }

    private MemoryLinkDtos.MemoryLinkResponse toResponse(MemoryLinkEntity e) {
        return new MemoryLinkDtos.MemoryLinkResponse(e.getId().toString(), e.getSourceId(),
            e.getTargetId(), e.getRelation(), e.getWeight(), e.getCreatedAt().toString());
    }

    private String writeJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
