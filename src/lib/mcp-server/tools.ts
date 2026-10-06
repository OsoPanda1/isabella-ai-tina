/**
 * CATÁLOGO MCP DE HERRAMIENTAS (src/lib/mcp-server/tools.ts)
 * -----------------------------------------------------------------
 * Deriva `tools/list` del registro Zero Trust canónico (`tool-registry.ts`)
 * sin duplicar catálogos: la única fuente de verdad de nombres, propósito y
 * metadatos operativos sigue siendo el registro.
 *
 * El registro declara la entrada como `inputSchemaDescription` (lista textual
 * de parámetros) y NO como JSON Schema, por lo que este módulo genera un
 * esquema JSON DERIVADO:
 *  - objeto con `properties` por cada parámetro declarado;
 *  - `additionalProperties: false` (fail-closed ante argumentos extra);
 *  - sin tipos y sin `required`: el registro no declara tipos ni obligatoriedad
 *    y fabricarlos sería inventar información que la autoridad no define.
 */
import type { RegisteredTool, ToolRegistry } from "../tool-registry";
import { deriveMcpSideEffects } from "./policy";

/** Propiedad de esquema derivada: sin tipo porque el registro no lo declara. */
export interface McpJsonSchemaProperty {
  description?: string;
}

/** Esquema JSON de argumentos de `tools/call` (siempre objeto). */
export interface McpJsonSchema {
  type: "object";
  properties: Record<string, McpJsonSchemaProperty>;
  additionalProperties: false;
}

export interface McpToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpJsonSchema;
  annotations: McpToolAnnotations;
}

/**
 * Identificador de parámetro aceptado: `nombre`, `nombre/subnombre` o
 * `nombre (nota libre)`. Todo lo que no sea identificador se descarta en
 * lugar de exponerlo como propiedad del esquema.
 */
const PARAMETER_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PARAMETER_NOTE = /\s*\([^)]*\)\s*$/;

function isParameterIdentifier(name: string): boolean {
  const segments = name.split("/");
  return segments.length > 0 && segments.every((segment) => PARAMETER_SEGMENT.test(segment));
}

/** Extrae los parámetros declarados en una descripción textual. */
export function parseDeclaredParameters(description: string): string[] {
  const names: string[] = [];
  for (const rawPart of description.split(",")) {
    const name = rawPart.replace(PARAMETER_NOTE, "").trim();
    if (isParameterIdentifier(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Construye el esquema JSON derivado de la descripción de entrada. */
export function buildMcpInputSchema(description: string): McpJsonSchema {
  const properties: Record<string, McpJsonSchemaProperty> = {};
  for (const name of parseDeclaredParameters(description)) properties[name] = {};
  return { type: "object", properties, additionalProperties: false };
}

/** Anotaciones de riesgo para que el cliente MCP no ejecute ciegamente. */
export function buildMcpToolAnnotations(tool: RegisteredTool): McpToolAnnotations {
  const sideEffects = deriveMcpSideEffects(tool.requiredPermissions);
  return {
    title: tool.name,
    readOnlyHint: sideEffects === "none" || sideEffects === "read",
    destructiveHint: sideEffects === "write" || sideEffects === "financial",
  };
}

/** Lista completa expuesta por `tools/list`. */
export function buildMcpToolList(registry: ToolRegistry): McpToolDefinition[] {
  return registry.list().map((tool) => ({
    name: tool.name,
    description: tool.purpose,
    inputSchema: buildMcpInputSchema(tool.inputSchemaDescription),
    annotations: buildMcpToolAnnotations(tool),
  }));
}

export type McpArgumentsValidation =
  { ok: true; args: Record<string, unknown> } | { ok: false; reason: string };

/**
 * Valida los argumentos de `tools/call` contra el esquema derivado: deben ser
 * un objeto y solo pueden usar parámetros declarados (fail-closed).
 */
export function validateMcpToolArguments(
  tool: Pick<RegisteredTool, "name" | "inputSchemaDescription">,
  args: unknown,
): McpArgumentsValidation {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { ok: false, reason: `Argumentos de '${tool.name}' deben ser un objeto JSON.` };
  }
  const known = new Set(Object.keys(buildMcpInputSchema(tool.inputSchemaDescription).properties));
  for (const key of Object.keys(args)) {
    if (!known.has(key)) {
      return {
        ok: false,
        reason: `Argumento '${key}' no declarado para la herramienta '${tool.name}'.`,
      };
    }
  }
  return { ok: true, args: args as Record<string, unknown> };
}
