package com.isabella.jdr.rules;

import com.isabella.jdr.common.ApiResponse;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/rules")
public class RulesController {
    private static final List<RuleResponse> RULES = List.of(
        new RuleResponse("R-001", "tenant-isolation", "El tenant siempre se deriva del token verificado; nunca del cliente", true),
        new RuleResponse("R-002", "deny-by-default", "Toda ruta no autorizada explícitamente es denegada", true),
        new RuleResponse("R-003", "idempotency", "Las mutaciones requieren Idempotency-Key y son idempotentes", true),
        new RuleResponse("R-004", "optimistic-lock", "Las escrituras concurrenrentes usan @Version y fallan con 409", true),
        new RuleResponse("R-005", "no-arbitrary-code", "Los jobs cuánticos rechazan repositorio/url/código/comando arbitrario", true),
        new RuleResponse("R-006", "audit-durable", "Toda mutación registra un evento de auditoría durable", true)
    );

    @GetMapping
    public ApiResponse<List<RuleResponse>> list(@AuthenticationPrincipal Jwt jwt) {
        return ApiResponse.ok(RULES);
    }

    public record RuleResponse(String id, String code, String description, boolean enabled) {
    }
}
