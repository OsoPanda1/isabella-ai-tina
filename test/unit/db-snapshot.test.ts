// @ts-nocheck — interop con scripts .mjs sin tipos (verificados por sus propios tests).
import { describe, it, expect } from "vitest";

/**
 * BACKUP/RESTORE (test/unit/db-snapshot.test.ts)
 * -----------------------------------------------------------------
 * Lógica pura sin DB + restore contra pool falso (inyectado):
 * manifiesto, verificación anti-manipulación, orden topológico y
 * SQL aditivo (ON CONFLICT DO NOTHING).
 */

import {
  SNAPSHOT_TABLES,
  canonicalize,
  sha256Hex,
  buildManifest,
  verifySnapshot,
} from "../../scripts/db-snapshot-lib.mjs";
import { runRestore } from "../../scripts/db-restore.mjs";

function sampleSnapshot() {
  const tables = {
    tenants: [{ id: "t1", name: "Nodo", extra: 1 }],
    profiles: [],
    sessions: [],
    memories: [],
    audit_events: [],
    bookpi_ledger: [],
    api_keys: [],
    webhook_events: [],
    economic_events: [],
    sovereign_state: [{ id: "canonical", payload: {} }],
  };
  return { manifest: buildManifest(tables), tables };
}

describe("snapshot lib pura", () => {
  it("cubre las 11 tablas canónicas en orden FK", () => {
    expect(SNAPSHOT_TABLES[0]).toBe("tenants");
    expect(SNAPSHOT_TABLES).toHaveLength(11);
  });

  it("canonicalize ordena claves (hash estable)", () => {
    const a = JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: 1 } }));
    const b = JSON.stringify(canonicalize({ a: { c: 1, d: 2 }, b: 1 }));
    expect(a).toBe(b);
    expect(sha256Hex(a)).toHaveLength(64);
  });

  it("verifySnapshot acepta snapshot íntegro", () => {
    expect(verifySnapshot(sampleSnapshot())).toEqual([]);
  });

  it("verifySnapshot detecta manipulación y tablas ausentes", () => {
    const snapshot = sampleSnapshot();
    snapshot.tables.tenants.push({ id: "t-evil", name: "X" });
    const errors = verifySnapshot(snapshot);
    expect(errors.length).toBeGreaterThan(0);

    const missing = sampleSnapshot();
    delete missing.tables.profiles;
    expect(verifySnapshot(missing).some((error) => error.includes("profiles"))).toBe(true);
  });
});

describe("restore aditivo con pool falso", () => {
  function fakePoolFactory(log) {
    const fakeClient = {
      query: async (text) => {
        log.push(text);
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };
    return () => ({
      connect: async () => fakeClient,
      query: fakeClient.query,
      end: async () => undefined,
    });
  }

  it("inserta en orden topológico con ON CONFLICT DO NOTHING", async () => {
    const log = [];
    const snapshot = sampleSnapshot();
    snapshot.tables.profiles.push({
      id: "u1",
      username: "op",
      tenant_id: "t1",
      role: "Operator",
    });
    snapshot.tables.bookpi_ledger.push({
      index: 0,
      tenant_id: "t1",
      user_id: "u1",
      operation: "OP",
      category: "other",
      cost_decimal: "0.00",
      tokens_consumed: 0,
      previous_hash: "g",
      block_hash: "h",
      status: "settled",
    });
    snapshot.manifest = buildManifest(snapshot.tables);
    const inserted = await runRestore("postgres://fake", snapshot, () => fakePoolFactory(log)());
    expect(inserted.tenants).toBe(1);
    expect(inserted.sovereign_state).toBe(1);
    expect(log).toContain("BEGIN");
    expect(log).toContain("COMMIT");
    const insertStatements = log.filter((statement) => statement.startsWith("INSERT"));
    expect(insertStatements.length).toBeGreaterThan(0);
    for (const statement of insertStatements) {
      expect(statement.includes("ON CONFLICT DO NOTHING")).toBe(true);
    }
    const tablesInOrder = log.map((statement) => {
      const match = statement.match(/INSERT INTO public\."([^"]+)"/);
      return match ? match[1] : "";
    });
    expect(tablesInOrder.indexOf("tenants")).toBeLessThan(tablesInOrder.indexOf("profiles"));
    expect(tablesInOrder.indexOf("profiles")).toBeLessThan(tablesInOrder.indexOf("bookpi_ledger"));
  });

  it("snapshot manipulado aborta antes de tocar la DB", async () => {
    const log = [];
    const snapshot = sampleSnapshot();
    snapshot.tables.tenants.push({ id: "t-evil", name: "X" });
    await expect(
      runRestore("postgres://fake", snapshot, () => fakePoolFactory(log)()),
    ).rejects.toThrow(/Snapshot inválido/);
    expect(log).toHaveLength(0);
  });
});
