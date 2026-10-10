package com.isabella.jdr.characters;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.validation.annotation.Validated;

public final class CharacterDtos {

    public record CreateCharacterRequest(
        @NotBlank @Size(max = 120) String name,
        @NotBlank @Pattern(regexp = "[a-zA-Z0-9_-]{1,80}") String characterClass,
        @NotBlank @Pattern(regexp = "[a-zA-Z0-9_-]{1,80}") String race,
        @Min(1) @Max(100) int level,
        @NotNull @Size(max = 32) Map<
            @Pattern(regexp = "[a-zA-Z0-9_-]{1,40}") String,
            @Min(0) @Max(100) Integer> attributes
    ) {
    }

    public record UpdateCharacterRequest(
        @Size(max = 120) String name,
        @Pattern(regexp = "[a-zA-Z0-9_-]{1,80}") String characterClass,
        @Pattern(regexp = "[a-zA-Z0-9_-]{1,80}") String race,
        @Min(1) @Max(100) Integer level,
        @Size(max = 32) Map<
            @Pattern(regexp = "[a-zA-Z0-9_-]{1,40}") String,
            @Min(0) @Max(100) Integer> attributes
    ) {
    }

    public record CharacterResponse(
        String id,
        String tenantId,
        String ownerSubject,
        String name,
        String characterClass,
        String race,
        int level,
        Map<String, Integer> attributes,
        String createdAt,
        String updatedAt,
        long version
    ) {
    }

    private CharacterDtos() {
    }
}
