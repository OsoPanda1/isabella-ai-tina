import { describe, it, expect, beforeAll, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";

/**
 * AISLAMIENTO + CONCURRENCIA + TAMPER (test/security/isolation-evidence.test.ts)
 * -----------------------------------------------------------------
 * - Escrituras concurrentes (20 paralelas) en memoria y auditoría
 *   producen UNA cadena válida (mutex por store; auditoría en memoria
 *   con cadena verificable por tenant).
 * - Manipulación del archivo (memoria) y del registro sellado (auditoría)
 *   se detecta con corruptedId / brokenAt.
 * - Tenant B jamás ve registros de tenant A (memoria y BookPI JSON).
 */

function isolated(paths: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "isabella-iso-"));
  const out: Record<string, string> = {};
  for (const name of paths) out[name] = join(dir, `${name}.json`);
  return out;
}

// BookPI JSON exige firma real: clave RSA de test (fail-closed verificado).
beforeAll(async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vi.stubEnv("BOOKPI_SIGNATURE_ALGORITHM", "RSA-SHA256");
  vi.stubEnv("BOOKPI_SIGNING_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  vi.stubEnv("ISABELLA_RUNTIME_MODE", "development");
  const { resetConfigCache } = await import("@/lib/config");
  resetConfigCache();
});

describe("concurrencia sin bifurcación", () => {
  it("20 adds paralelos de memoria → cadena única válida", async () => {
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const paths = isolated(["mem"]);
    const repo = createMemoryRepository(paths.mem);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repo.add({
          tenantId: "tenant_conc",
          content: `nota ${index}`,
          source: "system",
          scope: "turn",
          sensitivity: "internal",
          purpose: "concurrency-proof",
          consentRequired: false,
          consentGranted: true,
        }),
      ),
    );
    expect(results.every((result) => result.success)).toBe(true);
    expect(repo.list("tenant_conc")).toHaveLength(20);
    expect(repo.verifyIntegrity().success).toBe(true);
  });

  it("20 appends paralelos de auditoría → cadena única válida", async () => {
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const repo = createAuditRepository();
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repo.append({
          tenant_id: "tenant_conc",
          timestamp: new Date().toISOString(),
          trace_id: `tr_${index}`,
          correlation_id: "corr_conc",
          actor: "vitest",
          actor_ip: "127.0.0.1",
          action: "append",
          resource: "audit",
          event: "concurrency-proof",
          severity: "S3",
          result: "success",
          details: { index },
        }),
      ),
    );
    expect(await repo.listRecent("tenant_conc", 50)).toHaveLength(20);
    const chain = await repo.verifyChain("tenant_conc");
    expect(chain.valid).toBe(true);
    expect(chain.recordCount).toBe(20);
  });
});

describe("detección de manipulación", () => {
  it("contenido alterado en memoria se detecta con corruptedId", async () => {
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const paths = isolated(["mem"]);
    const repo = createMemoryRepository(paths.mem);
    const added = await repo.add({
      tenantId: "tenant_tamper",
      content: "original",
      source: "system",
      scope: "turn",
      sensitivity: "internal",
      purpose: "tamper-proof",
      consentRequired: false,
      consentGranted: true,
    });
    expect(added.success).toBe(true);

    const raw = JSON.parse(readFileSync(paths.mem, "utf8")) as {
      records: Array<{ id: string; content: string }>;
      genesisChainHash: string;
    };
    raw.records[0].content = "ALTERADO";
    writeFileSync(paths.mem, JSON.stringify(raw));

    const integrity = repo.verifyIntegrity();
    expect(integrity.success).toBe(false);
    expect(integrity.corruptedId).toBeDefined();
  });

  it("evento de auditoría alterado rompe la cadena", async () => {
    const { createAuditRepository } = await import("@/lib/repositories/audit-repository");
    const repo = createAuditRepository();
    const base = {
      tenant_id: "tenant_tamper",
      timestamp: new Date().toISOString(),
      actor: "vitest",
      actor_ip: "127.0.0.1",
      action: "append",
      resource: "audit",
      severity: "S3" as const,
      result: "success" as const,
    };
    await repo.append({
      ...base,
      trace_id: "tr_1",
      correlation_id: "corr_1",
      event: "e1",
      details: { step: 1 },
    });
    const second = await repo.append({
      ...base,
      trace_id: "tr_2",
      correlation_id: "corr_2",
      event: "e2",
      details: { step: 2 },
    });
    const intact = await repo.verifyChain("tenant_tamper");
    expect(intact.valid).toBe(true);
    expect(intact.recordCount).toBe(2);

    // El registro devuelto es el mismo objeto almacenado: mutarlo sin sellar
    // de nuevo equivale a alterar el evento ya encadenado.
    second.details = { step: 2, tampered: true };
    const broken = await repo.verifyChain("tenant_tamper");
    expect(broken.valid).toBe(false);
    expect(broken.brokenAt).toBe(second.id);
  });
});

describe("crossover de tenant", () => {
  it("tenant B no lee memoria de tenant A (incluye personal/restringida)", async () => {
    const { createMemoryRepository } = await import("@/lib/repositories/memory-repository");
    const { createMemoryEngine } = await import("@/lib/memory-engine");
    const paths = isolated(["mem"]);
    const repository = createMemoryRepository(paths.mem);
    const engine = createMemoryEngine(repository);

    await repository.add({
      tenantId: "tenant_a",
      content: "secreto A",
      source: "user",
      scope: "session",
      sensitivity: "restricted",
      purpose: "crossover-proof",
      consentRequired: false,
      consentGranted: true,
      ownerId: "alice",
    });

    const alien = await engine.retrieve({
      tenantId: "tenant_b",
      actorId: "mallory",
      role: "Operator",
      scope: "session",
      authenticated: true,
      grantedScopes: ["session"],
    });
    expect(alien.records).toHaveLength(0);

    const owner = await engine.retrieve({
      tenantId: "tenant_a",
      actorId: "alice",
      role: "Operator",
      scope: "session",
      authenticated: true,
      grantedScopes: ["session"],
    });
    expect(owner.records).toHaveLength(1);
  });

  it("tenant B no lista bloques BookPI de tenant A", async () => {
    // El adaptador de test (`bookpi-repository.test-adapter.ts`) fue retirado
    // (AGENTS.md: sin adapters de test en src); la implementación canónica
    // file-backed es `createBookpiJsonRepository`.
    const { createBookpiJsonRepository } = await import("@/lib/repositories/bookpi-repository");
    const paths = isolated(["bookpi"]);
    const { writeFileSync: write } = await import("node:fs");
    write(paths.bookpi, JSON.stringify({ blocks: [], genesisPreviousHash: "0".repeat(64) }));
    const repo = createBookpiJsonRepository(paths.bookpi);
    const appended = await repo.append({
      tenantId: "tenant_a",
      userId: "alice",
      operation: "OP_A",
      category: "other",
      cost: 1,
      tokens: 0,
    });
    expect(appended.success).toBe(true);
    expect(repo.list("tenant_b")).toHaveLength(0);
    expect(repo.list("tenant_a")).toHaveLength(1);
  });
});
