import { describe, expect, it, afterEach } from "vitest";

import {
  createPostgresDecisionLedger,
  decisionRepository,
  type DecisionQuery,
} from "@/lib/repositories/decision-repository";
import { resetConfigCache } from "@/lib/config";
import { evaluateProductionAuthorities } from "@/lib/production-authority";
import { getInputLimits } from "@/lib/input-limits";

describe("production hardening contracts", () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.ISABELLA_RUNTIME_MODE;
    delete process.env.DATABASE_URL;
    delete process.env.AUTH_JWT_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.AEGIS_AUDIT_SECRET;
    delete process.env.BOOKPI_SIGNING_KEY;
    delete process.env.CROWN_POLICY_SIGNING_KEY;
    delete process.env.BOOKPI_SIGNATURE_ALGORITHM;
    delete process.env.ENCRYPTION_MASTER_KEY;
    resetConfigCache();
  });

  it("keeps the legacy in-memory decision repository available", async () => {
    const record = await decisionRepository.append({
      decisionId: "legacy-1",
      tenantId: "tenant-a",
      subjectId: "user-a",
      action: "read",
      resource: "chat",
      allow: true,
      policyVersion: "test",
      timestamp: new Date().toISOString(),
    });

    expect(record.record_hash).toHaveLength(128);
    await expect(decisionRepository.getLatestHash("tenant-a")).resolves.toBe(record.record_hash);
    await expect(decisionRepository.verifyChain("tenant-a")).resolves.toEqual({
      valid: true,
      count: 1,
    });
  });

  it("exposes the durable decision ledger and enforces chain continuity", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const query: DecisionQuery = async (sql, values = []) => {
      if (sql.includes("SELECT record_hash")) {
        const tenant = String(values[0]);
        const last = [...rows]
          .filter((row) => String(row.tenant_id) === tenant)
          .at(-1);
        return { rows: last ? [{ record_hash: last.record_hash }] : [] };
      }
      if (sql.includes("SELECT 1 FROM public.isabella_decisions")) {
        const tenant = String(values[0]);
        const hash = String(values[1]);
        return {
          rows: rows.some(
            (row) => String(row.tenant_id) === tenant && String(row.record_hash) === hash,
          )
            ? [{ "?column?": 1 }]
            : [],
        };
      }
      if (sql.includes("INSERT INTO public.isabella_decisions")) {
        rows.push({
          id: values[0],
          tenant_id: values[1],
          actor_id: values[2],
          authority: values[3],
          capability: values[4],
          policy: values[5],
          risk: values[6],
          model_id: values[7],
          input_hash: values[8],
          output_hash: values[9],
          result: values[10],
          previous_hash: values[11],
          record_hash: values[12],
          evidence_ids: values[13],
          recorded_at: values[14],
          created_at: values[14],
        });
        return { rows: [{ id: values[0] }] };
      }
      return { rows: [] };
    };

    const ledger = createPostgresDecisionLedger({ query });
    const first = {
      id: "decision-1",
      tenantId: "tenant-a",
      actorId: "actor-a",
      authority: "CROWN",
      capability: "inference",
      policy: "policy-v1",
      risk: "LOW" as const,
      inputHash: "in-1",
      outputHash: "out-1",
      result: "ALLOW" as const,
      timestamp: new Date().toISOString(),
      previousHash: "GENESIS",
      recordHash: "a".repeat(128),
      evidenceIds: [],
    };

    await ledger.append(first);
    await expect(ledger.latestHash("tenant-a")).resolves.toBe(first.recordHash);

    await expect(
      ledger.append({ ...first, id: "decision-2", recordHash: "b".repeat(128) }),
    ).rejects.toThrow(/DECISION_CHAIN_MISMATCH/);
  });

  it("keeps the default request body ceiling compatible with multimodal attachments", () => {
    expect(getInputLimits().maxBodyBytes).toBe(12 * 1024 * 1024);
  });

  it("does not claim production readiness when critical authorities are absent", () => {
    process.env.NODE_ENV = "production";
    process.env.ISABELLA_RUNTIME_MODE = "production";
    resetConfigCache();

    expect(() => evaluateProductionAuthorities()).toThrow();
  });
});
