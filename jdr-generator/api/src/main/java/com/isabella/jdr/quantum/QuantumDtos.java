package com.isabella.jdr.quantum;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;

public final class QuantumDtos {
    public static final java.util.Set<String> FORBIDDEN_PARAM_KEYS = java.util.Set.of(
        "repository", "url", "code", "command", "cmd", "plugin", "credentials",
        "token", "script", "exec", "shell", "image", "docker");

    public record CreateQuantumJobRequest(
        @NotNull QuantumProvider provider,
        @Min(1) @Max(64) int wires,
        @Min(1) @Max(8192) int shots,
        @Min(0) @Max(2000) int operations,
        @Size(max = 16) Map<@Pattern(regexp = "[a-zA-Z0-9_-]{1,24}") String, String> params
    ) {
    }

    public record QuantumJobResponse(
        String id,
        String provider,
        int wires,
        int shots,
        int operations,
        String status,
        String errorMessage,
        String createdAt
    ) {
    }

    private QuantumDtos() {
    }
}
