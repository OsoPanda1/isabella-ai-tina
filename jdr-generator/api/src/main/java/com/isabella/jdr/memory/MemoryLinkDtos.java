package com.isabella.jdr.memory;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class MemoryLinkDtos {
    public record CreateMemoryLinkRequest(
        @NotBlank @Size(max = 64) String sourceId,
        @NotBlank @Size(max = 64) String targetId,
        @NotBlank @Pattern(regexp = "[a-zA-Z0-9_-]{1,40}") String relation,
        @Min(0) @Max(1) double weight
    ) {
    }

    public record MemoryLinkResponse(
        String id,
        String sourceId,
        String targetId,
        String relation,
        double weight,
        String createdAt
    ) {
    }

    private MemoryLinkDtos() {
    }
}
