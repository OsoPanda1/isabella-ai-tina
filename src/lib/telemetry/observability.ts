import { IsabellaCoreId, ISABELLA_MODULE_CATALOG, IsabellaModuleId } from "../latam-aegis-x";

export interface CoreTelemetryMetric {
  id: IsabellaCoreId;
  moduleId: IsabellaModuleId;
  status: "active" | "warning" | "error" | "restarting";
  memoryUsageBytes: number;
  stackDepth: number;
  temperatureCelsius: number;
  loadPercentage: number;
  errorCount: number;
}

export interface ObservabilitySnapshot {
  timestamp: string;
  throughput: number;
  avgLatencyMs: number;
  anomalyScore: number;
  totalEventsProcessed: number;
  incidentsCount: number;
  cores: Record<IsabellaCoreId, CoreTelemetryMetric>;
}

type TelemetryListener = (snapshot: ObservabilitySnapshot) => void;

export interface LatencyBudget {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sampleCount: number;
}

const LATENCY_SAMPLES = 512;

/**
 * Runtime observability state.
 *
 * This service deliberately contains no synthetic telemetry generator. Values
 * are zero/unknown until an actual runtime event records them. Infrastructure
 * metrics such as host CPU, RAM, temperature and Kubernetes nodes belong to an
 * external metrics provider and must not be fabricated in the application.
 */
class ObservabilityEngine {
  private currentSnapshot: ObservabilitySnapshot;
  private readonly listeners = new Set<TelemetryListener>();
  private readonly latencySamples: number[] = [];

  public getLatencyBudget(): LatencyBudget {
    const values = [...this.latencySamples].sort((a, b) => a - b);
    const percentile = (p: number) =>
      values.length === 0
        ? 0
        : values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]!;
    return {
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      sampleCount: values.length,
    };
  }

  constructor() {
    this.currentSnapshot = this.createEmptySnapshot();
  }

  private createEmptySnapshot(): ObservabilitySnapshot {
    const cores = {} as Record<IsabellaCoreId, CoreTelemetryMetric>;
    for (const [moduleId, metadata] of Object.entries(ISABELLA_MODULE_CATALOG)) {
      for (const coreId of metadata.cores) {
        cores[coreId] = {
          id: coreId,
          moduleId: moduleId as IsabellaModuleId,
          status: "warning",
          memoryUsageBytes: 0,
          stackDepth: 0,
          temperatureCelsius: 0,
          loadPercentage: 0,
          errorCount: 0,
        };
      }
    }
    return {
      timestamp: new Date().toISOString(),
      throughput: 0,
      avgLatencyMs: 0,
      anomalyScore: 0,
      totalEventsProcessed: 0,
      incidentsCount: 0,
      cores,
    };
  }

  private notifyListeners() {
    const snapshot = structuredClone(this.currentSnapshot);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error("Error invoking telemetry listener:", error);
      }
    }
  }

  public subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    listener(structuredClone(this.currentSnapshot));
    return () => this.listeners.delete(listener);
  }

  public getSnapshot(): ObservabilitySnapshot {
    return structuredClone(this.currentSnapshot);
  }

  /** Records a real observed application event; it does not generate events. */
  public recordEvent(latencyMs: number, score: number) {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error("invalid_latency");
    if (!Number.isFinite(score)) throw new Error("invalid_anomaly_score");
    const s = this.currentSnapshot;
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > LATENCY_SAMPLES) this.latencySamples.shift();
    const previousEvents = s.totalEventsProcessed;
    s.totalEventsProcessed += 1;
    s.avgLatencyMs =
      previousEvents === 0
        ? latencyMs
        : (s.avgLatencyMs * previousEvents + latencyMs) / s.totalEventsProcessed;
    s.anomalyScore =
      previousEvents === 0
        ? score
        : (s.anomalyScore * previousEvents + score) / s.totalEventsProcessed;
    s.timestamp = new Date().toISOString();
    this.notifyListeners();
  }

  /** Explicit state updates are only accepted from real runtime instrumentation. */
  public updateCoreTelemetry(
    coreId: IsabellaCoreId,
    telemetry: Partial<Omit<CoreTelemetryMetric, "id" | "moduleId">>,
  ) {
    const core = this.currentSnapshot.cores[coreId];
    if (!core) throw new Error(`unknown_core:${coreId}`);
    if (
      telemetry.memoryUsageBytes !== undefined &&
      (!Number.isFinite(telemetry.memoryUsageBytes) || telemetry.memoryUsageBytes < 0)
    )
      throw new Error("invalid_memory");
    if (
      telemetry.loadPercentage !== undefined &&
      (!Number.isFinite(telemetry.loadPercentage) ||
        telemetry.loadPercentage < 0 ||
        telemetry.loadPercentage > 100)
    )
      throw new Error("invalid_load");
    Object.assign(core, telemetry);
    this.currentSnapshot.timestamp = new Date().toISOString();
    this.notifyListeners();
  }

  public forceRestartCore(coreId: IsabellaCoreId) {
    this.updateCoreTelemetry(coreId, { status: "restarting" });
  }

  public flagCoreWarning(coreId: IsabellaCoreId, load: number, stack: number) {
    this.updateCoreTelemetry(coreId, {
      status: "warning",
      loadPercentage: load,
      stackDepth: stack,
    });
  }

  public flagCoreError(coreId: IsabellaCoreId, memory: number) {
    const core = this.currentSnapshot.cores[coreId];
    this.updateCoreTelemetry(coreId, {
      status: "error",
      memoryUsageBytes: memory,
      errorCount: core.errorCount + 1,
    });
  }

  public dispose() {
    // No background simulation/interval exists; nothing to dispose.
  }
}

export const ObservabilityService = new ObservabilityEngine();
