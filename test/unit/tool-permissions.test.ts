import { describe, it, expect } from "vitest";
import {
  createToolRegistry,
  missingToolPermissions,
  TOOL_REGISTRY_SEED,
  type RegisteredTool,
} from "@/lib/tool-registry";

/**
 * ISA-164 — requiredPermissions de la whitelist son OBLIGATORIOS
 * (test/unit/tool-permissions.test.ts)
 * -----------------------------------------------------------------
 * - Un rol sin el permiso declarado queda denegado en stage "decide".
 * - El mapeo es fail-closed: un permiso sin entrada en el mapa se deniega.
 * - Roles desconocidos no obtienen ningun permiso.
 */

function toolWith(requiredPermissions: string[]): RegisteredTool {
  return {
    name: "demo.tool",
    purpose: "demo",
    inputSchemaDescription: "-",
    outputDescription: "-",
    risk: "medium",
    requiredPermissions,
    maxTimeMs: 1000,
    maxRetries: 0,
    auditEvent: "tool.demo",
    category: "compute",
    requiresApproval: false,
    territorialBoundary: false,
  };
}

describe("missingToolPermissions (ISA-164)", () => {
  it("Operator puede ejecutar memory.retrieve (memory:read mapeado)", () => {
    const memoryRetrieve = TOOL_REGISTRY_SEED.find((t) => t.name === "memory.retrieve");
    expect(memoryRetrieve).toBeDefined();
    expect(missingToolPermissions(memoryRetrieve!, "Operator")).toEqual([]);
  });

  it("Guest no tiene permisos de escritura de herramientas", () => {
    expect(missingToolPermissions(toolWith(["brand:write"]), "Guest")).toEqual(["brand:write"]);
    expect(missingToolPermissions(toolWith(["ledger:write"]), "Guest")).toEqual(["ledger:write"]);
  });

  it("el rol System (solo lectura) no puede ejecutar herramientas con side effects", () => {
    expect(missingToolPermissions(toolWith(["brand:write"]), "System")).toEqual(["brand:write"]);
    // ...pero si puede ejecutar las de lectura declaradas como read-only.
    expect(missingToolPermissions(toolWith(["kb:read"]), "System")).toEqual([]);
  });

  it("fail-closed: permiso declarado sin mapeo en RBAC se deniega", () => {
    expect(missingToolPermissions(toolWith(["permiso.inexistente"]), "SovereignOwner")).toEqual([
      "permiso.inexistente",
    ]);
  });

  it("fail-closed: rol desconocido no obtiene ningun permiso", () => {
    expect(missingToolPermissions(toolWith(["kb:read"]), "SuperAdmin")).toEqual(["kb:read"]);
    expect(missingToolPermissions(toolWith(["memory:read"]), "")).toEqual(["memory:read"]);
  });

  it("el registro completo del seed esta mapeado para al menos un rol con tool:execute", () => {
    for (const tool of TOOL_REGISTRY_SEED) {
      expect(missingToolPermissions(tool, "SovereignOwner"), tool.name).toEqual([]);
      expect(missingToolPermissions(tool, "Guest"), tool.name).not.toContain(undefined);
    }
  });
});

describe("execution authority niega sin el permiso requerido", () => {
  it("stage=decide cuando el rol carece del requiredPermission", async () => {
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const authority = createExecutionAuthority({});
    const outcome = await authority.execute({
      tool: "firecrawl.competitive_intel",
      input: {},
      actorId: "usr_test",
      tenantId: "tnt_test",
      role: "Guest",
      authenticated: true,
      traceId: "trace_isa164",
      ip: "127.0.0.1",
    });
    expect(outcome.executed).toBe(false);
    if (!outcome.executed) expect(outcome.stage).toBe("decide");
  });

  it("el registro sigue denegando herramientas fuera de la whitelist", async () => {
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const authority = createExecutionAuthority({});
    const outcome = await authority.execute({
      tool: "herramienta.no.registrada",
      input: {},
      actorId: "usr_test",
      tenantId: "tnt_test",
      role: "SovereignOwner",
      authenticated: true,
      traceId: "trace_isa164_b",
      ip: "127.0.0.1",
    });
    expect(outcome.executed).toBe(false);
  });

  it("createToolRegistry conserva deny-by-default", () => {
    const registry = createToolRegistry();
    expect(registry.check("no.existe").allowed).toBe(false);
    expect(registry.check("memory.retrieve").allowed).toBe(true);
  });
});
