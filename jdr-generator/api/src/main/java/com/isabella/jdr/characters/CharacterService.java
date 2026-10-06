package com.isabella.jdr.characters;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.isabella.jdr.audit.AuditService;
import com.isabella.jdr.characters.CharacterDtos.CharacterResponse;
import com.isabella.jdr.characters.CharacterDtos.CreateCharacterRequest;
import com.isabella.jdr.characters.CharacterDtos.UpdateCharacterRequest;
import com.isabella.jdr.common.PageResponse;
import com.isabella.jdr.common.RequestContext;
import com.isabella.jdr.outbox.OutboxService;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CharacterService {
    private final CharacterRepository repository;
    private final ObjectMapper objectMapper;
    private final AuditService audit;
    private final OutboxService outbox;
    private final MeterRegistry meterRegistry;
    private final Timer createTimer;

    public CharacterService(CharacterRepository repository, ObjectMapper objectMapper,
                            AuditService audit, OutboxService outbox, MeterRegistry meterRegistry) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.audit = audit;
        this.outbox = outbox;
        this.meterRegistry = meterRegistry;
        this.createTimer = meterRegistry.timer("jdr_character_create_seconds");
    }

    @Transactional
    public CharacterResponse create(String tenantId, String subject, CreateCharacterRequest req, RequestContext ctx) {
        long start = System.currentTimeMillis();
        CharacterEntity e = new CharacterEntity();
        e.setId(UUID.randomUUID());
        e.setTenantId(tenantId);
        e.setOwnerSubject(subject);
        e.setName(req.name());
        e.setCharacterClass(req.characterClass());
        e.setRace(req.race());
        e.setLevel(req.level());
        e.setAttributesJson(writeJson(req.attributes()));
        Instant now = Instant.now();
        e.setCreatedAt(now);
        e.setUpdatedAt(now);
        CharacterEntity saved = repository.save(e);
        audit.record(tenantId, subject, "character.create", ctx.route(), ctx.requestId(),
            201, System.currentTimeMillis() - start, hashHex(req));
        outbox.emit(tenantId, "character", saved.getId().toString(), "CharacterCreated", writeJson(saved));
        meterRegistry.counter("jdr_character_create_total").increment();
        createTimer.record(System.currentTimeMillis() - start, java.util.concurrent.TimeUnit.MILLISECONDS);
        return toResponse(saved);
    }

    @Transactional(readOnly = true)
    public CharacterResponse get(String tenantId, UUID id) {
        CharacterEntity e = repository.findByTenantIdAndIdAndDeletedAtIsNull(tenantId, id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Character not found"));
        return toResponse(e);
    }

    @Transactional(readOnly = true)
    public PageResponse<CharacterResponse> list(String tenantId, int limit, String cursor) {
        int size = Math.min(limit, 100);
        UUID startCursor = (cursor == null || cursor.isBlank()) ? new UUID(0, 0) : UUID.fromString(cursor);
        List<CharacterEntity> rows = repository.findByTenantIdAndDeletedAtIsNullAndIdGreaterThanOrderByCreatedAtAsc(
            tenantId, startCursor, PageRequest.of(0, size));
        List<CharacterResponse> data = rows.stream().map(this::toResponse).toList();
        String next = data.size() < size ? null : data.get(data.size() - 1).id();
        return new PageResponse<>(data, next, size);
    }

    @Transactional
    public CharacterResponse update(String tenantId, String subject, UUID id, UpdateCharacterRequest req, RequestContext ctx) {
        long start = System.currentTimeMillis();
        CharacterEntity e = repository.findByTenantIdAndIdAndDeletedAtIsNull(tenantId, id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Character not found"));
        if (!e.getOwnerSubject().equals(subject)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the owner can modify this resource");
        }
        if (req.name() != null) e.setName(req.name());
        if (req.characterClass() != null) e.setCharacterClass(req.characterClass());
        if (req.race() != null) e.setRace(req.race());
        if (req.level() != null) e.setLevel(req.level());
        if (req.attributes() != null) e.setAttributesJson(writeJson(req.attributes()));
        e.setUpdatedAt(Instant.now());
        CharacterEntity saved = repository.save(e);
        audit.record(tenantId, subject, "character.update", ctx.route(), ctx.requestId(),
            200, System.currentTimeMillis() - start, hashHex(req));
        outbox.emit(tenantId, "character", saved.getId().toString(), "CharacterUpdated", writeJson(saved));
        return toResponse(saved);
    }

    @Transactional
    public void delete(String tenantId, String subject, UUID id, RequestContext ctx) {
        long start = System.currentTimeMillis();
        CharacterEntity e = repository.findByTenantIdAndIdAndDeletedAtIsNull(tenantId, id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Character not found"));
        if (!e.getOwnerSubject().equals(subject)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the owner can delete this resource");
        }
        e.setDeletedAt(Instant.now());
        e.setUpdatedAt(Instant.now());
        repository.save(e);
        audit.record(tenantId, subject, "character.delete", ctx.route(), ctx.requestId(),
            200, System.currentTimeMillis() - start, "");
        outbox.emit(tenantId, "character", e.getId().toString(), "CharacterDeleted",
            "{\"id\":\"" + e.getId() + "\"}");
    }

    private CharacterResponse toResponse(CharacterEntity e) {
        return new CharacterResponse(e.getId().toString(), e.getTenantId(), e.getOwnerSubject(),
            e.getName(), e.getCharacterClass(), e.getRace(), e.getLevel(),
            readMap(e.getAttributesJson()), e.getCreatedAt().toString(),
            e.getUpdatedAt().toString(), e.getVersion());
    }

    private String writeJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private Map<String, Integer> readMap(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Integer>>() {});
        } catch (Exception ex) {
            return Map.of();
        }
    }

    private String hashHex(Object o) {
        try {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(d.digest(writeJson(o).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            return "";
        }
    }

}
