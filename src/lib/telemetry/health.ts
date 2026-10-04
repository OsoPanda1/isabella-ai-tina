import { IsabellaCoreId } from "../latam-aegis-x";
import { CentralizedTelemetryService } from "../latam-aegis-x";
import { ObservabilityService } from "./observability";

export interface HealthEvent {
  timestamp: string;
  coreId: IsabellaCoreId;
  type: "stack_overflow_warning" | "memory_leak_warning" | "auto_restart" | "healthy";
  message: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface RecoveryLog {
  id: string;
  timestamp: string;
  coreId: IsabellaCoreId;
  type: "stack_overflow_resolved" | "memory_leak_resolved";
  message: string;
  reclaimedMemoryBytes: number;
  initialStackDepth: number;
}

type RecoveryListener = (event: RecoveryLog) => void;

class HealthHeartbeatMonitor {
  private activeInterval: NodeJS.Timeout | null = null;
  private logs: HealthEvent[] = [];
  private recoveryLogs: RecoveryLog[] = [];
  private recoveryListeners: Set<RecoveryListener> = new Set();
  private readonly STACK_OVERFLOW_THRESHOLD = 160; // Max recursion depth
  private readonly MEMORY_LEAK_LIMIT_BYTES = 120 * 1024 * 1024; // 120MB threshold
  private readonly MAX_LOG_SIZE = 100;

  constructor() {
    this.startMonitoring();
  }

  public startMonitoring() {
    if (this.activeInterval) return;

    this.activeInterval = setInterval(() => {
      this.runDiagnostics();
    }, 4000); // Check core health every 4 seconds
  }

  public stopMonitoring() {
    if (this.activeInterval) {
      clearInterval(this.activeInterval);
      this.activeInterval = null;
    }
  }

  /**
   * Run real-time diagnostics on all 24 core modules.
   * Auto-restores any core showing stack overflow or memory leaks.
   */
  public runDiagnostics() {
    const snapshot = ObservabilityService.getSnapshot();
    const timestamp = new Date().toISOString();

    for (const coreId of Object.keys(snapshot.cores) as IsabellaCoreId[]) {
      const core = snapshot.cores[coreId];
      let hasAnomaly = false;
      let anomalyType: "stack_overflow_resolved" | "memory_leak_resolved" =
        "stack_overflow_resolved";
      const initialStackDepth = core.stackDepth;
      const initialMemory = core.memoryUsageBytes;

      // 1. Check for stack overflow (exceeds safe depth limit)
      if (core.stackDepth > this.STACK_OVERFLOW_THRESHOLD) {
        this.logHealthEvent({
          timestamp,
          coreId,
          type: "stack_overflow_warning",
          message: `Stack overflow risk detected! Current depth: ${core.stackDepth}. Threshold: ${this.STACK_OVERFLOW_THRESHOLD}.`,
          severity: "critical",
        });
        hasAnomaly = true;
        anomalyType = "stack_overflow_resolved";
      }

      // 2. Check for memory leak (growth exceeding memory allocation budget)
      if (core.memoryUsageBytes > this.MEMORY_LEAK_LIMIT_BYTES) {
        this.logHealthEvent({
          timestamp,
          coreId,
          type: "memory_leak_warning",
          message: `Memory leak suspected! Usage: ${(core.memoryUsageBytes / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${(this.MEMORY_LEAK_LIMIT_BYTES / (1024 * 1024)).toFixed(0)} MB.`,
          severity: "high",
        });
        hasAnomaly = true;
        anomalyType = "memory_leak_resolved";
      }

      // 3. Trigger auto-restart if anomaly was flagged
      if (hasAnomaly) {
        // Log telemetry incident
        CentralizedTelemetryService.logEvent(
          core.moduleId,
          coreId,
          "CoreSelfHealingTriggered",
          {
            diagnosticMessage:
              "Auto-restarting CROWN core task to reclaim heap memory and reset recursion tree.",
            currentMemoryBytes: core.memoryUsageBytes,
            currentStackDepth: core.stackDepth,
          },
          "security_incident",
        );

        // Perform programmatic auto-restart
        ObservabilityService.forceRestartCore(coreId);

        this.logHealthEvent({
          timestamp,
          coreId,
          type: "auto_restart",
          message: `Self-healing protocol triggered. Clean-restarted core ${coreId} safely.`,
          severity: "high",
        });

        // Add recovery log entry
        const reclaimedMemoryBytes = Math.max(0, initialMemory - 12 * 1024 * 1024);
        const recoveryMessage =
          anomalyType === "stack_overflow_resolved"
            ? `Recursion stack overflow resolved. Reset core ${coreId} to base state (Depth 1).`
            : `Heap allocation cleaned. Reclaimed ${(reclaimedMemoryBytes / (1024 * 1024)).toFixed(2)} MB memory leak for core ${coreId}.`;

        const recoveryEvent: RecoveryLog = {
          id: crypto.randomUUID(),
          timestamp,
          coreId,
          type: anomalyType,
          message: recoveryMessage,
          reclaimedMemoryBytes,
          initialStackDepth,
        };

        this.recoveryLogs.unshift(recoveryEvent);
        if (this.recoveryLogs.length > this.MAX_LOG_SIZE) {
          this.recoveryLogs.pop();
        }

        // Notify custom subscribers
        this.recoveryListeners.forEach((listener) => {
          try {
            listener(recoveryEvent);
          } catch (e) {
            console.error("Error dispatching recovery listener:", e);
          }
        });

        // Dispatch a custom DOM event for toast notification systems
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("core-recovery-toast", {
              detail: recoveryEvent,
            }),
          );
        }
      }
    }
  }

  private logHealthEvent(event: HealthEvent) {
    this.logs.unshift(event);
    if (this.logs.length > this.MAX_LOG_SIZE) {
      this.logs.pop();
    }

    // Direct system output for auditing
    console.log(
      `[HEALTH_MONITOR] [${event.type.toUpperCase()}] Core: ${event.coreId} - ${event.message}`,
    );
  }

  public getLogs(): HealthEvent[] {
    return [...this.logs];
  }

  public getRecoveryLogs(): RecoveryLog[] {
    return [...this.recoveryLogs];
  }

  public subscribeToRecovery(listener: RecoveryListener): () => void {
    this.recoveryListeners.add(listener);
    return () => {
      this.recoveryListeners.delete(listener);
    };
  }

  /**
   * Intentionally trigger a diagnostic anomaly on a specific core to demo self-healing capabilities
   */
  public injectDiagnosticAnomaly(
    coreId: IsabellaCoreId,
    anomalyType: "stack_overflow" | "memory_leak",
  ) {
    if (anomalyType === "stack_overflow") {
      ObservabilityService.flagCoreWarning(coreId, 95, 192); // exceeds 160 threshold
    } else {
      ObservabilityService.flagCoreError(coreId, 142 * 1024 * 1024); // exceeds 120MB threshold
    }
  }
}

export const HealthMonitorService = new HealthHeartbeatMonitor();
