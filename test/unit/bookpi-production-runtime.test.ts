import { beforeEach, describe, expect, it } from "vitest";
import { createBookpiDevRepository } from "@/lib/repositories/bookpi-dev-repository";
import { createBookpiRepository } from "@/lib/repositories/bookpi-repository";
import { createBookpiPostgresRepository } from "@/lib/repositories/bookpi-postgres-runtime";

describe("BookPI production authority boundaries", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("keeps the legacy factory available without replacing its algorithm", () => {
    const repository = createBookpiRepository();
    expect(repository).toBeDefined();
    expect(typeof repository.appendBlock).toBe("function");
  });

  it("provides an isolated development repository", () => {
    const repository = createBookpiDevRepository();
    const result = repository.append({
      tenantId: "tenant-test",
      userId: "user-test",
      operation: "unit.test",
      category: "other",
      cost: 0,
      tokens: 1,
    });
    expect(result.success).toBe(true);
    expect(repository.list("tenant-test")).toHaveLength(1);
    expect(repository.verifyIntegrity("tenant-test").success).toBe(true);
  });

  it("fails closed instead of falling back to memory for production BookPI", () => {
    expect(() => createBookpiPostgresRepository()).toThrow(
      "BOOKPI_POSTGRES_UNAVAILABLE",
    );
  });
});
