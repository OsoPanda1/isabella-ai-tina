/**
 * SERVIDOR MCP DE ISABELLA — punto de entrada del módulo
 * (src/lib/mcp-server/index.ts)
 * -----------------------------------------------------------------
 * Puerto del servidor MCP de herramientas de Hermes
 * (`hermes_tools_mcp_server.py`, stdio) a TypeScript sobre el runtime de
 * Isabella: transporte newline-delimited JSON-RPC 2.0 + autoridad existente
 * (registro Zero Trust, RBAC, política ARGUS, ORION/sandbox, redacción y gate
 * de salida). No crea un stack paralelo: reutiliza el de `src/lib`.
 *
 * Uso (fábrica, sin efectos al importar):
 *
 * ```ts
 * import { createIsabellaMcpServer } from "@/lib/mcp-server";
 *
 * const server = createIsabellaMcpServer(process.stdin, {
 *   write: (chunk) => process.stdout.write(chunk),
 * }, { context: { actorId, tenantId, role: "Operator", authenticated: true } });
 *
 * await server.run();
 * ```
 *
 * Nota: este paquete no declara un binario propio (package.json no se modifica);
 * el proceso que desee servir MCP debe invocar la fábrica anterior sobre stdio.
 */
export * from "./protocol";
export * from "./tools";
export * from "./policy";
export * from "./server";
