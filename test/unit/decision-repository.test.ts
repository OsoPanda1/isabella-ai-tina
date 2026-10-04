import { afterAll, describe, expect, it, vi } from "vitest";
import {
  createPostgresDecisionLedger,
  type DecisionQuery,
} from "@/lib/repositories/decision-repository";
import {
  MemoryLedger,
  recordDecision,
  type DecisionRecord,
} from "@/lib/governance/decision-ledger";

/**
 * LEDGER DE DECISIONES (test/unit/decision-repository.test.ts)
 * -----------------------------------------------------------------
 * Integración de nodo-cero-isabella ("decisiones en tabla"):
 *  - fail-closed sin DATABASE_URL,
 *  - cadena verificada antes de insertar (previousHash != último → error),
 *  - reenvío idempotente (UNIQUE tenant+record_hash),
 *  - verifyChain detecta manipulación,
 *  - wiring: sin persistencia no hay ejecución (stage "audit").
 */

afterAll(async () => {
  const { closeDecisionPool } = await import("@/lib/repositories/decision-repository");
  await closeDecisionPool();
  vi.unstubAllEnvs();
  const { resetConfigCache } = await import("@/lib/config");
  resetConfigCache();
});

function makeFakeDb() {
  const rows: Array<Record<string, unknown>> = [];
  const query: DecisionQuery = async (text, values = []) => {
    if (text.includes("SELECT 1 FROM public.isabella_decisions")) {
      const [tenantId, recordHash] = [String(values[0]), String(values[1])];
      const found = rows.some(
        (row) => row.tenant_id === tenantId && row.record_hash === recordHash,
      );
      return { rows: found ? [{ "?column?": 1 }] : [] };
    }
    if (text.includes("SELECT record_hash")) {
      const tenantId = String(values[0]);
      const found = rows
        .filter((row) => row.tenant_id === tenantId)
        .sort(
          (a, b) =>
            String(a.created_at).localeCompare(String(b.created_at)) ||
            String(a.id).localeCompare(String(b.id)),
        )
        .pop();
      return { rows: found ? [{ record_hash: found.record_hash }] : [] };
    }
    if (text.includes("INSERT INTO public.isabella_decisions")) {
      const tenantId = String(values[1]);
      const recordHash = String(values[12]);
      const duplicate = rows.some(
        (row) => row.tenant_id === tenantId && row.record_hash === recordHash,
      );
      if (duplicate) return { rows: [] };
      rows.push({
        id: values[0],
        tenant_id: tenantId,
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
        record_hash: recordHash,
        evidence_ids: values[13],
        recorded_at: values[14],
        created_at: values[14],
      });
      return { rows: [{ id: values[0] }] };
    }
    if (text.includes("ORDER BY created_at ASC, id ASC")) {
      const tenantId = String(values[0]);
      const limit = Number(values[1]);
      const ordered = rows
        .filter((row) => row.tenant_id === tenantId)
        .sort(
          (a, b) =>
            String(a.created_at).localeCompare(String(b.created_at)) ||
            String(a.id).localeCompare(String(b.id)),
        )
        .slice(-limit);
      return { rows: ordered };
    }
    throw new Error(`SQL no soportado en el fake: ${text.slice(0, 60)}`);
  };
  return { query, rows };
}

const baseRecord = (
  overrides: Partial<DecisionRecord> & Pick<DecisionRecord, "id" | "previousHash" | "recordHash">,
): DecisionRecord => ({
  tenantId: "tnt_ledger",
  actorId: "usr_1",
  authority: "execution-authority",
  capability: "memory.retrieve",
  policy: "argus:allowed|db:not_configured:allowed",
  risk: "MEDIUM",
  inputHash: "in_hash",
  outputHash: "out_hash",
  result: "ALLOW",
  timestamp: new Date().toISOString(),
  evidenceIds: ["trace_1"],
  ...overrides,
});

describe("createPostgresDecisionLedger (fail-closed)", () => {
  it("sin DATABASE_URL lanza en latestHash (no inventa cadena local)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("ISABELLA_RUNTIME_MODE", "development");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const ledger = createPostgresDecisionLedger();
    await expect(ledger.latestHash("tnt_x")).rejects.toThrow(/DATABASE_URL/);
  });

  it("sin DATABASE_URL lanza en append (no degrada a memoria)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const ledger = createPostgresDecisionLedger();
    await expect(
      ledger.append(baseRecord({ id: "dec_1", previousHash: "GENESIS", recordHash: "x" })),
    ).rejects.toThrow(/DATABASE_URL/);
  });
});

describe("cadena de decisiones (inyección de query)", () => {
  it("append con previousHash correcto inserta el registro", async () => {
    const db = makeFakeDb();
    const ledger = createPostgresDecisionLedger({ query: db.query });
    const record = await recordDecision(ledger, {
      id: "dec_ok",
      tenantId: "tnt_ok",
      actorId: "usr_1",
      authority: "execution-authority",
      capability: "memory.retrieve",
      policy: "argus:allowed",
      risk: "MEDIUM",
      inputHash: "h_in",
      outputHash: "h_out",
      result: "ALLOW",
      timestamp: new Date().toISOString(),
      evidenceIds: ["trace_ok"],
    });
    expect(record.previousHash).toBe("GENESIS");
    expect(db.rows).toHaveLength(1);
    expect(await ledger.latestHash("tnt_ok")).toBe(record.recordHash);
  });

  it("append con cadena rota lanza DECISION_CHAIN_MISMATCH", async () => {
    const db = makeFakeDb();
    const ledger = createPostgresDecisionLedger({ query: db.query });
    await recordDecision(ledger, {
      id: "dec_a",
      tenantId: "tnt_chain",
      actorId: "usr_1",
      authority: "execution-authority",
      capability: "memory.retrieve",
      policy: "argus:allowed",
      risk: "MEDIUM",
      inputHash: "h_in",
      outputHash: "h_out",
      result: "ALLOW",
      timestamp: new Date().toISOString(),
      evidenceIds: [],
    });
    await expect(
      ledger.append(
        baseRecord({
          id: "dec_b",
          tenantId: "tnt_chain",
          previousHash: "OTRA_HASH",
          recordHash: "x",
        }),
      ),
    ).rejects.toThrow(/DECISION_CHAIN_MISMATCH/);
  });

  it("reenvío del mismo registro es idempotente (no lanza)", async () => {
    const db = makeFakeDb();
    const ledger = createPostgresDecisionLedger({ query: db.query });
    const record = await recordDecision(ledger, {
      id: "dec_dup",
      tenantId: "tnt_dup",
      actorId: "usr_1",
      authority: "execution-authority",
      capability: "memory.retrieve",
      policy: "argus:allowed",
      risk: "MEDIUM",
      inputHash: "h_in",
      outputHash: "h_out",
      result: "ALLOW",
      timestamp: new Date().toISOString(),
      evidenceIds: [],
    });
    await ledger.append(record);
    expect(db.rows).toHaveLength(1);
  });

  it("verifyChain devuelve ok en cadena sana y !ok si se manipula un hash", async () => {
    const db = makeFakeDb();
    const ledger = createPostgresDecisionLedger({ query: db.query });
    await recordDecision(ledger, {
      id: "dec_v1",
      tenantId: "tnt_v",
      actorId: "usr_1",
      authority: "execution-authority",
      capability: "memory.retrieve",
      policy: "argus:allowed",
      risk: "MEDIUM",
      inputHash: "h1",
      outputHash: "h2",
      result: "ALLOW",
      timestamp: new Date().toISOString(),
      evidenceIds: [],
    });
    await recordDecision(ledger, {
      id: "dec_v2",
      tenantId: "tnt_v",
      actorId: "usr_1",
      authority: "execution-authority",
      capability: "memory.retrieve",
      policy: "argus:allowed",
      risk: "MEDIUM",
      inputHash: "h3",
      outputHash: "h4",
      result: "DENY",
      timestamp: new Date().toISOString(),
      evidenceIds: [],
    });
    expect(await ledger.verifyChain("tnt_v")).toEqual({ ok: true, checked: 2 });

    db.rows[0]!.record_hash = "hash_manipulado";
    expect((await ledger.verifyChain("tnt_v")).ok).toBe(false);
  });
});

describe("wiring en execution-authority", () => {
  it("ALLOW se persiste en el ledger inyectado antes del despacho", async () => {
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "isabella-dec-"));
    const ledger = new MemoryLedger();

    const authority = createExecutionAuthority({
      memoryRepository: createMemoryRepository(join(dir, "mem.json")),
      auditRepository: createAuditRepository(join(dir, "audit.json")),
      decisionStore: ledger,
      dbPolicyStore: { load: async () => null },
    });
    const outcome = await authority.execute({
      tool: "memory.retrieve",
      input: { tenantId: "tnt_dec", scope: "turn" },
      actorId: "usr_dec",
      tenantId: "tnt_dec",
      role: "SovereignOwner",
      authenticated: true,
      traceId: "trace_dec_1",
      ip: "127.0.0.1",
    });
    expect(outcome.executed).toBe(true);
    const records = ledger.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.result).toBe("ALLOW");
    expect(records[0]?.previousHash).toBe("GENESIS");
    expect(records[0]?.capability).toBe("memory.retrieve");
  });

  it("ledger ilegible bloquea la ejecución (stage audit, fail-closed)", async () => {
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "isabella-dec-fail-"));

    const authority = createExecutionAuthority({
      memoryRepository: createMemoryRepository(join(dir, "mem.json")),
      auditRepository: createAuditRepository(join(dir, "audit.json")),
      decisionStore: {
        append: async () => {
          throw new Error("isabella_decisions ilegible");
        },
        latestHash: async () => undefined,
      },
      dbPolicyStore: { load: async () => null },
    });
    const outcome = await authority.execute({
      tool: "memory.retrieve",
      input: { tenantId: "tnt_dec_fail", scope: "turn" },
      actorId: "usr_dec",
      tenantId: "tnt_dec_fail",
      role: "SovereignOwner",
      authenticated: true,
      traceId: "trace_dec_2",
      ip: "127.0.0.1",
    });
    expect(outcome.executed).toBe(false);
    if (!outcome.executed) {
      expect(outcome.stage).toBe("audit");
      expect(outcome.reason).toContain("isabella_decisions");
    }
  });
});
