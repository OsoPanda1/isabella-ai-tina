package com.isabella.jdr.security;

import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public final class TenantContext {
    private static final String TENANT_PATTERN = "tenant-[a-z0-9-]{3,32}";

    public String requiredTenant(Jwt jwt) {
        String tenant = jwt.getClaimAsString("tenantId");
        if (tenant == null || !tenant.matches(TENANT_PATTERN)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Invalid tenant context");
        }
        return tenant;
    }

    public void verifySelector(Jwt jwt, String selector) {
        if (selector == null) {
            return;
        }
        if (!selector.equals(requiredTenant(jwt))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Tenant selector mismatch");
        }
    }

    public String tenantHash(String tenant) {
        if (tenant == null) {
            return "";
        }
        return Integer.toHexString(tenant.hashCode());
    }
}
