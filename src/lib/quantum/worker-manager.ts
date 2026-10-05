/**
 * Isabella Quantum Mesh — Worker Manager (Núcleo 08)
 * Gestión de workers aislados por pool.
 * Cada worker: usuario sin privilegios, sin Docker socket, filesystem temporal limitado.
 */
import { randomUUID } from "node:crypto";
import type { WorkerPool } from "./contracts";

export interface WorkerInstance {
  workerId: string;
  pool: WorkerPool;
  status: "idle" | "busy" | "stopped" | "error";
  pid: number | null;
  startedAt: string;
  lastHeartbeat: string;
  jobsCompleted: number;
  jobsFailed: number;
  imageDigest: string;
  manifestSignature: string;
}

interface WorkerPoolConfig {
  pool: WorkerPool;
  minInstances: number;
  maxInstances: number;
  maxCpus: number;
  maxMemoryMb: number;
  readOnlyRootFs: boolean;
  egressAllowList: string[];
}

const POOL_CONFIGS: WorkerPoolConfig[] = [
  {
    pool: "core",
    minInstances: 1,
    maxInstances: 4,
    maxCpus: 2,
    maxMemoryMb: 4096,
    readOnlyRootFs: true,
    egressAllowList: [],
  },
  {
    pool: "lightning",
    minInstances: 1,
    maxInstances: 4,
    maxCpus: 4,
    maxMemoryMb: 8192,
    readOnlyRootFs: true,
    egressAllowList: [],
  },
  {
    pool: "qiskit",
    minInstances: 0,
    maxInstances: 2,
    maxCpus: 2,
    maxMemoryMb: 4096,
    readOnlyRootFs: true,
    egressAllowList: ["*.ibm.com"],
  },
  {
    pool: "braket",
    minInstances: 0,
    maxInstances: 2,
    maxCpus: 2,
    maxMemoryMb: 4096,
    readOnlyRootFs: true,
    egressAllowList: ["*.amazonaws.com"],
  },
  {
    pool: "rigetti",
    minInstances: 0,
    maxInstances: 2,
    maxCpus: 2,
    maxMemoryMb: 4096,
    readOnlyRootFs: true,
    egressAllowList: ["*.rigetti.com"],
  },
  {
    pool: "catalyst",
    minInstances: 0,
    maxInstances: 1,
    maxCpus: 4,
    maxMemoryMb: 8192,
    readOnlyRootFs: true,
    egressAllowList: [],
  },
];

const activeWorkers = new Map<string, WorkerInstance>();
const workerMetrics = {
  totalSpawned: 0,
  totalKilled: 0,
  totalReplaced: 0,
};

/**
 * Obtiene la configuración de un pool de workers.
 */
export function getPoolConfig(pool: WorkerPool): WorkerPoolConfig | undefined {
  return POOL_CONFIGS.find((c) => c.pool === pool);
}

/**
 * Obtiene todos los workers activos de un pool.
 */
export function getWorkersByPool(pool: WorkerPool): WorkerInstance[] {
  return Array.from(activeWorkers.values()).filter((w) => w.pool === pool);
}

/**
 * Obtiene un worker por ID.
 */
export function getWorker(workerId: string): WorkerInstance | undefined {
  return activeWorkers.get(workerId);
}

/**
 * Registra un worker (simulado — en producción sería spawn real con container).
 */
export function registerWorker(
  pool: WorkerPool,
  imageDigest: string = "sha256:local",
): WorkerInstance {
  const config = getPoolConfig(pool);
  if (!config) throw new Error(`Unknown worker pool: ${pool}`);

  const current = getWorkersByPool(pool);
  if (current.length >= config.maxInstances) {
    throw new Error(`WORKER_POOL_FULL:${pool}`);
  }

  const worker: WorkerInstance = {
    workerId: `worker-${pool}-${randomUUID().slice(0, 8)}`,
    pool,
    status: "idle",
    pid: null,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    jobsCompleted: 0,
    jobsFailed: 0,
    imageDigest,
    manifestSignature: `manifest_${imageDigest.slice(0, 16)}_${Date.now()}`,
  };

  activeWorkers.set(worker.workerId, worker);
  workerMetrics.totalSpawned++;
  return worker;
}

/**
 * Marca un worker como ocupado.
 */
export function assignJob(workerId: string): boolean {
  const worker = activeWorkers.get(workerId);
  if (!worker || worker.status !== "idle") return false;
  worker.status = "busy";
  worker.lastHeartbeat = new Date().toISOString();
  return true;
}

/**
 * Libera un worker después de completar un job.
 */
export function releaseWorker(workerId: string, success: boolean): void {
  const worker = activeWorkers.get(workerId);
  if (!worker) return;
  worker.status = "idle";
  worker.lastHeartbeat = new Date().toISOString();
  if (success) {
    worker.jobsCompleted++;
  } else {
    worker.jobsFailed++;
  }
}

/**
 * Detiene un worker (kill).
 */
export function stopWorker(workerId: string): boolean {
  const worker = activeWorkers.get(workerId);
  if (!worker) return false;
  worker.status = "stopped";
  worker.pid = null;
  workerMetrics.totalKilled++;
  return true;
}

/**
 * Reemplaza un worker colgado.
 */
export function replaceWorker(workerId: string): WorkerInstance | null {
  const oldWorker = activeWorkers.get(workerId);
  if (!oldWorker) return null;

  oldWorker.status = "error";
  workerMetrics.totalReplaced++;

  const newWorker = registerWorker(oldWorker.pool, oldWorker.imageDigest);
  return newWorker;
}

/**
 * Heartbeat check: mata workers sin heartbeat por >60s.
 */
export function checkHeartbeats(): string[] {
  const now = Date.now();
  const killed: string[] = [];

  for (const [id, worker] of activeWorkers) {
    if (worker.status === "stopped" || worker.status === "error") continue;
    const lastBeat = new Date(worker.lastHeartbeat).getTime();
    if (now - lastBeat > 60_000) {
      worker.status = "error";
      worker.pid = null;
      killed.push(id);
    }
  }

  return killed;
}

/**
 * Estado completo de todos los workers.
 */
export function getWorkerStatus() {
  const all = Array.from(activeWorkers.values());
  return {
    total: all.length,
    idle: all.filter((w) => w.status === "idle").length,
    busy: all.filter((w) => w.status === "busy").length,
    stopped: all.filter((w) => w.status === "stopped").length,
    error: all.filter((w) => w.status === "error").length,
    byPool: Object.fromEntries(
      POOL_CONFIGS.map((c) => [
        c.pool,
        {
          config: c,
          active: getWorkersByPool(c.pool).length,
          workers: getWorkersByPool(c.pool),
        },
      ]),
    ),
    metrics: { ...workerMetrics },
  };
}

/**
 * Genera el docker-compose snippet para un pool de workers (documentación).
 */
export function generateWorkerComposeSnippet(pool: WorkerPool): string {
  const config = getPoolConfig(pool);
  if (!config) return "";

  return `services:
  quantum-worker-${pool}:
    image: registry.example/isabella/quantum-${pool}:latest
    read_only: ${config.readOnlyRootFs}
    user: "10001:10001"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    deploy:
      resources:
        limits:
          cpus: "${config.maxCpus}"
          memory: ${config.maxMemoryMb}M
    environment:
      QUANTUM_MAX_WIRES: "24"
      QUANTUM_MAX_SHOTS: "100000"
      QUANTUM_WORKER_POOL: "${pool}"`;
}
