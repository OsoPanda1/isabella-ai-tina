package com.isabella.jdr.quantum;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.isabella.jdr.audit.AuditService;
import com.isabella.jdr.common.RequestContext;
import com.isabella.jdr.outbox.OutboxService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class QuantumJobService {
    private final QuantumJobRepository repository;
    private final ObjectMapper objectMapper;
    private final AuditService audit;
    private final OutboxService outbox;
    private final QuantumConfig config;

    public QuantumJobService(QuantumJobRepository repository, ObjectMapper objectMapper,
                             AuditService audit, OutboxService outbox, QuantumConfig config) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.audit = audit;
        this.outbox = outbox;
        this.config = config;
    }

    @Transactional
    public QuantumDtos.QuantumJobResponse create(String tenantId, String subject,
                                                 QuantumDtos.CreateQuantumJobRequest req, RequestContext ctx) {
        long start = System.currentTimeMillis();
        if (req.wires() > config.maxWires() || req.shots() > config.maxShots()
                || req.operations() > config.maxOperations()) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Job excede cuota permitida");
        }
        if (req.params() != null) {
            for (String key : req.params().keySet()) {
                if (QuantumDtos.FORBIDDEN_PARAM_KEYS.contains(key.toLowerCase())) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Parámetro no permitido: " + key);
                }
            }
        }
        QuantumJobEntity e = new QuantumJobEntity();
        e.setId(UUID.randomUUID());
        e.setTenantId(tenantId);
        e.setSubject(subject);
        e.setProvider(req.provider().name());
        e.setWires(req.wires());
        e.setShots(req.shots());
        e.setOperations(req.operations());
        e.setStatus(QuantumJobEntity.Status.QUEUED);
        Instant now = Instant.now();
        e.setCreatedAt(now);
        e.setUpdatedAt(now);
        QuantumJobEntity saved = repository.save(e);
        audit.record(tenantId, subject, "quantum.job.submit", ctx.route(), ctx.requestId(),
            202, System.currentTimeMillis() - start, "");
        outbox.emit(tenantId, "quantum_job", saved.getId().toString(), "QuantumJobSubmitted",
            writeJson(saved));
        return toResponse(saved);
    }

    @Transactional(readOnly = true)
    public QuantumDtos.QuantumJobResponse get(String tenantId, UUID id) {
        QuantumJobEntity e = repository.findByTenantIdAndId(tenantId, id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Quantum job not found"));
        return toResponse(e);
    }

    @Transactional(readOnly = true)
    public List<QuantumDtos.QuantumJobResponse> list(String tenantId, int limit) {
        int size = Math.min(limit, 100);
        return repository.findByTenantIdOrderByCreatedAtDesc(tenantId, PageRequest.of(0, size))
            .stream().map(this::toResponse).toList();
    }

    private QuantumDtos.QuantumJobResponse toResponse(QuantumJobEntity e) {
        return new QuantumDtos.QuantumJobResponse(e.getId().toString(), e.getProvider(), e.getWires(),
            e.getShots(), e.getOperations(), e.getStatus().name(), e.getErrorMessage(),
            e.getCreatedAt().toString());
    }

    private String writeJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
