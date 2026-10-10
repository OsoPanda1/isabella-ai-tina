import { describe, it, expect, vi } from "vitest";

/**
 * KILL SWITCH (§7.1 Charter)
 * (test/unit/kill-switch.test.ts + DB en test/bookpi/kill-switch-evidence.test.ts)
 * -----------------------------------------------------------------
 * engage/release auditados, enforcement en Execution Authority,
 * capacidades desconocidas rechazadas.
 */

import { createMemoryKillSwitchStore, KILL_SWITCH_CAPABILITIES } from "@/lib/kill-switch";

describe("kill switch en memoria", () => {
  it("expone las 5 capacidades autónomas", () => {
    expect([...KILL_SWITCH_CAPABILITIES].sort()).toEqual(
      ["inference", "payouts", "quantum-jobs", "skill-execution", "tool-execution"].sort(),
    );
  });

  it("engage → killed → release → operativo, con auditoría", async () => {
    const events: string[] = [];
    const store = createMemoryKillSwitchStore((event) => events.push(event));
    expect(await store.isKilled("inference")).toBe(false);
    const engaged = await store.engage("inference", "prueba de emergencia", "owner_1");
    expect(engaged.engaged).toBe(true);
    expect(await store.isKilled("inference")).toBe(true);
    await store.release("inference", "owner_1");
    expect(await store.isKilled("inference")).toBe(false);
    expect(events).toEqual(["kill-switch.engaged", "kill-switch.released"]);
  });

  it("rechaza capacidad desconocida y release sin parada", async () => {
    const store = createMemoryKillSwitchStore();
    await expect(store.engage("naves-espaciales", "x", "o")).rejects.toThrow(/desconocida/);
    await expect(store.release("payouts", "o")).rejects.toThrow(/Sin parada activa/);
    await expect(store.engage("payouts", "", "o")).rejects.toThrow(/Motivo/);
  });
});

describe("enforcement en Execution Authority", () => {
  it("tool-execution engaged deniega antes de autorizar", async () => {
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "isabella-kill-"));

    const killSwitch = createMemoryKillSwitchStore();
    await killSwitch.engage("tool-execution", "emergencia de prueba", "owner_1");

    const authority = createExecutionAuthority({
      memoryRepository: createMemoryRepository(join(dir, "mem.json")),
      auditRepository: createAuditRepository(join(dir, "audit.json")),
      killSwitch,
    });
    const outcome = await authority.execute({
      tool: "memory.retrieve",
      input: { tenantId: "t1" },
      actorId: "op1",
      tenantId: "t1",
      role: "SovereignOwner",
      authenticated: true,
      traceId: "tr_kill_1",
      ip: "127.0.0.1",
    });
    expect(outcome.executed).toBe(false);
    if (!outcome.executed) {
      expect(outcome.stage).toBe("decide");
      expect(outcome.reason).toMatch(/Kill switch/);
    }
  });
});

describe("kill switch Postgres (DB real, gateado)", () => {
  const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

  it.skipIf(!DB_URL)("engage/release durables y visibles", async () => {
    vi.stubEnv("DATABASE_URL", DB_URL as string);
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const { createPostgresKillSwitchStore } = await import("@/lib/kill-switch");
    const store = createPostgresKillSwitchStore();
    const trace = `cap-${Date.now()}`;
    void trace;
    await store.release("payouts", "owner_1").catch(() => undefined);
    expect(await store.isKilled("payouts")).toBe(false);
    await store.engage("payouts", "prueba gateada", "owner_1");
    expect(await store.isKilled("payouts")).toBe(true);
    await store.release("payouts", "owner_1");
    expect(await store.isKilled("payouts")).toBe(false);
    vi.unstubAllEnvs();
    resetConfigCache();
  });
});
