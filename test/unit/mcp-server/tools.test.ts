import { describe, expect, it } from "vitest";
import { createToolRegistry, TOOL_REGISTRY_SEED } from "@/lib/tool-registry";
import {
  buildMcpInputSchema,
  buildMcpToolList,
  parseDeclaredParameters,
  validateMcpToolArguments,
} from "@/lib/mcp-server/tools";

/**
 * CATÁLOGO MCP (test/unit/mcp-server/tools.test.ts)
 * El registro Zero Trust sigue siendo la única fuente de verdad: el esquema
 * JSON de `tools/list` se DERIVA de `inputSchemaDescription`.
 */

describe("parseDeclaredParameters", () => {
  it("separa parámetros y elimina notas entre paréntesis", () => {
    expect(parseDeclaredParameters("tenantId, actorId, scope, sensitivity")).toEqual([
      "tenantId",
      "actorId",
      "scope",
      "sensitivity",
    ]);
    expect(
      parseDeclaredParameters("command, envVars, inputPayload (solo fuentes autorizadas)"),
    ).toEqual(["command", "envVars", "inputPayload"]);
  });

  it("conserva identificadores con barra y descarta basura", () => {
    expect(parseDeclaredParameters("token/session, tenantId")).toEqual([
      "token/session",
      "tenantId",
    ]);
    expect(parseDeclaredParameters("query, maxResults; DROP TABLE x")).toEqual(["query"]);
    expect(parseDeclaredParameters("")).toEqual([]);
  });
});

describe("buildMcpInputSchema", () => {
  it("genera objeto cerrado sin tipos ni required (el registro no los declara)", () => {
    const schema = buildMcpInputSchema("url, maxResults");
    expect(schema).toEqual({
      type: "object",
      properties: { url: {}, maxResults: {} },
      additionalProperties: false,
    });
    expect(schema).not.toHaveProperty("required");
    expect(Object.values(schema.properties).every((p) => !("type" in p))).toBe(true);
  });
});

describe("buildMcpToolList", () => {
  it("expone exactamente el registro con anotaciones de efectos", () => {
    const registry = createToolRegistry();
    const tools = buildMcpToolList(registry);
    expect(tools).toHaveLength(TOOL_REGISTRY_SEED.length);
    expect(tools.map((t) => t.name).sort()).toEqual(
      registry
        .list()
        .map((t) => t.name)
        .sort(),
    );

    const retrieve = tools.find((t) => t.name === "memory.retrieve");
    expect(retrieve?.description).toBe(
      "Recuperar contexto de memoria dentro del scope y tenant autorizados.",
    );
    expect(retrieve?.annotations).toEqual({
      title: "memory.retrieve",
      readOnlyHint: true,
      destructiveHint: false,
    });

    const record = tools.find((t) => t.name === "ledger.record");
    expect(record?.annotations.destructiveHint).toBe(true);
    expect(record?.annotations.readOnlyHint).toBe(false);
    expect(record?.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(record?.inputSchema.properties ?? {})).toEqual([
      "tenantId",
      "userId",
      "operation",
      "category",
      "cost",
      "tokens",
    ]);
  });
});

describe("validateMcpToolArguments", () => {
  const tool = { name: "storage.read", inputSchemaDescription: "tenantId, path, scope" };

  it("acepta objeto solo con parámetros declarados", () => {
    const result = validateMcpToolArguments(tool, { tenantId: "t1", path: "a", scope: "project" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args.path).toBe("a");
  });

  it("acepta objeto parcial (el registro no declara required)", () => {
    expect(validateMcpToolArguments(tool, { tenantId: "t1" }).ok).toBe(true);
  });

  it("rechaza argumentos no declarados (fail-closed)", () => {
    const result = validateMcpToolArguments(tool, { tenantId: "t1", "rm -rf": "/" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("rm -rf");
  });

  it("rechaza argumentos que no son objeto", () => {
    expect(validateMcpToolArguments(tool, []).ok).toBe(false);
    expect(validateMcpToolArguments(tool, "texto").ok).toBe(false);
    expect(validateMcpToolArguments(tool, null).ok).toBe(false);
  });
});
