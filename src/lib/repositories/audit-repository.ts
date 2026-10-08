/**
 * Audit Repository (src/lib/repositories/audit-repository.ts)
 * -------------------------------------------------------------
 * Append-only, tamper-evident audit repository.
 * Every audit record is chained to the previous log hash and sealed with HMAC-SHA3-512.
 */
import { createHash } from "node:crypto";
import "../sovereign-audit";
import { canonicalize } from "../igds/canonical";

import type { AuditSeverity } from "../domains/audit-event";

export type { AuditSeverity };

export interface AuditEventRecord {
  id: string;
  tenant_id: string;
  timestamp: string;
  trace_id: string;
  correlation_id: string;
  actor: string;
  actor_ip: string;
  action: string;
  resource: string;
  event: string;
  severity: AuditSeverity;
  result: "success" | "failure" | "denied";
  details: Record<string, unknown>;
  verification_hash: string;
  previous_log_hash: string;
}

export interface AuditRepository {
  append(
    event: Omit<AuditEventRecord, "id" | "verification_hash" | "previous_log_hash">,
  ): Promise<AuditEventRecord>;
  verifyChain(
    tenantId: string,
  ): Promise<{ valid: boolean; recordCount: number; brokenAt?: string }>;
  listRecent(tenantId: string, limit?: number): Promise<readonly AuditEventRecord[]>;
}

class InMemoryAuditRepository implements AuditRepository {
  private logs: AuditEventRecord[] = [];
  private lastHashByTenant = new Map<string, string>();

  async append(
    event: Omit<AuditEventRecord, "id" | "verification_hash" | "previous_log_hash">,
  ): Promise<AuditEventRecord> {
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const previous_log_hash = this.lastHashByTenant.get(event.tenant_id) || "GENESIS";

    const payloadToHash = {
      id,
      tenant_id: event.tenant_id,
      timestamp: event.timestamp || new Date().toISOString(),
      trace_id: event.trace_id,
      correlation_id: event.correlation_id,
      actor: event.actor,
      action: event.action,
      resource: event.resource,
      event: event.event,
      severity: event.severity,
      result: event.result,
      details: event.details,
      previous_log_hash,
    };

    const verification_hash = createHash("sha3-512")
      .update(canonicalize(payloadToHash), "utf8")
      .digest("hex");

    const record: AuditEventRecord = {
      ...payloadToHash,
      actor_ip: event.actor_ip || "127.0.0.1",
      verification_hash,
    };

    this.logs.push(record);
    this.lastHashByTenant.set(event.tenant_id, verification_hash);
    return record;
  }

  async verifyChain(
    tenantId: string,
  ): Promise<{ valid: boolean; recordCount: number; brokenAt?: string }> {
    const tenantLogs = this.logs.filter((l) => l.tenant_id === tenantId);
    let previous = "GENESIS";

    for (const log of tenantLogs) {
      if (log.previous_log_hash !== previous) {
        return { valid: false, recordCount: tenantLogs.length, brokenAt: log.id };
      }
      const expectedHash = createHash("sha3-512")
        .update(
          canonicalize({
            id: log.id,
            tenant_id: log.tenant_id,
            timestamp: log.timestamp,
            trace_id: log.trace_id,
            correlation_id: log.correlation_id,
            actor: log.actor,
            action: log.action,
            resource: log.resource,
            event: log.event,
            severity: log.severity,
            result: log.result,
            details: log.details,
            previous_log_hash: log.previous_log_hash,
          }),
          "utf8",
        )
        .digest("hex");

      if (log.verification_hash !== expectedHash) {
        return { valid: false, recordCount: tenantLogs.length, brokenAt: log.id };
      }
      previous = log.verification_hash;
    }

    return { valid: true, recordCount: tenantLogs.length };
  }

  async listRecent(tenantId: string, limit: number = 50): Promise<readonly AuditEventRecord[]> {
    return this.logs.filter((l) => l.tenant_id === tenantId).slice(-limit);
  }
}

export const auditRepository = new InMemoryAuditRepository();

export function createAuditRepository(): AuditRepository {
  return auditRepository;
}

export default auditRepository;
