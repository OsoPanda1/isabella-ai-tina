/**
 * Isabella Quantum Mesh — Quantum Scheduler & Queue (Núcleo 07)
 * Cola acotada con prioridades. Nunca acepta trabajo indefinidamente.
 * Sort: interactive > normal > batch, con FIFO dentro de cada prioridad.
 */
import { randomUUID } from "node:crypto";
import type { QuantumJob, QuantumRequest, JobPriority } from "./contracts";

const MAX_QUEUE = Number(process.env.QUANTUM_MAX_QUEUE || 64);

const PRIORITY_ORDER: Record<JobPriority, number> = {
  interactive: 0,
  normal: 1,
  batch: 2,
};

interface SchedulerMetrics {
  totalEnqueued: number;
  totalDequeued: number;
  totalExpired: number;
  totalRejected: number;
  currentDepth: number;
  peakDepth: number;
}

export class QuantumScheduler {
  private queue: QuantumJob[] = [];
  private metrics: SchedulerMetrics = {
    totalEnqueued: 0,
    totalDequeued: 0,
    totalExpired: 0,
    totalRejected: 0,
    currentDepth: 0,
    peakDepth: 0,
  };

  constructor(private readonly maxQueue: number = MAX_QUEUE) {}

  /**
   * Encola un job. Lanza error si la cola está llena.
   */
  enqueue(
    request: QuantumRequest,
    priority: JobPriority = "normal",
    deadlineMs: number = 30_000,
  ): QuantumJob {
    if (this.queue.length >= this.maxQueue) {
      this.metrics.totalRejected++;
      throw new Error("QUANTUM_QUEUE_FULL");
    }

    const now = Date.now();
    const job: QuantumJob = {
      jobId: randomUUID(),
      request,
      priority,
      deadlineAt: now + deadlineMs,
      cost: this.estimateCost(request),
      enqueuedAt: now,
      retryCount: 0,
    };

    this.queue.push(job);
    this.sortQueue();

    this.metrics.totalEnqueued++;
    this.metrics.currentDepth = this.queue.length;
    this.metrics.peakDepth = Math.max(this.metrics.peakDepth, this.metrics.currentDepth);

    return job;
  }

  /**
   * Obtiene el siguiente job válido (no expirado).
   */
  next(): QuantumJob | undefined {
    const now = Date.now();
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      if (job.deadlineAt > now) {
        this.metrics.totalDequeued++;
        this.metrics.currentDepth = this.queue.length;
        return job;
      }
      this.metrics.totalExpired++;
    }
    this.metrics.currentDepth = this.queue.length;
    return undefined;
  }

  /**
   * Re-encola un job fallido (retry con backoff).
   */
  requeue(job: QuantumJob): boolean {
    if (job.retryCount >= 3) return false;
    job.retryCount++;
    job.enqueuedAt = Date.now();
    job.deadlineAt = Date.now() + 30_000 * job.retryCount; // Backoff progresivo
    this.queue.push(job);
    this.sortQueue();
    this.metrics.currentDepth = this.queue.length;
    return true;
  }

  /**
   * Cancela un job por ID.
   */
  cancel(jobId: string): boolean {
    const idx = this.queue.findIndex((j) => j.jobId === jobId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    this.metrics.currentDepth = this.queue.length;
    return true;
  }

  /**
   * Limpia jobs expirados.
   */
  purgeExpired(): number {
    const now = Date.now();
    const before = this.queue.length;
    this.queue = this.queue.filter((j) => j.deadlineAt > now);
    const purged = before - this.queue.length;
    this.metrics.totalExpired += purged;
    this.metrics.currentDepth = this.queue.length;
    return purged;
  }

  /**
   * Estado actual de la cola.
   */
  status() {
    return {
      queued: this.queue.length,
      maxQueue: this.maxQueue,
      utilizationPercent: Math.round((this.queue.length / this.maxQueue) * 100),
      byPriority: {
        interactive: this.queue.filter((j) => j.priority === "interactive").length,
        normal: this.queue.filter((j) => j.priority === "normal").length,
        batch: this.queue.filter((j) => j.priority === "batch").length,
      },
      metrics: { ...this.metrics },
    };
  }

  /**
   * Estima costo computacional del request.
   */
  private estimateCost(request: QuantumRequest): number {
    let cost = request.wires * 0.1;
    if (request.shots !== null) cost += request.shots * 0.001;
    if (request.mode === "analytic") cost *= 1.5;
    return Math.round(cost * 100) / 100;
  }

  /**
   * Ordena la cola: interactive primero, luego normal, luego batch.
   * Dentro de cada prioridad, FIFO por enqueuedAt.
   */
  private sortQueue(): void {
    this.queue.sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.enqueuedAt - b.enqueuedAt,
    );
  }
}

// Singleton global
export const quantumScheduler = new QuantumScheduler();
