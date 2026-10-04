import { spawn } from "node:child_process";
import path from "node:path";
import { config, passthroughChildEnv } from "./config";

export interface QuantumBridgePayload {
  schema: "pennylane-request-v5";
  requestId: string;
  tenantId: string;
  task: "execute" | "diagnose";
  provider: string;
  wires: number;
  features: number[];
  weights: number[];
  scopes: string[];
  shots?: number;
  ansatz?: string;
  policyVersion?: string;
  nonce: string;
  timestamp: string;
}

export interface QuantumBridgeResponse {
  schema?: string;
  status: "ok" | "degraded" | "error";
  implementation: string;
  requestId: string;
  tenantId?: string;
  provider?: string;
  expectation?: number;
  determinedEpistemicState?: string;
  requestHash?: string;
  error?: { code: string; message: string; federation: string; retryable: boolean };
  fallback?: { reason: string; confidenceAdjustment: number; requiresReview: boolean };
  telemetry?: { totalRuntimeMs: number; spans: Array<{ name: string; durationMs: number }> };
}

export interface QuantumDispatchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_STDOUT = 4_194_304;

export class QuantumBridgeClient {
  constructor(
    private readonly pythonPath = config().PYTHON_PATH ?? "python3",
    private readonly scriptPath = config().QUANTUM_BRIDGE_PATH ??
      path.resolve(process.cwd(), "scripts", "quantum", "isabella_quantum_bridge_v5.py"),
  ) {}

  dispatch(
    payload: QuantumBridgePayload,
    options: QuantumDispatchOptions = {},
  ): Promise<QuantumBridgeResponse> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxStdout = Number(config().QUANTUM_BRIDGE_MAX_STDOUT_BYTES ?? DEFAULT_MAX_STDOUT);

    return new Promise((resolve, reject) => {
      // Zero-Trust: allowlist mínima — nunca propagar DATABASE_URL / AUTH_JWT_SECRET al hijo Python
      const allowEnv: NodeJS.ProcessEnv = {
        ...passthroughChildEnv(),
        PYTHON_PATH: config().PYTHON_PATH,
        QUANTUM_BRIDGE_PATH: config().QUANTUM_BRIDGE_PATH,
      };
      const child = spawn(this.pythonPath, [this.scriptPath, "--stdio"], {
        env: allowEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abortHandler);
        fn();
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(() => reject(new Error(`Quantum Bridge timeout: ${payload.requestId}`)));
      }, timeoutMs);
      const abortHandler = () => {
        child.kill("SIGTERM");
        finish(() => reject(new Error(`Solicitud cancelada: ${payload.requestId}`)));
      };

      options.signal?.addEventListener("abort", abortHandler, { once: true });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > maxStdout) {
          child.kill("SIGTERM");
          finish(() => reject(new Error("Respuesta del bridge demasiado grande")));
        }
      });
      child.stderr.on("data", (chunk: string) => {
        if (Buffer.byteLength(stderr) < 16_384) stderr += chunk;
      });
      child.on("error", (error) => finish(() => reject(error)));
      child.on("close", (code) => {
        if (settled) return;
        if (!stdout.trim()) {
          finish(() => reject(new Error(`Bridge sin respuesta (code=${code}): ${stderr}`)));
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as QuantumBridgeResponse;
          finish(() => resolve(parsed));
        } catch (error) {
          finish(() => reject(new Error(`JSON inválido del bridge: ${String(error)}`)));
        }
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }
}
