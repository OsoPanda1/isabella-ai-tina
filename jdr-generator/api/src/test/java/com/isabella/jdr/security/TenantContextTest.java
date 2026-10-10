package com.isabella.jdr.security;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TenantContextTest {
    private final TenantContext ctx = new TenantContext();

    private Jwt jwt(String tenantId) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", "subject");
        if (tenantId != null) {
            claims.put("tenantId", tenantId);
        }
        return new Jwt("tok", Instant.now(), Instant.now().plusSeconds(60),
            Map.of("alg", "none"), claims);
    }

    @Test
    void validTenantIsAccepted() {
        assertEquals("tenant-abc", ctx.requiredTenant(jwt("tenant-abc")));
    }

    @Test
    void invalidTenantIsRejected() {
        assertThrows(ResponseStatusException.class, () -> ctx.requiredTenant(jwt("EVIL")));
        assertThrows(ResponseStatusException.class, () -> ctx.requiredTenant(jwt(null)));
    }

    @Test
    void selectorMismatchIsRejected() {
        assertThrows(ResponseStatusException.class, () -> ctx.verifySelector(jwt("tenant-abc"), "tenant-xyz"));
    }
}
