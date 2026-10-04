import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMemoryRepository,
  LEGACY_MEMORY_REPOSITORY_V1,
} from "@/lib/repositories/memory-repository";
import { createMemoryPostgresRepository } from "@/lib/repositories/memory-postgres-repository";
import { resetConfigCache } from "@/lib/config";
import { isExplicitDevelopmentAuth, canUseGuestChat } from "@/lib/principal-context";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, ORIGINAL_ENV);
  resetConfigCache();
});

describe("production memory and identity authority", () => {
  it("keeps the canonical development repository contract intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "isabella-memory-"));
    const storePath = join(dir, "memory.json");

    try {
      const repository = createMemoryRepository(storePath);
      const added = await repository.add({
        tenantId: "tenant-a",
        content: "contexto soberano",
        source: "user",
        scope: "session",
        sensitivity: "internal",
        purpose: "test",
        consentRequired: false,
        consentGranted: true,
        ownerId: "user-a",
      });

      expect(added.success).toBe(true);
      expect(repository.list("tenant-a", "session")).toHaveLength(1);
      expect(repository.verifyIntegrity().success).toBe(true);
      expect(readFileSync(storePath, "utf8")).toContain("contexto soberano");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves the previous SHA3-512 memory algorithm as an isolated compatibility plane", async () => {
    const record = await LEGACY_MEMORY_REPOSITORY_V1.append({
      tenant_id: "legacy-tenant",
      content: "compatibility",
      scope: "session",
      sensitivity: "medium",
    });

    expect(record.content_hash).toHaveLength(128);
    expect(record.chain_hash).toHaveLength(128);
    await expect(
      LEGACY_MEMORY_REPOSITORY_V1.verifyChain("legacy-tenant"),
    ).resolves.toMatchObject({ valid: true, count: 1 });
  });

  it("fails closed instead of silently falling back when PostgreSQL memory has no durable database", async () => {
    process.env.NODE_ENV = "development";
    process.env.ISABELLA_RUNTIME_MODE = "development";
    delete process.env.DATABASE_URL;
    resetConfigCache();

    const repository = createMemoryPostgresRepository();
    await expect(
      repository.add({
        tenantId: "tenant-a",
        content: "must not become RAM fallback",
        source: "user",
        scope: "session",
        sensitivity: "internal",
        purpose: "authority-test",
        consentRequired: false,
        consentGranted: true,
        ownerId: "user-a",
      }),
    ).rejects.toThrow(/DATABASE_URL is required/i);
  });

  it("requires an explicitly configured development runtime for development auth", () => {
    expect(
      isExplicitDevelopmentAuth({
        NODE_ENV: "development",
        ISABELLA_RUNTIME_MODE: "development",
        AUTH_DEV_SESSION_ENABLED: true,
      }),
    ).toBe(true);

    expect(
      isExplicitDevelopmentAuth({
        NODE_ENV: "production",
        ISABELLA_RUNTIME_MODE: "development",
        AUTH_DEV_SESSION_ENABLED: true,
      }),
    ).toBe(false);
  });

  it("never enables guest chat merely because runtime is non-production", () => {
    expect(
      canUseGuestChat({
        ALLOW_GUEST_CHAT: true,
        NODE_ENV: "staging",
        ISABELLA_RUNTIME_MODE: "staging",
        VERCEL_ENV: "preview",
      }),
    ).toBe(true);

    expect(
      canUseGuestChat({
        ALLOW_GUEST_CHAT: true,
        NODE_ENV: "production",
        ISABELLA_RUNTIME_MODE: "staging",
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
  });
});
