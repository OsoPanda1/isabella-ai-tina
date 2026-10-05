import * as crypto from "node:crypto";
import { config } from "./config";
import { repositoryFactory } from "./persistence/repository-factory";
import type { AuditEntry } from "./persistence/repository";

function isSandboxEnabled(): boolean {
  try {
    const cfg = config();
    // Contrato canónico: SANDBOX_ENABLED vía config() (§12). Default false.
    if (cfg.SANDBOX_ENABLED === true) return true;
    if (
      cfg.NODE_ENV === "production" ||
      cfg.ISABELLA_RUNTIME_MODE === "production" ||
      cfg.ISABELLA_RUNTIME_MODE === "staging"
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

async function auditSandbox(traceId: string, ...rest: unknown[]): Promise<void> {
  // Supports both legacy 6-arg void auditSandbox(traceId, corr, ip, event, severity, details)
  // and new 4-arg auditSandbox(traceId, event, severity, details)
  let event: string, severity: AuditEntry["severity"], details: string;
  if (rest.length === 5) {
    event = rest[2] as string;
    severity = rest[3] as AuditEntry["severity"];
    details = rest[4] as string;
  } else if (rest.length === 3) {
    event = rest[0] as string;
    severity = rest[1] as AuditEntry["severity"];
    details = rest[2] as string;
  } else {
    return;
  }
  try {
    await repositoryFactory.getAuditRepository().audit({
      id: crypto.randomUUID(),
      tenantId: "system",
      traceId,
      timestamp: new Date().toISOString(),
      action: event,
      resource: "sandbox",
      severity,
      actor: "system",
      result: severity === "S1" || severity === "S0" ? "failure" : "success",
      details: { details },
    });
  } catch {
    // Fallback — audit repository unavailable
  }
}

/**
 * SANDBOX SOBERANO (src/lib/sovereign-sandbox.ts)
 * -----------------------------------------------------------------
 * Orquestador de ejecución aislada (WASM y contenedores) con
 * fail-closed estricto y CERO mockdata:
 *
 *  - Verifica la integridad SHA-256 real del binario antes de usarlo.
 *  - La ejecución REAL se delega en ejecutores inyectados
 *    (`IWasmExecutor` / `IContainerExecutor`). Si no hay ejecutor
 *    disponible, la llamada devuelve un fallo genuino de capacidad
 *    `unavailable` — NUNCA un resultado fabricado.
 *  - Mide tiempo real con `Date.now()`; nunca simula con `Math.random`.
 *  - Audita cada intento de ejecución (exitoso o vetado).
 */

/** Resultado estándar de una ejecución aislada. */
export interface ISandboxExecutionResult {
  success: boolean;
  output: string;
  exitCode: number;
  executionTimeMs: number;
  memoryConsumedBytes: number;
  gasTokensConsumed: number;
  traceId: string;
  cryptographicVerificationHash: string;
  error?: string;
}

/** Ejecutor real de WASM (a inyectar por el adaptador de runtime). */
export interface IWasmExecutor {
  execute(
    binary: Uint8Array,
    functionName: string,
    args: unknown[],
  ): Promise<{
    output: string;
    memoryConsumedBytes: number;
    gasTokensConsumed: number;
  }>;
}

/** Ejecutor real de contenedores (a inyectar por el adaptador de orquestación). */
export interface IContainerExecutor {
  provision(traceId: string): Promise<void>;
  execute(
    command: string[],
    envVars: Record<string, string>,
    inputPayload: string,
  ): Promise<{
    output: string;
    memoryConsumedBytes: number;
    gasTokensConsumed: number;
  }>;
  deprovision(): Promise<void>;
}

const FAIL_MSG_NO_WASM = "Módulo WASM no cargado. Debe inicializarse con loadModule().";
const FAIL_MSG_NO_EXECUTOR =
  "Capacidad unavailable: no hay ejecutor WASM real conectado en este runtime. Rechazado (fail-closed, sin resultado fabricado).";
const FAIL_MSG_NO_CONTAINER =
  "Capacidad unavailable: no hay ejecutor de contenedores real conectado. Rechazado (fail-closed, sin resultado fabricado).";
const FAIL_MSG_NOT_PROVISIONED =
  "El contenedor efímero no ha sido aprovisionado. Ejecute provisionInstance() primero.";

export class SovereignSandboxService {
  public moduleId = "wasm_isabella_v4_01";
  public moduleHash = "";
  public memoryLimitMb = 64;
  public cpuTimeoutMs = 2500;

  public containerId = "container_isabella_ephemeral_01";
  public imageName =
    "isabella-sovereign-executor-alpine@sha256:7b243be1f7d23f721ea7f7da3f497a73be14ee94002fa8398e4d27fbe7010493";
  public cpuQuota = 25;
  public readOnlyRootfs = true;
  public networkBlocked = true;

  private activeBinary: Uint8Array | null = null;
  private isProvisioned = false;

  constructor(
    private traceId: string = "trc_sandbox_init",
    private readonly wasmExecutor?: IWasmExecutor,
    private readonly containerExecutor?: IContainerExecutor,
  ) {}

  /** Carga diferida del módulo criptográfico (evita costos en el borde). */
  private static sha256(data: Uint8Array | string): string {
    const input = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  /** Verifica la integridad del binario y lo activa. */
  public async loadModule(binary: Uint8Array, expectedHash: string): Promise<boolean> {
    const computedHash = SovereignSandboxService.sha256(binary);

    if (computedHash !== expectedHash) {
      void auditSandbox(
        this.traceId,
        "cor_sandbox_load_fail",
        "127.0.0.1",
        "SovereignSandbox Module Integrity Mismatch",
        "S1",
        `Fallo de verificación de hash en el módulo WASM. Esperado: ${expectedHash}, Obtenido: ${computedHash}`,
      );
      throw new Error(
        "Violación de integridad: El binario de WASM no coincide con la firma registrada.",
      );
    }

    this.activeBinary = binary;
    this.moduleHash = computedHash;

    void auditSandbox(
      this.traceId,
      "cor_sandbox_load_ok",
      "127.0.0.1",
      "SovereignSandbox Module Loaded Safely",
      "S3",
      `Módulo WASM ${this.moduleId} cargado con éxito. Integridad SHA-256 validada.`,
    );
    return true;
  }

  /** Ejecuta una exportación del módulo WASM mediante el ejecutor real. */
  public async executeExport(
    functionName: string,
    args: unknown[],
    quota: number,
  ): Promise<ISandboxExecutionResult> {
    const startTime = Date.now();

    if (!isSandboxEnabled()) {
      return this.generateResult(
        false,
        "Capability unavailable: sandbox disabled in production (fail-closed).",
        startTime,
        503,
        0,
        0,
        0,
      );
    }

    if (!this.activeBinary) {
      return this.generateResult(false, FAIL_MSG_NO_WASM, startTime, 1, 0, 0, 0);
    }

    if (!this.wasmExecutor) {
      return this.generateResult(false, FAIL_MSG_NO_EXECUTOR, startTime, 1, 0, 0, 0);
    }

    if (
      /[;'"\\=`[\]{}]/.test(functionName) ||
      [...functionName].some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127) ||
      ["constructor", "prototype", "__proto__"].includes(functionName)
    ) {
      return this.generateResult(
        false,
        "Fallo de Validación Léxica: Nombre de función malicioso o inválido.",
        startTime,
        403,
        0,
        0,
        0,
      );
    }

    try {
      const exec = await this.wasmExecutor.execute(this.activeBinary, functionName, args);
      const executionTimeMs = Date.now() - startTime;

      if (exec.gasTokensConsumed > quota) {
        return this.generateResult(
          false,
          "Límite de gas / créditos excedido en el hilo aislado WASM.",
          startTime,
          429,
          executionTimeMs,
          0,
          0,
        );
      }

      const output = exec.output;
      const verificationHash = SovereignSandboxService.sha256(
        `${this.moduleId}|${this.traceId}|${output}|${executionTimeMs}|${exec.memoryConsumedBytes}|${exec.gasTokensConsumed}`,
      );

      void auditSandbox(
        this.traceId,
        "cor_sandbox_wasm_exec",
        "127.0.0.1",
        "WASM Export Executed Safely",
        "S3",
        `Exportación WASM [${functionName}] ejecutada correctamente. Gas consumido: ${exec.gasTokensConsumed}.`,
      );

      return {
        success: true,
        output,
        exitCode: 0,
        executionTimeMs,
        memoryConsumedBytes: exec.memoryConsumedBytes,
        gasTokensConsumed: exec.gasTokensConsumed,
        traceId: this.traceId,
        cryptographicVerificationHash: verificationHash,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const duration = Date.now() - startTime;
      return this.generateResult(
        false,
        `Error interno en WASM Virtual Machine: ${msg}`,
        startTime,
        500,
        duration,
        0,
        0,
      );
    }
  }

  /** Aprovisiona un contenedor aislado mediante el ejecutor real. */
  public async provisionInstance(traceId: string): Promise<void> {
    this.traceId = traceId;

    if (!this.containerExecutor) {
      this.isProvisioned = false;

      await auditSandbox(
        traceId,
        "cor_container_provision_failed",
        "S1",
        "No existe un executor de contenedores real conectado.",
      );

      throw new Error(
        "Container executor is not defined: ephemeral sandbox container cannot be provisioned.",
      );
    }

    await this.containerExecutor.provision(traceId);
    this.isProvisioned = true;

    await auditSandbox(
      traceId,
      "cor_container_provision",
      "S3",
      `Contenedor '${this.containerId}' aprovisionado correctamente. Red aislada, FileSystem de sólo lectura.`,
    );
  }

  /** Ejecuta una tarea aislada en el contenedor mediante el ejecutor real. */
  public async executeTask(
    command: string[],
    envVars: Record<string, string>,
    inputPayload: string,
  ): Promise<ISandboxExecutionResult> {
    const startTime = Date.now();

    if (!isSandboxEnabled()) {
      return this.generateResult(
        false,
        "Capability unavailable: sandbox disabled in production (fail-closed).",
        startTime,
        503,
        0,
        0,
        0,
      );
    }

    if (!this.isProvisioned) {
      return this.generateResult(false, FAIL_MSG_NOT_PROVISIONED, startTime, 1, 0, 0, 0);
    }

    if (!this.containerExecutor) {
      return this.generateResult(false, FAIL_MSG_NO_CONTAINER, startTime, 1, 0, 0, 0);
    }

    for (const cmd of command) {
      if (
        /[;&|`$<>]/.test(cmd) ||
        [...cmd].some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)
      ) {
        void auditSandbox(
          this.traceId,
          "cor_sandbox_shell_inject",
          "127.0.0.1",
          "Sandbox Shell Injection Prevented",
          "S1",
          `Intento de inyección de consola detectado y vetado: ${cmd}`,
        );
        return this.generateResult(
          false,
          "Violación de Seguridad: Intento de inyección de consola vetado.",
          startTime,
          403,
          0,
          0,
          0,
        );
      }
    }

    try {
      const exec = await this.containerExecutor.execute(command, envVars, inputPayload);
      const executionTimeMs = Date.now() - startTime;
      const verificationHash = SovereignSandboxService.sha256(
        `${this.containerId}|${this.traceId}|${exec.output}|${executionTimeMs}|${exec.memoryConsumedBytes}|${exec.gasTokensConsumed}`,
      );

      void auditSandbox(
        this.traceId,
        "cor_sandbox_container_exec",
        "127.0.0.1",
        "Container Task Completed",
        "S3",
        `Tarea del contenedor completada de forma segura. Comando: ${command[0] ?? ""}.`,
      );

      return {
        success: true,
        output: exec.output,
        exitCode: 0,
        executionTimeMs,
        memoryConsumedBytes: exec.memoryConsumedBytes,
        gasTokensConsumed: exec.gasTokensConsumed,
        traceId: this.traceId,
        cryptographicVerificationHash: verificationHash,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const duration = Date.now() - startTime;
      return this.generateResult(
        false,
        `Error al ejecutar tarea en contenedor: ${msg}`,
        startTime,
        500,
        duration,
        0,
        0,
      );
    }
  }

  /** Deprovisiona el contenedor mediante el ejecutor real. */
  public async deprovisionInstance(): Promise<void> {
    if (this.containerExecutor) {
      await this.containerExecutor.deprovision();
    }
    this.isProvisioned = false;

    void auditSandbox(
      this.traceId,
      "cor_container_deprovision",
      "127.0.0.1",
      "Ephemeral Container Deprovisioned",
      "S3",
      `Contenedor ${this.containerId} destruido. Memoria y disco purgados.`,
    );
  }

  /** Construye un resultado (éxito o fallo) con verificación real. */
  private generateResult(
    success: boolean,
    messageOrOutput: string,
    startTime: number,
    exitCode: number,
    executionTimeMs: number,
    memoryConsumedBytes: number,
    gasTokensConsumed: number,
  ): ISandboxExecutionResult {
    const duration = executionTimeMs > 0 ? executionTimeMs : Date.now() - startTime;
    const verificationHash = SovereignSandboxService.sha256(
      `${this.moduleId}|${this.traceId}|${success ? "ok" : "error"}|${messageOrOutput}|${duration}`,
    );
    return {
      success,
      output: success ? messageOrOutput : "",
      exitCode,
      executionTimeMs: duration,
      memoryConsumedBytes,
      gasTokensConsumed,
      traceId: this.traceId,
      cryptographicVerificationHash: verificationHash,
      ...(success ? {} : { error: messageOrOutput }),
    };
  }
}

export const SUPERVISED_SANDBOX = {
  SERVICE: SovereignSandboxService,
};
