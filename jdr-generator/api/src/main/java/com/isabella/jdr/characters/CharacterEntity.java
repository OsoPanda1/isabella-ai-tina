package com.isabella.jdr.characters;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.Id;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "characters", indexes = {
    @Index(name = "idx_char_tenant_active", columnList = "tenant_id, deleted_at"),
    @Index(name = "idx_char_owner", columnList = "tenant_id, owner_subject")
})
public class CharacterEntity {
    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false, length = 64)
    private String tenantId;

    @Column(name = "owner_subject", nullable = false, length = 255)
    private String ownerSubject;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(name = "character_class", nullable = false, length = 80)
    private String characterClass;

    @Column(nullable = false, length = 80)
    private String race;

    @Column(nullable = false)
    private int level;

    @Version
    private long version;

    @Column(name = "attributes_json", nullable = false, columnDefinition = "json")
    private String attributesJson;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public String getTenantId() { return tenantId; }
    public void setTenantId(String tenantId) { this.tenantId = tenantId; }
    public String getOwnerSubject() { return ownerSubject; }
    public void setOwnerSubject(String ownerSubject) { this.ownerSubject = ownerSubject; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getCharacterClass() { return characterClass; }
    public void setCharacterClass(String characterClass) { this.characterClass = characterClass; }
    public String getRace() { return race; }
    public void setRace(String race) { this.race = race; }
    public int getLevel() { return level; }
    public void setLevel(int level) { this.level = level; }
    public long getVersion() { return version; }
    public void setVersion(long version) { this.version = version; }
    public String getAttributesJson() { return attributesJson; }
    public void setAttributesJson(String attributesJson) { this.attributesJson = attributesJson; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
    public Instant getDeletedAt() { return deletedAt; }
    public void setDeletedAt(Instant deletedAt) { this.deletedAt = deletedAt; }
}
