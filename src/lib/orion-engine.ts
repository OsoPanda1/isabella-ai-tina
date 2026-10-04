/**
 * ORION — ejecución Zero Trust. Toda ejecución exige herramienta registrada,
 * capability token firmado, identidad y tenant vinculados, y sandbox real.
 */
import { createHash } from "node:crypto";
import { createToolRegistry, type ToolRegistry } from "./tool-registry";
import { consumeCapabilityToken } from "./capability-token";
import { SovereignSandboxService, type ISandboxExecutionResult } from "./sovereign-sandbox";

export type OrionExecutionStatus = "executed" | "denied" | "error" | "timeout";
export interface OrionToolCall {
  toolName: string;
  args: Record<string, unknown>;
  traceId: string;
  correlationId: string;
  actorIp: string;
  actorId: string;
  tenantId: string;
  capabilityToken: string;
}
export interface OrionExecutionResult {
  status: OrionExecutionStatus;
  toolName: string;
  output: string;
  exitCode: number;
  executionTimeMs: number;
  verificationHash: string;
  traceId: string;
  error?: string;
}
function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function createOrionEngine(registry: ToolRegistry = createToolRegistry()) {
  return {
    listTools: () => registry.list(),
    checkTool: (name: string) => registry.check(name),
    async execute(
      call: OrionToolCall,
      sandbox?: SovereignSandboxService,
    ): Promise<OrionExecutionResult> {
      const startTime = Date.now();
      const check = registry.check(call.toolName);
      if (!check.allowed)
        return {
          status: "denied",
          toolName: call.toolName,
          output: "",
          exitCode: 403,
          executionTimeMs: 0,
          verificationHash: sha256(`denied|${call.toolName}|${call.traceId}`),
          traceId: call.traceId,
          error: check.reason,
        };
      try {
        consumeCapabilityToken(call.capabilityToken, {
          tool: call.toolName,
          actorId: call.actorId,
          tenantId: call.tenantId,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "capability_token_invalid";
        return {
          status: "denied",
          toolName: call.toolName,
          output: "",
          exitCode: 403,
          executionTimeMs: Date.now() - startTime,
          verificationHash: sha256(`capability_denied|${call.toolName}|${call.traceId}|${msg}`),
          traceId: call.traceId,
          error: msg,
        };
      }
      if (!sandbox)
        return {
          status: "error",
          toolName: call.toolName,
          output: "",
          exitCode: 503,
          executionTimeMs: Date.now() - startTime,
          verificationHash: sha256(`no_sandbox|${call.toolName}|${call.traceId}`),
          traceId: call.traceId,
          error: "Sin sandbox disponible: ejecución rechazada (fail-closed).",
        };
      try {
        const toolMeta = registry.lookup(call.toolName);
        const command = [typeof call.args.command === "string" ? call.args.command : call.toolName];
        const result: ISandboxExecutionResult = await sandbox.executeTask(
          command,
          {},
          JSON.stringify(call.args),
        );
        const duration = Date.now() - startTime;
        if (duration > (toolMeta?.maxTimeMs ?? 2500))
          return {
            status: "timeout",
            toolName: call.toolName,
            output: "",
            exitCode: 429,
            executionTimeMs: duration,
            verificationHash: sha256(`timeout|${call.toolName}|${call.traceId}`),
            traceId: call.traceId,
            error: `Tiempo máximo excedido: ${duration}ms.`,
          };
        return {
          status: "executed",
          toolName: call.toolName,
          output: result.output,
          exitCode: result.exitCode,
          executionTimeMs: result.executionTimeMs,
          verificationHash: result.cryptographicVerificationHash,
          traceId: call.traceId,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          status: "error",
          toolName: call.toolName,
          output: "",
          exitCode: 500,
          executionTimeMs: Date.now() - startTime,
          verificationHash: sha256(`error|${call.toolName}|${call.traceId}|${msg}`),
          traceId: call.traceId,
          error: msg,
        };
      }
    },
  };
}
export type OrionEngine = ReturnType<typeof createOrionEngine>;
export const ORION_ENGINE = { create: createOrionEngine };
