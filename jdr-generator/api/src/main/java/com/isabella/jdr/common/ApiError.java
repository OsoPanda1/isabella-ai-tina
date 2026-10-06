package com.isabella.jdr.common;

import java.time.Instant;

public record ApiError(
    Instant timestamp,
    String requestId,
    String errorCode,
    int status,
    String message,
    String route
) {
    public static ApiError of(String requestId, String errorCode, int status, String message, String route) {
        return new ApiError(Instant.now(), requestId, errorCode, status, message, route);
    }
}
