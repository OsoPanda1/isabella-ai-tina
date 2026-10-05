package com.isabella.jdr.security;

import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public final class ScopeAuthorization {
    public static final String DELEGATED_TENANT_SCOPE = "SCOPE_tenant:delegate";

    public void requireDelegatedTenantScope(Jwt jwt) {
        var scopes = jwt.getClaimAsStringList("scope");
        if (scopes == null || scopes.stream().noneMatch(s -> s.equals("tenant:delegate"))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Delegated tenant access requires SCOPE_tenant:delegate");
        }
    }
}
