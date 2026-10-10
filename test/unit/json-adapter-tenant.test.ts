import { describe, it, expect } from "vitest";
import { JsonFileRepository } from "@/lib/persistence/adapters/json-adapter";

/**
 * S14 — aislamiento de tenant en el adaptador JSON
 * (test/unit/json-adapter-tenant.test.ts)
 * -----------------------------------------------------------------
 * - Sin tenantId no hay lectura/escritura: todos los CRUD fallan.
 * - El unico cruce autorizado es findByPrefix (resolucion previa al tenant).
 */

interface Rec {
  id: string;
  tenantId?: string;
}

describe("JsonFileRepository — fail-closed sin tenantId", () => {
  it("read/list rechazan tenant vacio (no cross-tenant)", async () => {
    const repo = new JsonFileRepository<Rec>("session");
    await expect(repo.read("", "s1")).rejects.toThrow(/tenantId required/);
    await expect(repo.list("")).rejects.toThrow(/tenantId required/);
  });

  it("create/update/delete rechazan tenant vacio", async () => {
    const repo = new JsonFileRepository<Rec>("session");
    await expect(repo.create("", { id: "s2" })).rejects.toThrow(/tenantId required/);
    await expect(repo.update("", "s1", { id: "s1" })).rejects.toThrow(/tenantId required/);
    await expect(repo.delete("", "s1")).rejects.toThrow(/tenantId required/);
  });

  it("el error conserva codigo REPOSITORY_ERROR para el caller", async () => {
    const repo = new JsonFileRepository<Rec>("session");
    try {
      await repo.list("");
      throw new Error("debia rechazar la lectura sin tenantId");
    } catch (err) {
      const e = err as { code?: string; statusCode?: number };
      expect(e.code).toBe("REPOSITORY_ERROR");
      expect(e.statusCode).toBe(500);
    }
  });
});
