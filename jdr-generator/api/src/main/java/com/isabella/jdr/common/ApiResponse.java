package com.isabella.jdr.common;

import java.time.Instant;

public record ApiResponse<T>(String requestId, String status, T data, Instant timestamp) {
    public static <T> ApiResponse<T> ok(T data) {
        RequestContext ctx = RequestContext.current();
        return new ApiResponse<>(ctx == null ? "" : ctx.requestId(), "ok", data, Instant.now());
    }

    public static <T> ApiResponse<T> ok(T data, RequestContext ctx) {
        return new ApiResponse<>(ctx.requestId(), "ok", data, Instant.now());
    }
}
