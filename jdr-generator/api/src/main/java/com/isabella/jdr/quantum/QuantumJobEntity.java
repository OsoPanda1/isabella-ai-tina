package com.isabella.jdr.quantum;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "quantum_jobs", indexes = {
    @Index(name = "idx_q_tenant", columnList = "tenant_id"),
    @Index(name = "idx_q_status", columnList = "status")
})
public class QuantumJobEntity {
    public enum Status { QUEUED, RUNNING, DONE, FAILED, REJECTED }

    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false, length = 64)
    private String tenantId;

    @Column(name = "subject", length = 255)
    private String subject;

    @Column(length = 24)
    private String provider;

    @Column
    private int wires;

    @Column
    private int shots;

    @Column
    private int operations;

    @Enumerated(EnumType.STRING)
    @Column(length = 12)
    private Status status;

    @Column(name = "error_message", length = 255)
    private String errorMessage;

    @Column(name = "result_json", columnDefinition = "json")
    private String resultJson;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public String getTenantId() { return tenantId; }
    public void setTenantId(String tenantId) { this.tenantId = tenantId; }
    public String getSubject() { return subject; }
    public void setSubject(String subject) { this.subject = subject; }
    public String getProvider() { return provider; }
    public void setProvider(String provider) { this.provider = provider; }
    public int getWires() { return wires; }
    public void setWires(int wires) { this.wires = wires; }
    public int getShots() { return shots; }
    public void setShots(int shots) { this.shots = shots; }
    public int getOperations() { return operations; }
    public void setOperations(int operations) { this.operations = operations; }
    public Status getStatus() { return status; }
    public void setStatus(Status status) { this.status = status; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public String getResultJson() { return resultJson; }
    public void setResultJson(String resultJson) { this.resultJson = resultJson; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
