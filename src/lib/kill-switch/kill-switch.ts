/**
 * Isabella Kill-Switch — Node Zero Recovery Module
 * Implements the controlled disruption flow from Section 18.3:
 *
 * DETECT -> CLASSIFY -> FREEZE_EGRESS -> QUIESCE -> SNAPSHOT_METADATA
 *       -> REVOKE_CAPABILITY -> ISOLATE_WORKLOAD -> VERIFY_TRUST_ROOT
 *       -> RESTORE_KNOWN_GOOD -> HEALTH_CHECK -> HUMAN_APPROVAL -> RESUME
 *
 * Reglas:
 * - No purgar datos antes de preservar metadatos forenses mínimos
 * - No hacer reboot automático como primera respuesta
 * - Aislamiento afecta al workload comprometido, no necesariamente a todo el nodo
 * - Claves nuevas solo después de verificar trust root y bundle
 * - Toda recuperación tiene RTO/RPO, dueño operativo y prueba trimestral
 */
import { randomUUID } from "node:crypto";
import { createLogger } from "../logger";
import type { KillSwitchState, KillSwitchEvent } from "../claim-radar/contracts";

const log = createLogger("kill-switch");

// ============================================================================
// STATE
// ============================================================================

let currentState: KillSwitchState = "normal";
const events: KillSwitchEvent[] = [];
const rtoMinutes = 30;
const rpoMinutes = 5;

// ============================================================================
// KILL-SWITCH STEPS
// ============================================================================

interface KillSwitchStep {
  step: number;
  action: string;
  automated: boolean;
  humanRequired: boolean;
  humanInstruction?: string;
}

const KILL_SWITCH_STEPS: KillSwitchStep[] = [
  {
    step: 1,
    action: "FREEZE_EGRESS: Bloquear toda salida de red no esencial",
    automated: true,
    humanRequired: false,
  },
  {
    step: 2,
    action: "QUIESCE: Pausar workloads activos de forma ordenada",
    automated: true,
    humanRequired: false,
  },
  {
    step: 3,
    action: "SNAPSHOT_METADATA: Preservar metadatos forenses (logs, traces, eventos)",
    automated: true,
    humanRequired: false,
  },
  {
    step: 4,
    action: "REVOKE_CAPABILITY: Revocar la capability o release comprometida",
    automated: false,
    humanRequired: true,
    humanInstruction:
      "Confirme qué capability o release debe ser revocada. La malla identificará las dependencias automáticamente.",
  },
  {
    step: 5,
    action: "ISOLATE_WORKLOAD: Aislar el workload afectado (no todo el nodo)",
    automated: true,
    humanRequired: false,
  },
  {
    step: 6,
    action: "VERIFY_TRUST_ROOT: Verificar que el trust root no fue comprometido",
    automated: true,
    humanRequired: false,
  },
  {
    step: 7,
    action: "RESTORE_KNOWN_GOOD: Restaurar la versión conocida buena",
    automated: false,
    humanRequired: true,
    humanInstruction:
      "Seleccione la release anterior firmada para restaurar. La malla verificará compatibilidad automáticamente.",
  },
  {
    step: 8,
    action: "HEALTH_CHECK: Ejecutar readiness y pruebas sintéticas",
    automated: true,
    humanRequired: false,
  },
  {
    step: 9,
    action: "HUMAN_APPROVAL: Esperar aprobación para reanudar",
    automated: false,
    humanRequired: true,
    humanInstruction:
      "Revise los resultados del health check. Si todo está nominal, apruebe la reanudación.",
  },
  {
    step: 10,
    action: "RESUME: Reanudar tráfico gradualmente",
    automated: true,
    humanRequired: false,
  },
];

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Activa el kill-switch con un trigger dado.
 */
export function activateKillSwitch(
  trigger: string,
  severity: KillSwitchEvent["severity"] = "SEV-2",
): KillSwitchEvent {
  const previousState = currentState;
  currentState = "egress-frozen";

  const event: KillSwitchEvent = {
    eventId: randomUUID(),
    trigger,
    severity,
    previousState,
    newState: currentState,
    actions: KILL_SWITCH_STEPS.map((s) => ({
      ...s,
      status: "pending" as const,
    })),
    activatedAt: new Date().toISOString(),
  };

  events.push(event);
  log.warn("kill_switch_activated", {
    eventId: event.eventId,
    severity,
    trigger: trigger.slice(0, 128),
    previousState,
  });

  return event;
}

/**
 * Ejecuta el siguiente paso automático del kill-switch.
 */
export function executeNextStep(eventId: string): KillSwitchEvent | undefined {
  const event = events.find((e) => e.eventId === eventId);
  if (!event) return undefined;

  const nextStep = event.actions.find((a) => a.status === "pending" && a.automated);
  if (!nextStep) return event;

  nextStep.status = "executing";

  // Simulate step execution (in production, each step would call real infrastructure)
  nextStep.status = "completed";
  nextStep.timestamp = new Date().toISOString();

  // Update state based on step
  if (nextStep.step <= 3) {
    currentState = "quiesced";
    event.newState = currentState;
  } else if (nextStep.step <= 6) {
    currentState = "isolated";
    event.newState = currentState;
  } else if (nextStep.step >= 7) {
    currentState = "restoring";
    event.newState = currentState;
  }

  // Check if all automated steps are done and human approval is needed
  const pendingHuman = event.actions.find((a) => a.status === "pending" && a.humanRequired);
  if (pendingHuman && event.actions.filter((a) => a.status === "completed").length >= 3) {
    currentState = "requires-approval";
    event.newState = currentState;
  }

  return event;
}

/**
 * Resuelve el kill-switch (después de aprobación humana).
 */
export function resolveKillSwitch(eventId: string, approvedBy: string): boolean {
  const event = events.find((e) => e.eventId === eventId);
  if (!event) return false;

  event.resolvedAt = new Date().toISOString();
  event.approvedBy = approvedBy;
  currentState = "normal";

  log.info("kill_switch_resolved", {
    eventId,
    approvedBy,
    totalSteps: event.actions.length,
    completedSteps: event.actions.filter((a) => a.status === "completed").length,
  });

  return true;
}

/**
 * Estado actual del kill-switch.
 */
export function getKillSwitchStatus() {
  return {
    state: currentState,
    activeEvents: events.filter((e) => !e.resolvedAt).length,
    totalEvents: events.length,
    rtoMinutes,
    rpoMinutes,
    steps: KILL_SWITCH_STEPS,
  };
}

/**
 * Historial de eventos.
 */
export function getKillSwitchEvents(limit: number = 50): KillSwitchEvent[] {
  return events.slice(-limit);
}
