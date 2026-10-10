package com.isabella.jdr.idempotency;

import com.isabella.jdr.common.exceptions.IdempotencyConflictException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdempotencyService {
    private final IdempotencyRepository repository;

    public IdempotencyService(IdempotencyRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public String process(String tenantId, UUID key, String requestHash, Supplier<String> action) {
        Optional<IdempotencyEntity> existing = repository.findByTenantIdAndIdempotencyKey(tenantId, key);
        if (existing.isPresent()) {
            IdempotencyEntity e = existing.get();
            if (!e.getRequestHash().equals(requestHash)) {
                throw new IdempotencyConflictException(
                    "Idempotency key reused with a different payload");
            }
            return e.getResponseBody();
        }
        String body = action.get();
        IdempotencyEntity e = new IdempotencyEntity();
        e.setTenantId(tenantId);
        e.setIdempotencyKey(key);
        e.setRequestHash(requestHash);
        e.setResponseBody(body);
        e.setCreatedAt(Instant.now());
        repository.save(e);
        return body;
    }

    public String requestHash(String payload) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(payload.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (Exception ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }
}
