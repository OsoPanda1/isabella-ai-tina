/**
 * NODE VM EXECUTOR (src/lib/sandbox/node-vm-executor.ts)
 * -----------------------------------------------------------------
 * Ejecutor REAL de cómputo aislado para tareas JavaScript puras:
 *  - Contexto V8 congelado: solo `Math` y `JSON` (sin `process`,
 *    `require`, `fetch`, `console`, `setTimeout`, `eval`, `Function`).
 *  - Timeout de CPU enforced por `vm` (mata bucles infinitos).
 *  - Escaneo estático previo que rechaza import/require/process/eval.
 *  - Salida truncada a un máximo (anti-DoS de memoria).
 *
 * Límites honestos: aislamiento a nivel V8, NO contenedor OS. Para
 * cargas no-JS o críticas con egress, se deniega (fail-closed) y se
 * requiere un ejecutor de contenedores real.
 */

import vm from "node:vm";

export interface VmTask {
  /** Expresión JavaScript pura (se evalúa como expresión, sin sentencias). */
  code: string;
  /** Solo "javascript". Cualquier otro runtime se deniega. */
  language?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}

export interface VmResult {
  output: string;
  memoryConsumedBytes: number;
  gasTokensConsumed: number;
}

export const VM_DEFAULT_TIMEOUT_MS = 1000;
export const VM_MAX_TIMEOUT_MS = 2500;
export const VM_MAX_OUTPUT_CHARS = 4000;

const FORBIDDEN_STATIC: RegExp[] = [
  /\brequire\s*\(/,
  /\bimport\s*[(]/,
  /\bimport\s+.*\bfrom\b/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bchild_process\b/,
  /\bfs\b/,
  /\bDeno\b/,
  /\bBun\b/,
  /__proto__/,
  /\bconstructor\b/,
];

function staticRejectReason(code: string): string | null {
  for (const pattern of FORBIDDEN_STATIC) {
    pattern.lastIndex = 0;
    if (pattern.test(code)) return `Construcción prohibida en sandbox: ${pattern.source}.`;
  }
  return null;
}

function estimateGas(code: string, outputChars: number): number {
  return Math.min(1000, Math.ceil(code.length / 50) + Math.ceil(outputChars / 200));
}

/**
 * Ejecuta la tarea y retorna el resultado. Lanza Error con motivo
 * fail-closed si el código es rechazado, excede el timeout o falla.
 */
export async function runNodeVmTask(task: VmTask): Promise<VmResult> {
  const language = task.language ?? "javascript";
  if (language !== "javascript") {
    throw new Error(
      `Runtime no soportado en el ejecutor local: '${language}'. Solo 'javascript' puro (sin I/O).`,
    );
  }
  if (typeof task.code !== "string" || task.code.length === 0 || task.code.length > 20_000) {
    throw new Error("Código vacío o mayor a 20KB.");
  }
  const staticRejection = staticRejectReason(task.code);
  if (staticRejection) throw new Error(staticRejection);

  const timeoutMs = Math.min(
    Math.max(task.timeoutMs ?? VM_DEFAULT_TIMEOUT_MS, 50),
    VM_MAX_TIMEOUT_MS,
  );
  const maxOutput = task.maxOutputChars ?? VM_MAX_OUTPUT_CHARS;

  const sandbox: Record<string, unknown> = { Math, JSON };
  const context = vm.createContext(Object.freeze({ ...sandbox }));
  Object.freeze(sandbox);

  let raw: unknown;
  // Compila (valida sintaxis) y ejecuta con timeout enforced por V8
  // (el timeout vive en runInContext, no en ScriptOptions).
  try {
    const executable = new vm.Script(`"use strict";\n(${task.code}\n)`);
    raw = executable.runInContext(context, {
      timeout: timeoutMs,
      displayErrors: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out|Script execution timed out/i.test(message)) {
      throw new Error(`Timeout de CPU excedido (${timeoutMs}ms).`);
    }
    throw new Error(`Ejecución fallida: ${message.slice(0, 200)}`);
  }

  let output: string;
  if (typeof raw === "string") output = raw;
  else {
    try {
      output = JSON.stringify(raw) ?? "undefined";
    } catch {
      output = String(raw);
    }
  }
  if (output.length > maxOutput) output = `${output.slice(0, maxOutput)}…[truncado]`;
  return {
    output,
    memoryConsumedBytes: Buffer.byteLength(output, "utf8") + Buffer.byteLength(task.code, "utf8"),
    gasTokensConsumed: estimateGas(task.code, output.length),
  };
}

export const NODE_VM_EXECUTOR = {
  run: runNodeVmTask,
  limits: {
    defaultTimeoutMs: VM_DEFAULT_TIMEOUT_MS,
    maxTimeoutMs: VM_MAX_TIMEOUT_MS,
    maxOutputChars: VM_MAX_OUTPUT_CHARS,
  },
};
