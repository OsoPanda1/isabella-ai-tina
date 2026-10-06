/**
 * SERVIDOR MCP stdio — ISABELLA (src/lib/mcp-server/server.ts)
 * -----------------------------------------------------------------
 * Implementa el transporte stdio del Model Context Protocol en formato
 * newline-delimited JSON-RPC 2.0 (spec 2025-06-18): cada mensaje es un JSON
 * compacto terminado en "\n", sin `Content-Length` (eso es LSP, no MCP) y sin
 * nada distinto de protocolo en stdout — los logs salen por stderr.
 *
 * Métodos soportados: `initialize`, `ping`, `tools/list`, `tools/call`.
 * Notificaciones del cliente se consumen sin respuesta (JSON-RPC).
 *
 * Decisiones de contrato del transporte:
 *  - `initialize`/`ping` antes de inicializar → -32002 (ServerNotInitialized).
 *  - método desconocido → -32601; argumentos/parámetros inválidos → -32602.
 *  - herramienta desconocida o fuera de la whitelist → -32602.
 *  - toda denegación de autorización/policy/ejecución/salida → herramienta
 *    MCP con `isError: true` (el cliente ve el motivo, no un error de red).
 *  - toda línea de salida pasa por el redactor del sistema antes de escribirse.
 *
 * El módulo NO tiene efectos al importarse: stdio se conecta solo cuando el
 * consumidor invoca `createIsabellaMcpServer(...)` y `run()`.
 */
import { createOrionEngine, type OrionEngine } from "../orion-engine";
import { createToolRegistry, type ToolRegistry } from "../tool-registry";
import type { SovereignSandboxService } from "../sovereign-sandbox";
import { ISABELLA_VERSION } from "../isabella/crown-mexa-12";
import { redact } from "../secret-redactor";
import {
  ANONYMOUS_MCP_CONTEXT,
  authorizeMcpToolCall,
  executeMcpToolCall,
  type McpCallerContext,
} from "./policy";
import { buildMcpToolList, validateMcpToolArguments } from "./tools";
import {
  createLineDecoder,
  encodeJsonRpcMessage,
  isPlainJsonObject,
  jsonRpcFailure,
  jsonRpcSuccess,
  parseJsonRpcMessage,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  MCP_SERVER_NOT_INITIALIZED,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from "./protocol";

export const MCP_SERVER_NAME = "isabella-mcp-server";
export const MCP_LATEST_PROTOCOL_VERSION = "2025-06-18";
/** Versiones MCP soportadas, de la más reciente a la más antigua. */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  MCP_LATEST_PROTOCOL_VERSION,
  "2025-03-26",
  "2024-11-05",
];

export const MCP_INSTRUCTIONS =
  "Servidor MCP stdio de Isabella. Todo tools/call se autoriza en cadena: identidad, " +
  "whitelist Zero Trust, permisos RBAC, política ARGUS (frontera territorial y aprobación), " +
  "capability token de uso único, sandbox ORION y gate de salida. Las denegaciones llegan " +
  "como resultado con isError: true.";

/** Logger del servidor: SOLO stderr (stdout es el canal MCP). */
export interface McpLogger {
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Logger por defecto: escribe en stderr con redacción de secretos. */
export function createStderrMcpLogger(prefix = "[isabella-mcp]"): McpLogger {
  const write = (level: string, message: string): void => {
    console.error(`${prefix} ${level} ${redact(message)}`);
  };
  return {
    debug: (message) => write("debug", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  };
}

/** Sumidero de salida: el consumidor decide cómo escribir stdout. */
export interface McpOutputSink {
  write(chunk: string): void;
}

export interface IsabellaMcpServerOptions {
  /** Identidad del cliente MCP. Default: anónima → todo denegado. */
  context?: McpCallerContext;
  registry?: ToolRegistry;
  engine?: Pick<OrionEngine, "checkTool" | "execute">;
  sandbox?: SovereignSandboxService;
  /** Herramientas con aprobación/consentimiento humano ya otorgado. */
  approvals?: ReadonlySet<string>;
  territorialBoundaryEnforced?: boolean;
  logger?: McpLogger;
  serverName?: string;
  serverVersion?: string;
  maxLineLength?: number;
}

export interface IsabellaMcpServer {
  /** Versión negociada con el cliente (la última antes de `initialize`). */
  readonly protocolVersion: string;
  /** Procesa una línea ya delimitada (sin salto de línea final). */
  handleLine(line: string): Promise<void>;
  /** Acumula un chunk binario/texto y procesa las líneas completas. */
  feed(chunk: Uint8Array | string): Promise<void>;
  /** Consume `input` hasta EOF (o hasta `close()`). */
  run(): Promise<void>;
  /** Detiene el servidor; las escrituras posteriores se ignoran. */
  close(): void;
}

type DispatchResult =
  { kind: "result"; value: unknown } | { kind: "error"; code: number; message: string };

function failure(id: JsonRpcId, code: number, message: string): JsonRpcMessage {
  return jsonRpcFailure(id, code, redact(message));
}

function stringMeta(params: Record<string, unknown>, key: string): string | undefined {
  const meta = params._meta;
  if (!isPlainJsonObject(meta)) return undefined;
  const value = meta[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Crea el servidor MCP inyectando E/S y autoridad (registro, ORION, sandbox,
 * contexto de identidad y aprobaciones). Nada se ejecuta hasta `run()`.
 */
export function createIsabellaMcpServer(
  input: AsyncIterable<Uint8Array | string>,
  output: McpOutputSink,
  options: IsabellaMcpServerOptions = {},
): IsabellaMcpServer {
  const registry = options.registry ?? createToolRegistry();
  const engine: Pick<OrionEngine, "checkTool" | "execute"> =
    options.engine ?? createOrionEngine(registry);
  const context = options.context ?? ANONYMOUS_MCP_CONTEXT;
  const logger = options.logger ?? createStderrMcpLogger();
  const serverName = options.serverName ?? MCP_SERVER_NAME;
  const serverVersion = options.serverVersion ?? ISABELLA_VERSION;
  const decoder = createLineDecoder(options.maxLineLength);

  let protocolVersion = MCP_LATEST_PROTOCOL_VERSION;
  let initialized = false;
  let closed = false;

  const send = (message: JsonRpcMessage): void => {
    if (closed) return;
    try {
      output.write(redact(encodeJsonRpcMessage(message)));
    } catch (error) {
      logger.error(`No se pudo escribir la respuesta MCP: ${String(error)}`);
    }
  };

  const dispatch = async (request: JsonRpcRequest): Promise<DispatchResult> => {
    if (request.method === "ping") return { kind: "result", value: {} };

    if (request.method === "initialize") {
      if (request.params !== undefined && !isPlainJsonObject(request.params)) {
        return {
          kind: "error",
          code: JSON_RPC_INVALID_PARAMS,
          message: "initialize requiere un objeto de parámetros.",
        };
      }
      const params = request.params ?? {};
      const requested = params.protocolVersion;
      if (requested !== undefined && typeof requested !== "string") {
        return {
          kind: "error",
          code: JSON_RPC_INVALID_PARAMS,
          message: 'initialize: "protocolVersion" debe ser una cadena.',
        };
      }
      protocolVersion =
        typeof requested === "string" && MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : MCP_LATEST_PROTOCOL_VERSION;
      initialized = true;
      return {
        kind: "result",
        value: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: serverName, version: serverVersion },
          instructions: MCP_INSTRUCTIONS,
        },
      };
    }

    if (!initialized) {
      return {
        kind: "error",
        code: MCP_SERVER_NOT_INITIALIZED,
        message: "Servidor MCP no inicializado: envía 'initialize' antes de continuar.",
      };
    }

    if (request.method === "tools/list") {
      // Solo metadatos de catálogo (nombre/propósito/esquema derivado): no hay
      // ejecución ni datos. La autorización real ocurre en `tools/call`.
      return { kind: "result", value: { tools: buildMcpToolList(registry) } };
    }

    if (request.method === "tools/call") {
      if (!isPlainJsonObject(request.params)) {
        return {
          kind: "error",
          code: JSON_RPC_INVALID_PARAMS,
          message: "tools/call requiere un objeto con el campo 'name'.",
        };
      }
      const params = request.params;
      const toolName = params.name;
      if (typeof toolName !== "string" || toolName.length === 0) {
        return {
          kind: "error",
          code: JSON_RPC_INVALID_PARAMS,
          message: 'tools/call: "name" debe ser una cadena no vacía.',
        };
      }

      const authorization = authorizeMcpToolCall({
        context,
        toolName,
        registry,
        engine,
        approvals: options.approvals,
        territorialBoundaryEnforced: options.territorialBoundaryEnforced,
      });
      if (!authorization.allowed) {
        if (authorization.stage === "unknown-tool") {
          logger.warn(`tools/call rechazada (herramienta desconocida): ${toolName}`);
          return { kind: "error", code: JSON_RPC_INVALID_PARAMS, message: authorization.reason };
        }
        logger.warn(
          `tools/call denegada etapa=${authorization.stage} tool=${toolName} motivo=${authorization.reason}`,
        );
        return {
          kind: "result",
          value: { content: [{ type: "text", text: redact(authorization.reason) }], isError: true },
        };
      }

      const rawArguments = params.arguments ?? {};
      const validation = validateMcpToolArguments(authorization.tool, rawArguments);
      if (!validation.ok) {
        return { kind: "error", code: JSON_RPC_INVALID_PARAMS, message: validation.reason };
      }

      const outcome = await executeMcpToolCall({
        authorization,
        args: validation.args,
        engine,
        sandbox: options.sandbox,
        traceId: stringMeta(params, "traceId"),
        correlationId: stringMeta(params, "correlationId"),
      });
      if (outcome.isError) {
        logger.warn(
          `tools/call falló etapa=${outcome.stage ?? "execution"} tool=${toolName} motivo=${outcome.text}`,
        );
        return {
          kind: "result",
          value: { content: [{ type: "text", text: outcome.text }], isError: true },
        };
      }
      logger.debug(`tools/call ejecutada tool=${toolName} status=${outcome.status ?? "executed"}`);
      return { kind: "result", value: { content: [{ type: "text", text: outcome.text }] } };
    }

    return {
      kind: "error",
      code: JSON_RPC_METHOD_NOT_FOUND,
      message: `Método desconocido '${request.method}'.`,
    };
  };

  const handleNotification = (method: string): void => {
    // Las notificaciones del cliente no generan respuesta (JSON-RPC).
    logger.debug(`Notificación MCP ignorada: ${method}`);
  };

  const server: IsabellaMcpServer = {
    get protocolVersion() {
      return protocolVersion;
    },

    async handleLine(line: string): Promise<void> {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      const parsed = parseJsonRpcMessage(trimmed);
      if (parsed.kind === "parse-error") {
        logger.warn("Línea MCP no parseable como JSON-RPC 2.0.");
        send(failure(null, JSON_RPC_PARSE_ERROR, "JSON inválido."));
        return;
      }
      if (parsed.kind === "invalid-request") {
        logger.warn(`Solicitud JSON-RPC inválida: ${parsed.reason}`);
        send(failure(parsed.id, JSON_RPC_INVALID_REQUEST, parsed.reason));
        return;
      }
      const message = parsed.message;
      if (!("method" in message)) {
        // Respuestas del cliente a peticiones del servidor: no aplican.
        logger.debug("Mensaje entrante tipo respuesta ignorado.");
        return;
      }
      if (!("id" in message)) {
        handleNotification(message.method);
        return;
      }
      if (!initialized && message.method !== "initialize" && message.method !== "ping") {
        send(
          failure(
            message.id,
            MCP_SERVER_NOT_INITIALIZED,
            "Servidor MCP no inicializado: envía 'initialize' antes de continuar.",
          ),
        );
        return;
      }
      try {
        const dispatched = await dispatch(message);
        if (dispatched.kind === "result") send(jsonRpcSuccess(message.id, dispatched.value));
        else send(failure(message.id, dispatched.code, dispatched.message));
      } catch (error) {
        logger.error(`Error interno en '${message.method}': ${String(error)}`);
        send(failure(message.id, JSON_RPC_INTERNAL_ERROR, "Error interno del servidor MCP."));
      }
    },

    async feed(chunk: Uint8Array | string): Promise<void> {
      const { lines, overflow } = decoder.push(chunk);
      if (overflow) {
        logger.warn("Línea MCP excede el tamaño máximo permitido (control de DoS).");
        send(failure(null, JSON_RPC_INVALID_REQUEST, "Línea excede el tamaño máximo permitido."));
      }
      for (const line of lines) await server.handleLine(line);
    },

    async run(): Promise<void> {
      for await (const chunk of input) {
        if (closed) return;
        await server.feed(chunk);
      }
    },

    close(): void {
      closed = true;
    },
  };

  return server;
}
