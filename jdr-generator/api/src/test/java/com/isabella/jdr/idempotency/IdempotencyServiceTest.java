package com.isabella.jdr.idempotency;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class IdempotencyServiceTest {
    private final IdempotencyRepository repository = mock(IdempotencyRepository.class);
    private final IdempotencyService service = new IdempotencyService(repository);

    @Test
    void sameHashReturnsStoredResponseWithoutReplaying() {
        UUID key = UUID.randomUUID();
        IdempotencyEntity stored = new IdempotencyEntity();
        stored.setTenantId("t");
        stored.setIdempotencyKey(key);
        stored.setRequestHash("h");
        stored.setResponseBody("{\"x\":1}");
        stored.setCreatedAt(Instant.now());
        when(repository.findByTenantIdAndIdempotencyKey("t", key)).thenReturn(Optional.of(stored));

        String body = service.process("t", key, "h", () -> {
            throw new IllegalStateException("action must not run on replay");
        });
        assertEquals("{\"x\":1}", body);
    }

    @Test
    void differentHashOnSameKeyConflicts() {
        UUID key = UUID.randomUUID();
        IdempotencyEntity stored = new IdempotencyEntity();
        stored.setTenantId("t");
        stored.setIdempotencyKey(key);
        stored.setRequestHash("h1");
        stored.setResponseBody("b");
        stored.setCreatedAt(Instant.now());
        when(repository.findByTenantIdAndIdempotencyKey("t", key)).thenReturn(Optional.of(stored));

        assertThrows(com.isabella.jdr.common.exceptions.IdempotencyConflictException.class,
            () -> service.process("t", key, "h2", () -> "new"));
    }
}
