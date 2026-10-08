/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — HEALTH MONITOR
 * Continuous health monitoring for all 12 core modules + BookPI.
 * Tracks heartbeats, detects failures, triggers auto-recovery.
 * Alert levels: GREEN → YELLOW → ORANGE → RED → CRITICAL.
 * ================================================================
 */
import { randomUUID } from "node:crypto";
import { emitQuantumEvent } from "../../lib/quantum/event-bus";
import { auditTrace } from "../../domains/ai/infrastructure/audit-tracer";
import type { IngressRoute } from "./ingress-distributor";

/* =========================================================================
   TYPES
   ========================================================================= */

export type AlertLevel = "green" | "yellow" | "orange" | "red" | "critical";

export interface ModuleHealth {
  readonly moduleId: IngressRoute | "bookpi-legacy";
  readonly alertLevel: AlertLevel;
  readonly lastHeartbeat: string;
  readonly lastCheck: string;
  readonly consecutiveFailures: number;
  readonly totalFailures: number;
  readonly totalRecoveries: number;
  readonly avgResponseMs: number;
  readonly uptime: number;
  readonly recoveryAttempts: number;
  readonly lastRecoveryAttempt?: string;
  readonly error?: string;
}

export interface HealthSnapshot {
  readonly timestamp: string;
  readonly overallLevel: AlertLevel;
  readonly modules: ModuleHealth[];
  readonly healthyCount: number;
  readonly degradedCount: number;
  readonly failedCount: number;
  readonly recoveringCount: number;
  readonly systemResilience: number;
}

export interface AlertEvent {
  readonly alertId: string;
  readonly moduleId: string;
  readonly previousLevel: AlertLevel;
  readonly newLevel: AlertLevel;
  readonly reason: string;
  readonly timestamp: string;
  readonly autoRecoveryTriggered: boolean;
}

/* =========================================================================
   MODULE REGISTRY
   ========================================================================= */

const allModules: Array<IngressRoute | "bookpi-legacy"> = [
  "orchestrator",
  "prompt-builder",
  "context-compressor",
  "planner",
  "skill-registry",
  "provider-registry",
  "tool-dispatch",
  "gateway",
  "consent",
  "safety",
  "data-rights",
  "audit-receipt",
  "bookpi-legacy",
];

const moduleHealth = new Map<string, ModuleHealth>();
const alertLog: AlertEvent[] = [];
const MAX_ALERT_LOG = 1_000;
const RECOVERY_COOLDOWN_MS = 300_000;

/* =========================================================================
   INIT
   ========================================================================= */

function initModules(): void {
  for (const id of allModules) {
    if (!moduleHealth.has(id)) {
      moduleHealth.set(id, {
        moduleId: id,
        alertLevel: "green",
        lastHeartbeat: new Date().toISOString(),
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
        totalFailures: 0,
        totalRecoveries: 0,
        avgResponseMs: 0,
        uptime: 100,
        recoveryAttempts: 0,
      });
    }
  }
}

initModules();

/* =========================================================================
   HEARTBEAT & CHECK
   ========================================================================= */

export function heartbeat(moduleId: IngressRoute | "bookpi-legacy"): void {
  const health = moduleHealth.get(moduleId);
  if (!health) return;

  const now = new Date().toISOString();
  const prevLevel = health.alertLevel;

  const updated: ModuleHealth = {
    ...health,
    lastHeartbeat: now,
    lastCheck: now,
    consecutiveFailures: 0,
    alertLevel: health.consecutiveFailures > 0 ? "green" : health.alertLevel,
  };

  moduleHealth.set(moduleId, updated);

  if (prevLevel !== "green" && updated.alertLevel === "green") {
    const recovery: AlertEvent = {
      alertId: randomUUID(),
      moduleId,
      previousLevel: prevLevel,
      newLevel: "green",
      reason: `Module ${moduleId} recovered after ${health.consecutiveFailures} failures.`,
      timestamp: now,
      autoRecoveryTriggered: false,
    };
    alertLog.push(recovery);
    const h = moduleHealth.get(moduleId);
    if (h) {
      const upd: ModuleHealth = { ...h, totalRecoveries: h.totalRecoveries + 1 };
      moduleHealth.set(moduleId, upd);
    }

    try {
      emitQuantumEvent(
        "quantum.job.completed" as any,
        {
          event: "module_recovered",
          moduleId,
          previousLevel: prevLevel,
        },
        {
          traceId: `health-${Date.now()}`,
          requestId: randomUUID(),
          tenantId: "system",
          subjectId: "health-monitor",
          originCore: 0,
        },
      );
    } catch {
      /* ignore event emit errors */
    }
  }
}

export function recordFailure(moduleId: IngressRoute | "bookpi-legacy", error: string): void {
  const health = moduleHealth.get(moduleId);
  if (!health) return;

  const now = new Date().toISOString();
  const newConsecutive = health.consecutiveFailures + 1;
  let newLevel: AlertLevel = "green";

  if (newConsecutive >= 10) newLevel = "critical";
  else if (newConsecutive >= 7) newLevel = "red";
  else if (newConsecutive >= 5) newLevel = "orange";
  else if (newConsecutive >= 3) newLevel = "yellow";
  else if (newConsecutive >= 1) newLevel = "yellow";

  const uptime = Math.max(0, 100 - newConsecutive * 5);

  const updated: ModuleHealth = {
    ...health,
    consecutiveFailures: newConsecutive,
    totalFailures: health.totalFailures + 1,
    alertLevel: newLevel,
    lastCheck: now,
    uptime,
    error,
  };

  moduleHealth.set(moduleId, updated);

  if (newLevel !== health.alertLevel) {
    const autoRecovery = newLevel === "orange" || newLevel === "red";
    const alert: AlertEvent = {
      alertId: randomUUID(),
      moduleId,
      previousLevel: health.alertLevel,
      newLevel,
      reason: error,
      timestamp: now,
      autoRecoveryTriggered: autoRecovery,
    };
    alertLog.push(alert);
    if (alertLog.length > MAX_ALERT_LOG) alertLog.splice(0, alertLog.length - MAX_ALERT_LOG);

    try {
      emitQuantumEvent(
        "quantum.job.failed" as any,
        {
          event: "module_alert",
          moduleId,
          previousLevel: health.alertLevel,
          newLevel,
          error,
          autoRecovery,
        },
        {
          traceId: `health-${Date.now()}`,
          requestId: randomUUID(),
          tenantId: "system",
          subjectId: "health-monitor",
          originCore: 0,
        },
      );
    } catch {
      /* ignore event emit errors */
    }

    try {
      void auditTrace({
        eventType: `health.alert.${newLevel}`,
        actorId: "health-monitor",
        tenantId: "system",
        data: { moduleId, previousLevel: health.alertLevel, newLevel, error },
      }).catch(() => {});
    } catch {
      /* ignore audit errors */
    }

    if (autoRecovery) attemptRecovery(moduleId);
  }
}

/* =========================================================================
   AUTO-RECOVERY
   ========================================================================= */

function attemptRecovery(moduleId: IngressRoute | "bookpi-legacy"): void {
  const health = moduleHealth.get(moduleId);
  if (!health) return;

  const now = new Date().toISOString();
  if (health.lastRecoveryAttempt) {
    const elapsed = Date.now() - new Date(health.lastRecoveryAttempt).getTime();
    if (elapsed < RECOVERY_COOLDOWN_MS) return;
  }

  const updated: ModuleHealth = {
    ...health,
    recoveryAttempts: health.recoveryAttempts + 1,
    lastRecoveryAttempt: now,
  };
  moduleHealth.set(moduleId, updated);

  try {
    emitQuantumEvent(
      "quantum.job.completed" as any,
      {
        event: "recovery_attempt",
        moduleId,
        attempt: updated.recoveryAttempts,
      },
      {
        traceId: `recovery-${Date.now()}`,
        requestId: randomUUID(),
        tenantId: "system",
        subjectId: "health-monitor",
        originCore: 0,
      },
    );
  } catch {
    /* ignore event emit errors */
  }
}

/* =========================================================================
   QUERIES
   ========================================================================= */

export function getModuleHealth(
  moduleId: IngressRoute | "bookpi-legacy",
): ModuleHealth | undefined {
  return moduleHealth.get(moduleId);
}

export function getHealthSnapshot(): HealthSnapshot {
  const modules = Array.from(moduleHealth.values());
  let healthy = 0,
    degraded = 0,
    failed = 0,
    recovering = 0;

  for (const m of modules) {
    if (m.alertLevel === "green") healthy++;
    else if (m.alertLevel === "yellow") degraded++;
    else if (m.alertLevel === "orange" || m.alertLevel === "red") {
      failed++;
      recovering++;
    } else failed++;
  }

  const overallLevel = modules.some((m) => m.alertLevel === "critical")
    ? "critical"
    : modules.some((m) => m.alertLevel === "red")
      ? "red"
      : modules.some((m) => m.alertLevel === "orange")
        ? "orange"
        : modules.some((m) => m.alertLevel === "yellow")
          ? "yellow"
          : "green";

  const resilience = modules.length > 0 ? (healthy / modules.length) * 100 : 100;

  return {
    timestamp: new Date().toISOString(),
    overallLevel,
    modules,
    healthyCount: healthy,
    degradedCount: degraded,
    failedCount: failed,
    recoveringCount: recovering,
    systemResilience: Math.round(resilience * 100) / 100,
  };
}

export function getAlertLog(limit = 50): AlertEvent[] {
  return alertLog.slice(-limit);
}

export function isModuleHealthy(moduleId: IngressRoute | "bookpi-legacy"): boolean {
  const h = moduleHealth.get(moduleId);
  return h ? h.alertLevel === "green" || h.alertLevel === "yellow" : false;
}

export function getHealthyModules(): Array<IngressRoute | "bookpi-legacy"> {
  const healthy: Array<IngressRoute | "bookpi-legacy"> = [];
  for (const [id, h] of moduleHealth) {
    if (h.alertLevel === "green" || h.alertLevel === "yellow") healthy.push(id as any);
  }
  return healthy;
}
