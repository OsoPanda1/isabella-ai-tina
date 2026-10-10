/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — RESILIENCE PROTOCOL
 * Ensures system continues operating even when multiple modules
 * fail. Implements fallback chains, circuit breakers, and
 * graceful degradation across the 12-module mesh.
 * ================================================================
 */
import { randomUUID } from "node:crypto";
import { emitQuantumEvent } from "../../lib/quantum/event-bus";
import { getHealthyModules, recordFailure } from "./health-monitor";
import type { IngressRoute } from "./ingress-distributor";

/* =========================================================================
   TYPES
   ========================================================================= */

export interface CircuitBreakerState {
  readonly moduleId: IngressRoute;
  readonly state: "closed" | "open" | "half-open";
  readonly failureCount: number;
  readonly lastFailureTime?: string;
  readonly nextAttemptTime?: string;
  readonly successCount: number;
  readonly totalRequests: number;
}

export interface FallbackChain {
  readonly primary: IngressRoute;
  readonly fallbacks: IngressRoute[];
  readonly depth: number;
}

/* =========================================================================
   CIRCUIT BREAKERS
   ========================================================================= */

const FAILURE_THRESHOLD = 5;
const RECOVERY_TIMEOUT_MS = 60_000;
const SUCCESS_THRESHOLD = 3;
const circuitBreakers = new Map<
  string,
  {
    state: "closed" | "open" | "half-open";
    failureCount: number;
    successCount: number;
    lastFailureTime?: string;
    nextAttemptTime?: string;
    totalRequests: number;
  }
>();

function getCircuitBreaker(moduleId: string) {
  if (!circuitBreakers.has(moduleId)) {
    circuitBreakers.set(moduleId, {
      state: "closed",
      failureCount: 0,
      successCount: 0,
      totalRequests: 0,
    });
  }
  return circuitBreakers.get(moduleId)!;
}

export function recordCircuitSuccess(moduleId: IngressRoute): void {
  const cb = getCircuitBreaker(moduleId);
  cb.totalRequests++;
  cb.successCount++;
  cb.failureCount = 0;

  if (cb.state === "half-open" && cb.successCount >= SUCCESS_THRESHOLD) {
    cb.state = "closed";
    cb.successCount = 0;
  }
}

export function recordCircuitFailure(moduleId: IngressRoute): void {
  const cb = getCircuitBreaker(moduleId);
  cb.totalRequests++;
  cb.failureCount++;
  cb.successCount = 0;
  cb.lastFailureTime = new Date().toISOString();

  if (cb.failureCount >= FAILURE_THRESHOLD && cb.state === "closed") {
    cb.state = "open";
    cb.nextAttemptTime = new Date(Date.now() + RECOVERY_TIMEOUT_MS).toISOString();
    recordFailure(moduleId, `Circuit breaker OPEN after ${cb.failureCount} consecutive failures.`);
  } else if (cb.state === "open") {
    const now = Date.now();
    const nextAttempt = cb.nextAttemptTime ? new Date(cb.nextAttemptTime).getTime() : 0;
    if (now >= nextAttempt) {
      cb.state = "half-open";
      cb.successCount = 0;
    }
  }
}

export function isCircuitOpen(moduleId: IngressRoute): boolean {
  const cb = getCircuitBreaker(moduleId);
  if (cb.state === "open") {
    const now = Date.now();
    const nextAttempt = cb.nextAttemptTime ? new Date(cb.nextAttemptTime).getTime() : 0;
    if (now >= nextAttempt) {
      cb.state = "half-open";
      cb.successCount = 0;
      return false;
    }
    return true;
  }
  return false;
}

/* =========================================================================
   FALLBACK CHAINS — each module has fallbacks
   ========================================================================= */

const FALLBACK_CHAINS: Record<string, IngressRoute[]> = {
  orchestrator: ["gateway", "planner", "audit-receipt"],
  "prompt-builder": ["orchestrator", "context-compressor", "audit-receipt"],
  "context-compressor": ["orchestrator", "audit-receipt"],
  planner: ["orchestrator", "skill-registry", "audit-receipt"],
  "skill-registry": ["tool-dispatch", "orchestrator", "audit-receipt"],
  "provider-registry": ["orchestrator", "gateway"],
  "tool-dispatch": ["orchestrator", "skill-registry", "audit-receipt"],
  gateway: ["orchestrator", "audit-receipt"],
  consent: ["safety", "data-rights", "audit-receipt"],
  safety: ["consent", "audit-receipt"],
  "data-rights": ["consent", "audit-receipt"],
  "audit-receipt": ["bookpi-legacy"],
  "bookpi-legacy": ["audit-receipt"],
};

export function resolveWithFallback(primaryRoute: IngressRoute): FallbackChain {
  const healthy = new Set(getHealthyModules());
  const fallbacks = (FALLBACK_CHAINS[primaryRoute] || []).filter((f) => healthy.has(f as any));

  return {
    primary: primaryRoute,
    fallbacks,
    depth: fallbacks.length,
  };
}

export async function executeWithFallback<T>(
  primaryRoute: IngressRoute,
  execute: (route: IngressRoute) => Promise<T>,
): Promise<{ result: T; route: IngressRoute; usedFallback: boolean }> {
  if (!isCircuitOpen(primaryRoute)) {
    try {
      const result = await execute(primaryRoute);
      recordCircuitSuccess(primaryRoute);
      return { result, route: primaryRoute, usedFallback: false };
    } catch (err) {
      recordCircuitFailure(primaryRoute);
    }
  }

  const chain = resolveWithFallback(primaryRoute);
  for (const fallback of chain.fallbacks) {
    if (isCircuitOpen(fallback)) continue;
    try {
      const result = await execute(fallback);
      recordCircuitSuccess(fallback);
      try {
        emitQuantumEvent(
          "quantum.job.completed" as any,
          {
            event: "fallback_success",
            primary: primaryRoute,
            fallback,
            depth: chain.fallbacks.indexOf(fallback) + 1,
          },
          {
            traceId: `fallback-${Date.now()}`,
            requestId: randomUUID(),
            tenantId: "system",
            subjectId: "resilience",
            originCore: 0,
          },
        );
      } catch {
        /* ignore event emit errors */
      }
      return { result, route: fallback, usedFallback: true };
    } catch {
      recordCircuitFailure(fallback);
    }
  }

  throw new Error(`All routes failed for ${primaryRoute}. Fallback chain exhausted.`);
}

/* =========================================================================
   DEGRADATION MODES
   ========================================================================= */

export type DegradationMode = "full" | "reduced" | "minimal" | "degraded";

export function getCurrentDegradationMode(): DegradationMode {
  const healthy = getHealthyModules().length;
  const total = 13;
  const ratio = healthy / total;

  if (ratio >= 0.9) return "full";
  if (ratio >= 0.7) return "reduced";
  if (ratio >= 0.5) return "minimal";
  return "degraded";
}

export function getDegradationCapabilities(): {
  mode: DegradationMode;
  canProcessUserInput: boolean;
  canExecuteTools: boolean;
  canPersistToBookPI: boolean;
  canClassifyRisk: boolean;
  canManageConsent: boolean;
  canAudit: boolean;
  canExportData: boolean;
} {
  const mode = getCurrentDegradationMode();
  return {
    mode,
    canProcessUserInput: mode !== "degraded",
    canExecuteTools: mode === "full" || mode === "reduced",
    canPersistToBookPI: true,
    canClassifyRisk: mode === "full" || mode === "reduced" || mode === "minimal",
    canManageConsent: mode !== "degraded",
    canAudit: true,
    canExportData: mode === "full" || mode === "reduced",
  };
}

export function getCircuitBreakerStates(): CircuitBreakerState[] {
  const states: CircuitBreakerState[] = [];
  for (const [id, cb] of circuitBreakers) {
    states.push({
      moduleId: id as IngressRoute,
      state: cb.state,
      failureCount: cb.failureCount,
      lastFailureTime: cb.lastFailureTime,
      nextAttemptTime: cb.nextAttemptTime,
      successCount: cb.successCount,
      totalRequests: cb.totalRequests,
    });
  }
  return states;
}
