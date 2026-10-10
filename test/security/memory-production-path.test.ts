import { describe, expect, it, vi } from "vitest";
import type { MemoryRecord } from "@/lib/repositories/memory-repository";

const repositoryFactory = (records: MemoryRecord[] = []) => ({
  list: vi.fn(async () => records),
  prune: vi.fn(async () => ({ removed: 0 })),
  verifyIntegrity: vi.fn(async () => ({ success: true as const })),
  add: vi.fn(),
});

async function loadEngineWithRepository(repository: ReturnType<typeof repositoryFactory>) {
  const { createMemoryEngine } = await import("@/lib/memory-engine");
  return createMemoryEngine(repository);
}

describe("production memory contract", () => {
  it("never crosses a tenant boundary", async () => {
    const repository = repositoryFactory([
      {
        id: "mem_a",
        tenantId: "tenant-a",
        ownerId: "user-a",
        content: "A",
        source: "user",
        scope: "session",
        sensitivity: "public",
        purpose: "test",
        consentRequired: false,
        consentGranted: true,
        createdAt: new Date().toISOString(),
        deletable: true,
        provenance: ["test"],
        contentHash: "",
        chainHash: "",
      },
      {
        id: "mem_b",
        tenantId: "tenant-b",
        ownerId: "user-b",
        content: "B",
        source: "user",
        scope: "session",
        sensitivity: "public",
        purpose: "test",
        consentRequired: false,
        consentGranted: true,
        createdAt: new Date().toISOString(),
        deletable: true,
        provenance: ["test"],
        contentHash: "",
        chainHash: "",
      },
    ]);

    const engine = await loadEngineWithRepository(repository);
    const result = await engine.retrieve({
      tenantId: "tenant-a",
      actorId: "user-a",
      role: "Operator",
      scope: "session",
      authenticated: true,
      grantedScopes: ["session"],
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.tenantId).toBe("tenant-a");
    expect(result.records.some((record) => record.tenantId !== "tenant-a")).toBe(false);
  });

  it("denies unauthenticated access before repository enumeration", async () => {
    const repository = repositoryFactory([]);
    const engine = await loadEngineWithRepository(repository);
    const result = await engine.retrieve({
      tenantId: "tenant-a",
      actorId: "anonymous",
      role: "Guest",
      scope: "session",
      authenticated: false,
      grantedScopes: [],
    });

    expect(result).toEqual({ records: [], denied: 0 });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it("supports an async durable repository without changing authorization semantics", async () => {
    const repository = repositoryFactory([
      {
        id: "mem_sensitive",
        tenantId: "tenant-a",
        ownerId: "other-user",
        content: "private",
        source: "user",
        scope: "session",
        sensitivity: "personal",
        purpose: "test",
        consentRequired: true,
        consentGranted: true,
        createdAt: new Date().toISOString(),
        deletable: true,
        provenance: ["test"],
        contentHash: "",
        chainHash: "",
      },
    ]);
    const engine = await loadEngineWithRepository(repository);
    const result = await engine.retrieve({
      tenantId: "tenant-a",
      actorId: "user-a",
      role: "Operator",
      scope: "session",
      authenticated: true,
      grantedScopes: ["session"],
    });

    expect(result.records).toEqual([]);
    expect(result.denied).toBe(1);
  });
});
