package com.isabella.jdr.common;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.http.HttpServletRequest;
import java.util.HashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import com.isabella.jdr.common.exceptions.IdempotencyConflictException;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private final MeterRegistry meterRegistry;

    public GlobalExceptionHandler(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiError> handleAuth(AuthenticationException ex, HttpServletRequest req) {
        return error(HttpStatus.UNAUTHORIZED, "auth_failed", "Authentication failed", req);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> handleDenied(AccessDeniedException ex, HttpServletRequest req) {
        meterRegistry.counter("jdr_authorization_denied_total").increment();
        return error(HttpStatus.FORBIDDEN, "forbidden", "Insufficient scope or tenant mismatch", req);
    }

    @ExceptionHandler(IdempotencyConflictException.class)
    public ResponseEntity<ApiError> handleIdempotency(IdempotencyConflictException ex, HttpServletRequest req) {
        return error(HttpStatus.CONFLICT, "idempotency_conflict", ex.getMessage(), req);
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ApiError> handleOptimistic(OptimisticLockingFailureException ex, HttpServletRequest req) {
        return error(HttpStatus.CONFLICT, "conflict_version", "Resource was modified concurrently", req);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleIntegrity(DataIntegrityViolationException ex, HttpServletRequest req) {
        return error(HttpStatus.CONFLICT, "conflict_integrity", "Conflict with existing resource", req);
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HandlerMethodValidationException.class})
    public ResponseEntity<ApiError> handleValidation(HttpServletRequest req) {
        return error(HttpStatus.BAD_REQUEST, "validation_failed", "Request validation failed", req);
    }

    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<ApiError> handleNotReadable(HttpServletRequest req) {
        return error(HttpStatus.BAD_REQUEST, "malformed_body", "Request body rejected (unknown field or invalid JSON)", req);
    }

    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    public ResponseEntity<ApiError> handleStatus(org.springframework.web.server.ResponseStatusException ex, HttpServletRequest req) {
        HttpStatus status = HttpStatus.valueOf(ex.getStatusCode().value());
        if (status == HttpStatus.FORBIDDEN) {
            meterRegistry.counter("jdr_authorization_denied_total").increment();
        }
        return error(status, "request_rejected", ex.getReason() == null ? status.getReasonPhrase() : ex.getReason(), req);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleOther(Exception ex, HttpServletRequest req) {
        log.error("Unhandled error route={} requestId={}", req.getRequestURI(),
            RequestContext.current() == null ? "" : RequestContext.current().requestId(), ex);
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "Internal error", req);
    }

    private ResponseEntity<ApiError> error(HttpStatus status, String code, String message, HttpServletRequest req) {
        RequestContext ctx = RequestContext.current();
        String requestId = ctx == null ? "" : ctx.requestId();
        ApiError body = ApiError.of(requestId, code, status.value(), message, req.getRequestURI());
        Map<String, Object> labels = new HashMap<>();
        labels.put("route", req.getRequestURI());
        labels.put("status", String.valueOf(status.value()));
        return ResponseEntity.status(status).body(body);
    }
}
