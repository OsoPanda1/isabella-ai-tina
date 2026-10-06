package com.isabella.jdr.quantum;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.isabella.jdr.common.ApiResponse;
import com.isabella.jdr.common.RequestContext;
import com.isabella.jdr.idempotency.IdempotencyService;
import com.isabella.jdr.security.TenantContext;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import jakarta.validation.constraints.Max;

@RestController
@RequestMapping("/api/v1/quantum/jobs")
@Validated
public class QuantumJobController {
    private final QuantumJobService service;
    private final TenantContext tenantContext;
    private final IdempotencyService idempotencyService;
    private final ObjectMapper objectMapper;

    public QuantumJobController(QuantumJobService service, TenantContext tenantContext,
                                IdempotencyService idempotencyService, ObjectMapper objectMapper) {
        this.service = service;
        this.tenantContext = tenantContext;
        this.idempotencyService = idempotencyService;
        this.objectMapper = objectMapper;
    }

    @PostMapping
    public ResponseEntity<String> create(@AuthenticationPrincipal Jwt jwt,
                                         @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                         @Valid @RequestBody QuantumDtos.CreateQuantumJobRequest request,
                                         @RequestAttribute("requestContext") RequestContext context) {
        String tenant = tenantContext.requiredTenant(jwt);
        try {
            String requestJson = objectMapper.writeValueAsString(request);
            String requestHash = idempotencyService.requestHash(requestJson);
            String body = idempotencyService.process(tenant, idempotencyKey, requestHash, () -> {
                QuantumDtos.QuantumJobResponse resp = service.create(tenant, jwt.getSubject(), request, context);
                try {
                    return objectMapper.writeValueAsString(ApiResponse.ok(resp, context));
                } catch (Exception ex) {
                    throw new IllegalStateException(ex);
                }
            });
            return ResponseEntity.status(HttpStatus.ACCEPTED).contentType(MediaType.APPLICATION_JSON).body(body);
        } catch (Exception ex) {
            throw new RuntimeException(ex);
        }
    }

    @GetMapping("/{id}")
    public ApiResponse<QuantumDtos.QuantumJobResponse> get(
        @AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        String tenant = tenantContext.requiredTenant(jwt);
        return ApiResponse.ok(service.get(tenant, id));
    }
}
