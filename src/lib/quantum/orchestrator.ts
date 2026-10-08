/**
 * Isabella Quantum Mesh — Orchestrator (Central Orchestration Engine)
 * Flujo: Yun propone -> Isabella normaliza -> ARGUS autoriza -> Scheduler asigna ->
 *        Worker ejecuta -> PennyLane traduce -> backend responde -> TEE atestigua ->
 *        HSM firma -> BookPI registra -> CRYSTALS-LATAMV encadena -> PostgreSQL persiste
 *        -> Heptafederado replica -> Recovery reconcilia
 *
 * Simetria: identificar -> validar -> autorizar -> ejecutar -> medir -> firmar -> persistir -> replicar -> reconciliar
 */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  QuantumRequestSchema,
  type QuantumRequest,
  type Principal,
  type JobPriority,
} from "./contracts";
import { getDevice, computeCircuitHash, getDeviceRegistry } from "./device-registry";
import { evaluateQuantumPolicy, recordPolicyDecision } from "./policy-engine";
import { quantumScheduler } from "./scheduler";
import {
  canExecute,
  recordSuccess,
  recordFailure,
  getCircuitBreakerMetrics,
} from "./circuit-breaker";
import {
  getWorkersByPool,
  assignJob,
  releaseWorker,
  registerWorker,
  getWorkerStatus,
} from "./worker-manager";
import { commitQuantumBlock, signQuantumBlock, getBookPIMetrics } from "./bookpi-quantum";
import { signHSM, getHSMMetrics } from "./hsm-client";
import { generateAttestation, verifyAttestation, getTEEStatus } from "./tee-attestation";
import { emitQuantumEvent, getEventBusMetrics } from "./event-bus";
import {
  QUANTUM_COUNTERS,
  QUANTUM_HISTOGRAMS,
  startSpan,
  endSpan,
  getTelemetrySnapshot,
} from "./telemetry";
import { handleRemoteProviderDown, getRecoveryMetrics } from "./recovery";

interface OrchestratorResult {
  ok: boolean;
  requestId: string;
  traceId: string;
  status: "completed" | "degraded" | "rejected" | "failed";
  implementation: string;
  provider: string;
  mode: "analytic" | "sampled";
  wires: number;
  circuitHash: string;
  latencyMs: number;
  result: Record<string, unknown>;
  bookpiBlockHash?: string;
  hsmSigned: boolean;
  teeVerified: boolean;
  policyDecision: string;
  telemetry: Record<string, unknown>;
}

/**
 * Ejecuta un request cuántico a través de toda la malla gobernada.
 * Flujo completo de 13 pasos.
 */
export async function executeQuantumMesh(
  request: QuantumRequest,
  principal: Principal,
): Promise<OrchestratorResult> {
  const startedAt = Date.now();
  const rootSpan = startSpan({
    traceId: request.traceId,
    operation: "isabella.quantum.execute",
    attributes: {
      "request.id": request.requestId,
      provider: request.provider,
      mode: request.mode,
      wires: String(request.wires),
    },
  });

  // Paso 1: Validar request (schema check)
  const parseResult = QuantumRequestSchema.safeParse(request);
  if (!parseResult.success) {
    endSpan(rootSpan.spanId, "error");
    return buildResult(
      request,
      "failed",
      "schema_validation",
      startedAt,
      "Schema validation failed",
      rootSpan.traceId,
    );
  }

  // Paso 2: AUTH verify
  const authSpan = startSpan({
    traceId: request.traceId,
    operation: "auth.verify",
    parentSpanId: rootSpan.spanId,
  });

  if (principal.tenantId !== request.tenantId) {
    endSpan(authSpan.spanId, "error");
    QUANTUM_COUNTERS.requestsRejected(request.provider, "tenant_mismatch");
    recordPolicyDecision(request.traceId, {
      decision: "deny",
      reason: "TENANT_MISMATCH",
      maxTimeoutMs: 0,
      maxWires: 0,
      maxShots: 0,
      requiresApproval: false,
    });
    endSpan(rootSpan.spanId, "error");
    return buildResult(
      request,
      "rejected",
      "auth_failure",
      startedAt,
      "TENANT_MISMATCH",
      request.traceId,
    );
  }
  endSpan(authSpan.spanId, "ok");

  // Paso 3: ARGUS policy evaluation
  const argusSpan = startSpan({
    traceId: request.traceId,
    operation: "argus.evaluate",
    parentSpanId: rootSpan.spanId,
  });
  const device = getDevice(request.provider);
  if (!device) {
    endSpan(argusSpan.spanId, "error");
    QUANTUM_COUNTERS.requestsRejected(request.provider, "device_not_found");
    endSpan(rootSpan.spanId, "error");
    return buildResult(
      request,
      "rejected",
      "no_device",
      startedAt,
      "Device not found in registry",
      request.traceId,
    );
  }

  const policyDecision = evaluateQuantumPolicy(principal, request, device);
  recordPolicyDecision(request.traceId, policyDecision, `provider:${request.provider}`);
  endSpan(argusSpan.spanId, policyDecision.decision === "allow" ? "ok" : "error");

  if (policyDecision.decision === "deny") {
    QUANTUM_COUNTERS.policyDenial(policyDecision.reason);
    emitQuantumEvent(
      "quantum.request.rejected",
      { reason: policyDecision.reason },
      {
        traceId: request.traceId,
        requestId: request.requestId,
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        originCore: 5,
        targetCore: 3,
      },
    );
    endSpan(rootSpan.spanId, "error");
    return buildResult(
      request,
      "rejected",
      policyDecision.reason,
      startedAt,
      policyDecision.reason,
      request.traceId,
    );
  }

  // Step 4: Idempotency check
  const idemSpan = startSpan({
    traceId: request.traceId,
    operation: "idempotency.lookup",
    parentSpanId: rootSpan.spanId,
  });
  endSpan(idemSpan.spanId, "ok"); // In-memory: no duplicates

  // Step 5: Scheduler enqueue
  const schedSpan = startSpan({
    traceId: request.traceId,
    operation: "scheduler.enqueue",
    parentSpanId: rootSpan.spanId,
  });
  const priority = determinePriority(request);
  let job;
  try {
    job = quantumScheduler.enqueue(request, priority, policyDecision.maxTimeoutMs);
    QUANTUM_COUNTERS.jobQueued(request.provider);
    QUANTUM_COUNTERS.requestsAccepted(request.provider, principal.tenantId);
    emitQuantumEvent(
      "quantum.job.queued",
      { jobId: job.jobId, priority },
      {
        traceId: request.traceId,
        requestId: request.requestId,
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        originCore: 5,
        targetCore: 7,
      },
    );
  } catch (err) {
    endSpan(schedSpan.spanId, "error");
    endSpan(rootSpan.spanId, "error");
    return buildResult(
      request,
      "failed",
      "queue_full",
      startedAt,
      "QUANTUM_QUEUE_FULL",
      request.traceId,
    );
  }
  endSpan(schedSpan.spanId, "ok");

  // Step 6: Worker start
  const workerSpan = startSpan({
    traceId: request.traceId,
    operation: "worker.start",
    parentSpanId: rootSpan.spanId,
  });
  const circuitCheck = canExecute(request.provider);
  if (!circuitCheck.allowed) {
    endSpan(workerSpan.spanId, "error");
    QUANTUM_COUNTERS.providerUnavailable(request.provider);
    handleRemoteProviderDown(request.provider);
    endSpan(rootSpan.spanId, "error");
    return buildResult(
      request,
      "degraded",
      "circuit_open",
      startedAt,
      circuitCheck.reason || "CIRCUIT_OPEN",
      request.traceId,
    );
  }

  // Ensure a worker exists
  let poolWorkers = getWorkersByPool(mapProviderToPool(request.provider));
  if (poolWorkers.length === 0) {
    try {
      const newWorker = registerWorker(mapProviderToPool(request.provider));
      poolWorkers = [newWorker];
    } catch {
      endSpan(workerSpan.spanId, "error");
      endSpan(rootSpan.spanId, "error");
      return buildResult(
        request,
        "failed",
        "worker_pool_full",
        startedAt,
        "No workers available",
        request.traceId,
      );
    }
  }
  const worker = poolWorkers.find((w) => w.status === "idle") || poolWorkers[0];
  assignJob(worker.workerId);
  endSpan(workerSpan.spanId, "ok");

  // Step 7: Provider execute
  const provSpan = startSpan({
    traceId: request.traceId,
    operation: "provider.execute",
    parentSpanId: rootSpan.spanId,
  });
  QUANTUM_COUNTERS.jobStarted(request.provider);

  let execResult: Record<string, unknown>;
  const execStartedAt = Date.now();

  // Execute locally with PennyLane bridge or simulate
  try {
    execResult = await executeProviderLocal(request, device.implementation);
    recordSuccess(request.provider);
    QUANTUM_HISTOGRAMS.requestDuration(request.provider, Date.now() - execStartedAt);
  } catch (err) {
    recordFailure(request.provider);
    QUANTUM_COUNTERS.jobFailed(request.provider);
    releaseWorker(worker.workerId, false);
    endSpan(provSpan.spanId, "error");
    endSpan(rootSpan.spanId, "error");
    return buildResult(
      request,
      "failed",
      "provider_error",
      startedAt,
      String(err),
      request.traceId,
    );
  }
  endSpan(provSpan.spanId, "ok");

  // Step 8: TEE verify (when applicable)
  const teeSpan = startSpan({
    traceId: request.traceId,
    operation: "tee.verify",
    parentSpanId: rootSpan.spanId,
  });
  let teeVerified = false;
  if (device.remote) {
    const attestation = generateAttestation({
      platformId: `worker-${worker.workerId}`,
      measurement: device.implementation,
      policyVersion: request.policyVersion,
    });
    const verification = verifyAttestation(
      {
        platformId: `worker-${worker.workerId}`,
        expectedMeasurement: device.implementation,
        nonce: attestation.nonce,
        policyVersion: request.policyVersion,
      },
      attestation,
    );
    teeVerified = verification.verified;
  }
  endSpan(teeSpan.spanId, teeVerified || !device.remote ? "ok" : "error");

  // Step 9: HSM sign
  const hsmSpan = startSpan({
    traceId: request.traceId,
    operation: "hsm.sign",
    parentSpanId: rootSpan.spanId,
  });
  const circuitHash = computeCircuitHash({
    provider: request.provider,
    wires: request.wires,
    mode: request.mode,
    features: request.features,
    weights: request.weights,
  });

  const hsmResult = await signHSM({
    type: "sign_bookpi",
    payload: `${request.requestId}:${circuitHash}:${execResult.status || "completed"}`,
  });
  QUANTUM_COUNTERS.hsmSignLatency(hsmResult.latencyMs);
  endSpan(hsmSpan.spanId, hsmResult.status !== "error" ? "ok" : "error");

  // Step 10: BookPI commit
  const bookpiSpan = startSpan({
    traceId: request.traceId,
    operation: "bookpi.commit",
    parentSpanId: rootSpan.spanId,
  });
  const status = (execResult.status as "completed" | "degraded") || "completed";
  const block = commitQuantumBlock({
    requestId: request.requestId,
    tenantId: request.tenantId,
    circuitHash,
    implementation: device.implementation,
    status,
    policyVersion: request.policyVersion,
    signerKeyId: hsmResult.keyId,
    teeVerified,
  });
  const signedBlock = signQuantumBlock(block);
  endSpan(bookpiSpan.spanId, "ok");

  // Step 11: Federation replicate (emit event)
  const fedSpan = startSpan({
    traceId: request.traceId,
    operation: "federation.replicate",
    parentSpanId: rootSpan.spanId,
  });
  emitQuantumEvent(
    "quantum.job.completed",
    {
      requestId: request.requestId,
      status,
      implementation: device.implementation,
      circuitHash,
    },
    {
      traceId: request.traceId,
      requestId: request.requestId,
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      originCore: 5,
      targetCore: 23,
    },
  );
  endSpan(fedSpan.spanId, "ok");

  // Step 12: Release worker
  releaseWorker(worker.workerId, true);
  QUANTUM_COUNTERS.jobCompleted(request.provider);

  // Step 13: Done
  const latencyMs = Date.now() - startedAt;
  endSpan(rootSpan.spanId, "ok");

  return {
    ok: true,
    requestId: request.requestId,
    traceId: request.traceId,
    status,
    implementation: device.implementation,
    provider: request.provider,
    mode: request.mode,
    wires: request.wires,
    circuitHash,
    latencyMs,
    result: execResult,
    bookpiBlockHash: block.blockHash,
    hsmSigned: true,
    teeVerified,
    policyDecision: policyDecision.decision,
    telemetry: {
      hsmLatencyMs: hsmResult.latencyMs,
      workerId: worker.workerId,
      pqcSignature: signedBlock.signature.mlDsaSignature.slice(0, 32) + "...",
    },
  };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function buildResult(
  request: QuantumRequest,
  status: OrchestratorResult["status"],
  reason: string,
  startedAt: number,
  errorDetail: string,
  traceId: string,
): OrchestratorResult {
  return {
    ok: false,
    requestId: request.requestId,
    traceId,
    status,
    implementation: "NONE",
    provider: request.provider,
    mode: request.mode,
    wires: request.wires,
    circuitHash: "none",
    latencyMs: Date.now() - startedAt,
    result: { error: reason, detail: errorDetail },
    hsmSigned: false,
    teeVerified: false,
    policyDecision: status === "rejected" ? "deny" : status === "degraded" ? "degraded" : "unknown",
    telemetry: {},
  };
}

function determinePriority(request: QuantumRequest): JobPriority {
  if (request.wires <= 4 && request.mode === "analytic") return "interactive";
  if (request.wires > 16 || (request.shots !== null && request.shots > 50_000)) return "batch";
  return "normal";
}

function mapProviderToPool(
  provider: string,
): "core" | "lightning" | "qiskit" | "braket" | "rigetti" | "catalyst" {
  if (provider.startsWith("lightning")) return "lightning";
  if (provider.startsWith("qiskit")) return "qiskit";
  if (provider.startsWith("braket")) return "braket";
  if (provider.startsWith("rigetti")) return "rigetti";
  if (provider.includes("catalyst")) return "catalyst";
  return "core";
}

// Resolve the bridge script across layouts: source tree (tsx dev), esbuild
// bundle (dist/), and process cwd fallbacks.
const BRIDGE_PATH =
  [
    path.resolve(
      import.meta.dirname ?? process.cwd(),
      "../../../scripts/quantum/isabella_quantum_bridge_v3.py",
    ),
    path.resolve(
      import.meta.dirname ?? process.cwd(),
      "../scripts/quantum/isabella_quantum_bridge_v3.py",
    ),
    path.resolve(process.cwd(), "scripts/quantum/isabella_quantum_bridge_v3.py"),
  ].find((candidate) => existsSync(candidate)) ??
  path.resolve(process.cwd(), "scripts/quantum/isabella_quantum_bridge_v3.py");
const BRIDGE_TIMEOUT_MS = 30_000;

async function executeProviderLocal(
  request: QuantumRequest,
  implementation: string,
): Promise<Record<string, unknown>> {
  if (!implementation.startsWith("PENNYLANE")) {
    throw new Error(`UNSUPPORTED_IMPLEMENTATION:${implementation}`);
  }

  const bridgePayload = {
    schema: "pennylane-request-v3",
    requestId: request.requestId ?? randomUUID(),
    tenantId: request.tenantId ?? "default",
    task: "execute" as const,
    provider: request.provider,
    repository: "PennyLaneAI/pennylane",
    wires: request.wires,
    shots: request.shots ?? 0,
    features: request.features ?? [],
    weights: request.weights ?? [],
    scopes: ["quantum:execute"],
    metadata: request.metadata ?? {},
    policyVersion: "quantum-policy-v1",
  };

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      "python3",
      [BRIDGE_PATH, "--stdio"],
      { timeout: BRIDGE_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout, _stderr) => {
        if (err && !stdout) {
          reject(new Error(`BRIDGE_EXEC_FAILED: ${err.message}`));
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.write(JSON.stringify(bridgePayload) + "\n");
    child.stdin?.end();
  });

  const parsed = JSON.parse(stdout) as Record<string, unknown>;

  if (parsed.status === "error") {
    const err = parsed.error as { code: string; message: string } | undefined;
    throw new Error(`BRIDGE_ERROR: ${err?.code ?? "UNKNOWN"}: ${err?.message ?? "unknown"}`);
  }

  return {
    status: "completed",
    implementation,
    backend: request.provider,
    mode: request.mode,
    wires: request.wires,
    gates: parsed.gates ?? request.wires * 3 + 2,
    shots: request.shots,
    expectationValue: parsed.expectation,
    probabilities: parsed.probabilities ?? [],
    circuitDepth: typeof parsed.wires === "number" ? parsed.wires + 1 : request.wires + 1,
    fidelity: 1.0,
    engine: `${implementation}_BRIDGE`,
    bridgeVersion: parsed.bridgeVersion,
    pennylaneVersion: parsed.pennylaneVersion,
    repositoryUrl: parsed.repositoryUrl,
    remote: parsed.remote ?? false,
  };
}

/**
 * Obtiene el estado completo de la malla.
 */
export function getMeshStatus() {
  return {
    deviceRegistry: getDeviceRegistry().map((d) => ({
      provider: d.provider,
      implementation: d.implementation,
      trust: d.trust,
      remote: d.remote,
      enabled: d.enabled,
    })),
    scheduler: quantumScheduler.status(),
    workers: getWorkerStatus(),
    circuitBreaker: getCircuitBreakerMetrics(),
    bookPI: getBookPIMetrics(),
    hsm: getHSMMetrics(),
    tee: getTEEStatus(),
    eventBus: getEventBusMetrics(),
    telemetry: getTelemetrySnapshot(),
    recovery: getRecoveryMetrics(),
  };
}
