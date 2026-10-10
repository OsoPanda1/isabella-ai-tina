/**
 * Isabella Automation Mesh — Self-Healing Engine
 * Monitorea todas las automatizaciones, detecta fallos, crea planes de reparación
 * y reconecta A + B + C + D + E... de forma automática.
 *
 * Cuando algo falla, el humano solo necesita decir QUÉ falló.
 * La malla sabe CÓMO reconectar todo.
 */
import { randomUUID } from "node:crypto";
import { createLogger } from "../logger";
import {
  AUTOMATION_ATLAS,
  getAutomationNode,
  getAffectedChain,
  getDependencyChain,
} from "./registry";
import type { AutomationStatus, AutomationSeverity, FailureEvent, RepairChain } from "./contracts";

const log = createLogger("automation-mesh");

// ============================================================================
// HEALTH STATE
// ============================================================================

interface NodeHealth {
  nodeId: string;
  status: AutomationStatus;
  lastCheck: string;
  consecutiveFailures: number;
  lastError?: string;
  metrics: {
    checkCount: number;
    failureCount: number;
    repairCount: number;
  };
}

const healthState = new Map<string, NodeHealth>();

function initHealth(nodeId: string): NodeHealth {
  const existing = healthState.get(nodeId);
  if (existing) return existing;
  const health: NodeHealth = {
    nodeId,
    status: "unknown",
    lastCheck: new Date().toISOString(),
    consecutiveFailures: 0,
    metrics: { checkCount: 0, failureCount: 0, repairCount: 0 },
  };
  healthState.set(nodeId, health);
  return health;
}

// ============================================================================
// HEALTH CHECKS — Built-in diagnostics per node
// ============================================================================

const EVIDENCE_GATED = "EVIDENCE_GATED - sin verificacion en runtime";

const HEALTH_CHECKS: Record<string, () => { ok: boolean; detail: string }> = {
  // La presencia de una variable de entorno no acredita que el servicio
  // funcione: se reporta como presencia, nunca como salud.
  "A-identity": () => ({
    ok: false,
    detail: process.env.ISABELLA_AUTH_SECRET
      ? `${EVIDENCE_GATED} - ISABELLA_AUTH_SECRET presente (solo presencia)`
      : "ISABELLA_AUTH_SECRET no definida",
  }),
  "I-pennylane": () => ({
    ok: false,
    detail: `${EVIDENCE_GATED} - disponibilidad de PennyLane no comprobada`,
  }),
  "R-hsm": () => ({
    ok: false,
    detail: process.env.YUBIHSM_SERIAL
      ? `${EVIDENCE_GATED} - YUBIHSM_SERIAL presente; transporte HSM no verificado`
      : `${EVIDENCE_GATED} - sin YUBIHSM_SERIAL`,
  }),
  "W-postgresql": () => ({
    ok: false,
    detail: process.env.DATABASE_URL
      ? `${EVIDENCE_GATED} - DATABASE_URL presente; conexion no comprobada`
      : "DATABASE_URL no definida",
  }),
};

// ============================================================================
// MONITORING — Continuous health check loop
// ============================================================================

let monitorInterval: ReturnType<typeof setInterval> | null = null;
const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Ejecuta un health check para un nodo específico.
 */
export function checkNodeHealth(nodeId: string): NodeHealth {
  const health = initHealth(nodeId);
  const checkFn = HEALTH_CHECKS[nodeId];

  health.metrics.checkCount++;
  health.lastCheck = new Date().toISOString();

  if (!checkFn) {
    health.status = "unknown";
    return health;
  }

  try {
    const result = checkFn();
    if (result.ok) {
      health.status = "healthy";
      health.consecutiveFailures = 0;
      health.lastError = undefined;
    } else {
      health.consecutiveFailures++;
      health.lastError = result.detail;
      health.metrics.failureCount++;

      if (health.consecutiveFailures >= 3) {
        health.status = "failing";
      } else if (health.consecutiveFailures >= 1) {
        health.status = "degraded";
      }
    }
  } catch (err) {
    health.consecutiveFailures++;
    health.lastError = err instanceof Error ? err.message : "unknown error";
    health.metrics.failureCount++;
    health.status = "failing";
  }

  return health;
}

/**
 * Ejecuta health checks para todos los nodos.
 */
export function checkAllHealth(): Map<string, NodeHealth> {
  for (const node of AUTOMATION_ATLAS) {
    checkNodeHealth(node.id);
  }
  return new Map(healthState);
}

/**
 * Inicia el monitoreo continuo.
 */
export function startMonitoring(): void {
  if (monitorInterval) return;
  log.info("automation_monitor_start", { interval_ms: HEALTH_CHECK_INTERVAL_MS });
  monitorInterval = setInterval(() => {
    checkAllHealth();
    detectAndHeal();
  }, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Detiene el monitoreo.
 */
export function stopMonitoring(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    log.info("automation_monitor_stop");
  }
}

// ============================================================================
// FAILURE DETECTION
// ============================================================================

const activeFailures = new Map<string, FailureEvent>();

/**
 * Detecta nodos fallando y crea planes de reparación automáticamente.
 */
export function detectAndHeal(): FailureEvent[] {
  const newFailures: FailureEvent[] = [];

  for (const [nodeId, health] of healthState) {
    if (health.status === "failing" || health.status === "offline") {
      if (!activeFailures.has(nodeId)) {
        const failure = createFailureEvent(nodeId, health);
        activeFailures.set(nodeId, failure);
        newFailures.push(failure);
        log.warn("automation_failure_detected", {
          nodeId,
          severity: failure.severity,
          affectedNodes: failure.affectedNodes.length,
          repairSteps: failure.repairPlan.length,
        });
      }
    }
  }

  // Auto-heal nodes that recovered
  for (const [nodeId, failure] of activeFailures) {
    const health = healthState.get(nodeId);
    if (health?.status === "healthy") {
      failure.status = "repaired";
      failure.completedAt = new Date().toISOString();
      activeFailures.delete(nodeId);
      log.info("automation_auto_healed", { nodeId, failureId: failure.failureId });
    }
  }

  return newFailures;
}

/**
 * Crea un evento de fallo con plan de reparación automático.
 */
function createFailureEvent(nodeId: string, health: NodeHealth): FailureEvent {
  const node = getAutomationNode(nodeId);
  const affectedNodes = getAffectedChain(nodeId).filter((id) => id !== nodeId);
  const dependencyChain = getDependencyChain(nodeId);

  const severity: AutomationSeverity =
    health.consecutiveFailures >= 5
      ? "catastrophic"
      : health.consecutiveFailures >= 3
        ? "critical"
        : health.consecutiveFailures >= 2
          ? "warning"
          : "info";

  const repairPlan: FailureEvent["repairPlan"] = [];

  // Step 1: Diagnose
  repairPlan.push({
    step: 1,
    action: `Diagnose ${node?.name || nodeId}: ${health.lastError || "unknown"}`,
    nodeId,
    automated: true,
    humanRequired: false,
  });

  // Step 2: Check dependencies
  if (dependencyChain.length > 1) {
    repairPlan.push({
      step: 2,
      action: `Verify dependency chain: ${dependencyChain.join(" → ")}`,
      nodeId: dependencyChain[0],
      automated: true,
      humanRequired: false,
    });
  }

  // Step 3: Attempt automated repair
  repairPlan.push({
    step: repairPlan.length + 1,
    action: node?.repairProcedure || `Restart ${nodeId}`,
    nodeId,
    automated: true,
    humanRequired: false,
  });

  // Step 4: If critical, ask human
  if (severity === "critical" || severity === "catastrophic") {
    repairPlan.push({
      step: repairPlan.length + 1,
      action: `Manual intervention required for ${node?.name || nodeId}`,
      nodeId,
      automated: false,
      humanRequired: true,
      humanInstruction: `Describe what happened with "${node?.humanDescription || nodeId}" in plain language. The mesh will reconnect everything.`,
    });
  }

  return {
    failureId: randomUUID(),
    nodeId,
    detectedAt: new Date().toISOString(),
    severity,
    message: health.lastError || `Node ${nodeId} is failing`,
    symptoms: [health.lastError || "Consecutive failures exceeded threshold"],
    affectedNodes,
    repairPlan,
    status: "detected",
  };
}

// ============================================================================
// REPAIR CHAINS — A + B + C + D + E alignment
// ============================================================================

const repairChains = new Map<string, RepairChain>();

/**
 * Crea una cadena de reparación que reconecta A + B + C + D + E...
 * cuando un nodo falla.
 */
export function createRepairChain(triggerNodeId: string, humanDescription: string): RepairChain {
  const affected = getAffectedChain(triggerNodeId);
  const dependencies = getDependencyChain(triggerNodeId);
  const allNodes = [...new Set([...dependencies, ...affected])].filter(
    (id) => id !== triggerNodeId,
  );

  const nodes: RepairChain["nodes"] = allNodes.map((nodeId, index) => ({
    nodeId,
    order: index + 1,
    action: `Reconnect ${getAutomationNode(nodeId)?.name || nodeId}`,
    status: "pending" as const,
  }));

  // Add trigger node at the end (repair it last, after dependencies are healthy)
  nodes.push({
    nodeId: triggerNodeId,
    order: nodes.length + 1,
    action: `Repair ${getAutomationNode(triggerNodeId)?.name || triggerNodeId}`,
    status: "pending",
  });

  const chain: RepairChain = {
    chainId: randomUUID(),
    trigger: humanDescription,
    nodes,
    createdAt: new Date().toISOString(),
    overallStatus: "pending",
  };

  repairChains.set(chain.chainId, chain);
  log.info("repair_chain_created", {
    chainId: chain.chainId,
    trigger: triggerNodeId,
    nodeCount: nodes.length,
    humanDescription,
  });

  return chain;
}

/**
 * Ejecuta el siguiente paso de una cadena de reparación.
 */
export function executeRepairStep(chainId: string): RepairChain | undefined {
  const chain = repairChains.get(chainId);
  if (!chain || chain.overallStatus === "completed" || chain.overallStatus === "failed") {
    return chain;
  }

  const nextStep = chain.nodes.find((n) => n.status === "pending");
  if (!nextStep) {
    chain.overallStatus = "completed";
    chain.completedAt = new Date().toISOString();
    return chain;
  }

  nextStep.status = "executing";
  nextStep.startedAt = new Date().toISOString();
  chain.overallStatus = "in_progress";

  // Simulate repair execution (in production, this would call real repair logic)
  const health = checkNodeHealth(nextStep.nodeId);
  if (health.status === "healthy") {
    nextStep.status = "success";
    nextStep.completedAt = new Date().toISOString();
  } else {
    nextStep.status = "failed";
    nextStep.completedAt = new Date().toISOString();
    nextStep.error = health.lastError || "Repair did not restore health";
    chain.overallStatus = "failed";
  }

  return chain;
}

// ============================================================================
// QUERY
// ============================================================================

/**
 * Estado de salud de todos los nodos.
 */
export function getMeshStatus() {
  checkAllHealth();
  const nodes = Array.from(healthState.values());
  const healthy = nodes.filter((n) => n.status === "healthy").length;
  const degraded = nodes.filter((n) => n.status === "degraded").length;
  const failing = nodes.filter((n) => n.status === "failing").length;
  const offline = nodes.filter((n) => n.status === "offline").length;
  const unknown = nodes.filter((n) => n.status === "unknown").length;

  return {
    totalNodes: AUTOMATION_ATLAS.length,
    healthy,
    degraded,
    failing,
    offline,
    unknown,
    activeFailures: activeFailures.size,
    activeRepairChains: Array.from(repairChains.values()).filter(
      (c) => c.overallStatus === "in_progress",
    ).length,
    nodes,
  };
}

/**
 * Obtiene fallos activos.
 */
export function getActiveFailures(): FailureEvent[] {
  return Array.from(activeFailures.values());
}

/**
 * Obtiene cadenas de reparación activas.
 */
export function getActiveRepairChains(): RepairChain[] {
  return Array.from(repairChains.values()).filter((c) => c.overallStatus !== "completed");
}

/**
 * Resuelve un fallo manualmente.
 */
export function resolveFailureManually(nodeId: string, resolution: string): boolean {
  const failure = activeFailures.get(nodeId);
  if (!failure) return false;
  failure.status = "repaired";
  failure.completedAt = new Date().toISOString();
  activeFailures.delete(nodeId);

  const health = healthState.get(nodeId);
  if (health) {
    health.consecutiveFailures = 0;
    health.status = "healthy";
    health.lastError = undefined;
  }

  log.info("automation_failure_resolved_manually", { nodeId, resolution });
  return true;
}
