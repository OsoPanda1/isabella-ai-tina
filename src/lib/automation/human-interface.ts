/**
 * Isabella Automation Mesh — Human Interface
 * Traduce descripciones en lenguaje natural a acciones de reparación.
 *
 * El humano dice: "se cayó el HSM" → la malla sabe exactamente qué reconectar.
 * El humano dice: "la encriptación no funciona" → la malla reconecta PQC + BookPI + HSM + TEE.
 * El humano dice: "nadie puede entrar" → la malla reconecta Identity + Auth + CORS.
 */
import { getAutomationNode, getAffectedChain, getAtlasStats } from "./registry";
import {
  createRepairChain,
  checkNodeHealth,
  getMeshStatus,
  getActiveFailures,
  getActiveRepairChains,
} from "./mesh";
import type { AutomationNode, HumanDescription, RepairChain } from "./contracts";

// ============================================================================
// NATURAL LANGUAGE PARSER
// ============================================================================

/**
 * Palabras clave → nodos de automatización.
 * Cada entrada es un array de patrones que mapean a un nodo.
 */
const KEYWORD_MAP: Array<{ patterns: string[]; nodeId: string }> = [
  // Identity & Auth
  {
    patterns: [
      "login",
      "auth",
      "autenticación",
      "sesión",
      "token",
      "jwt",
      "password",
      "contraseña",
      "usuario",
      "user",
      "identity",
      "identidad",
      "webauthn",
      "entrar",
      "acceso",
    ],
    nodeId: "A-identity",
  },
  {
    patterns: ["consent", "consentimiento", "permiso", "autorización", "allow"],
    nodeId: "B-consent",
  },

  // Policy & Governance
  {
    patterns: [
      "policy",
      "política",
      "regla",
      "governance",
      "gobernanza",
      "argus",
      "zero-trust",
      "zero trust",
      "allowed",
      "denied",
      "bloqueado",
      "prohibido",
      "scope",
    ],
    nodeId: "C-policy",
  },

  // Intent & Orchestration
  {
    patterns: [
      "crown",
      "orquestador",
      "router",
      "routing",
      "enrutamiento",
      "preset",
      "peso",
      "weight",
      "intención",
      "intent",
      "yun",
    ],
    nodeId: "D-intent",
  },

  // Quantum
  {
    patterns: [
      "quantum",
      "cuántico",
      "dispositivo",
      "device",
      "provider",
      "proveedor",
      "pennylane",
      "qiskit",
      "braket",
      "rigetti",
      "catalyst",
      "lightning",
      "hardware",
    ],
    nodeId: "E-device-registry",
  },
  {
    patterns: [
      "gateway",
      "puerta",
      "entrada",
      "pipeline",
      "orquesta",
      "orchestrat",
      "ejecución cuántica",
      "quantum execute",
    ],
    nodeId: "F-quantum-gateway",
  },
  {
    patterns: ["scheduler", "planificador", "cola", "queue", "prioridad", "priority"],
    nodeId: "G-scheduler",
  },
  {
    patterns: ["worker", "proceso", "process", "heartbeat", "congelado", "hung", "stale"],
    nodeId: "H-workers",
  },

  // Execution
  {
    patterns: ["pennylane", "circuito", "circuit", "variacional", "simulación", "simulator"],
    nodeId: "I-pennylane",
  },
  { patterns: ["qiskit", "ibm"], nodeId: "J-qiskit" },
  { patterns: ["braket", "aws", "amazon"], nodeId: "K-braket" },
  { patterns: ["rigetti", "qcs"], nodeId: "L-rigetti" },
  { patterns: ["catalyst", "compilador", "compiler", "artifact"], nodeId: "M-catalyst" },
  { patterns: ["lightning", "hpc", "acelerador", "accelerator"], nodeId: "N-lightning" },

  // Crypto & Security
  {
    patterns: [
      "encriptación",
      "encryption",
      "cryptography",
      "crypto",
      "firma",
      "signature",
      "post-quantum",
      "poscuántico",
      "pqc",
      "crystals",
      "latamv",
      "kyber",
      "dilithium",
      "sphincs",
      "ml-dsa",
      "ml-kem",
    ],
    nodeId: "O-pqc",
  },
  {
    patterns: ["litle", "gate", "compuerta", "quantum gate", "attestation matrix"],
    nodeId: "P-litle32",
  },
  {
    patterns: [
      "bookpi",
      "audit chain",
      "cadena",
      "blockchain",
      "bloque",
      "block",
      "hash chain",
      "procedencia",
      "provenance",
    ],
    nodeId: "Q-bookpi",
  },

  // Hardware Security
  {
    patterns: ["hsm", "yubihsm", "hardware security", "módulo", "firmar", "sign"],
    nodeId: "R-hsm",
  },
  {
    patterns: ["tee", "trusted execution", "attestation", "sgx", "trustzone", "entorno seguro"],
    nodeId: "S-tee",
  },

  // Audit & Telemetry
  {
    patterns: ["audit", "auditoría", "traza", "trace", "checksum", "sha-256"],
    nodeId: "T-audit-tracer",
  },
  { patterns: ["event", "evento", "bus", "emitter", "listener"], nodeId: "U-event-bus" },
  {
    patterns: [
      "telemetry",
      "métrica",
      "metric",
      "counter",
      "histogram",
      "span",
      "prometheus",
      "grafana",
      "jaeger",
    ],
    nodeId: "V-telemetry",
  },

  // Persistence
  {
    patterns: [
      "database",
      "base de datos",
      "postgresql",
      "postgres",
      "timescale",
      "sql",
      "persistencia",
      "persistence",
    ],
    nodeId: "W-postgresql",
  },
  { patterns: ["backup", "snapshot", "copia", "respaldo"], nodeId: "X-backup" },

  // Federation
  {
    patterns: ["federación", "federation", "heptafederado", "replica", "quorum", "nodo federado"],
    nodeId: "Y-federation",
  },
  {
    patterns: [
      "recovery",
      "recuperación",
      "incidente",
      "incident",
      "self-heal",
      "auto-reparación",
      "emergency",
      "emergencia",
    ],
    nodeId: "Z-recovery",
  },

  // Cognitive
  {
    patterns: [
      "cognitivo",
      "cognitive",
      "pensamiento",
      "thought",
      "respuesta",
      "response",
      "isa",
      "sophia",
      "orion",
      "razonamiento",
      "empatía",
      "creatividad",
      "chat",
      "mensaje",
      "message",
    ],
    nodeId: "AA-cognitive",
  },

  // Multimodal
  {
    patterns: [
      "imagen",
      "image",
      "voz",
      "voice",
      "tts",
      "audio",
      "video",
      "tráiler",
      "trailer",
      "canvas",
      "generación de arte",
      "multimodal",
    ],
    nodeId: "AB-multimodal",
  },

  // Billing
  {
    patterns: [
      "billing",
      "facturación",
      "pago",
      "payment",
      "suscripción",
      "subscription",
      "plan",
      "precio",
      "price",
      "stripe",
      "checkout",
    ],
    nodeId: "AC-billing",
  },

  // Territorial
  {
    patterns: [
      "territorial",
      "territorio",
      "real del monte",
      "hidalgo",
      "méxico",
      "latinoamérica",
      "latam",
      "cultura",
      "patrimonio",
    ],
    nodeId: "AD-territorial",
  },
];

/**
 * Analiza texto en lenguaje natural y extrae la intención.
 */
export function parseHumanDescription(text: string): HumanDescription {
  const lower = text.toLowerCase();
  const matchedNodeIds = new Set<string>();
  let bestMatchCount = 0;

  for (const entry of KEYWORD_MAP) {
    for (const pattern of entry.patterns) {
      if (lower.includes(pattern)) {
        matchedNodeIds.add(entry.nodeId);
        bestMatchCount++;
        break;
      }
    }
  }

  // Determine intent
  let parsedIntent: HumanDescription["parsedIntent"] = "request_status";
  if (
    lower.match(
      /falló|fallo|caído|caida|roto|broken|error|failing|down|no funciona|not working|se cayó/,
    )
  ) {
    parsedIntent = "report_failure";
  } else if (lower.match(/explica|explain|qué es|what is|cómo funciona|how does/)) {
    parsedIntent = "explain_module";
  } else if (lower.match(/reparar|fix|arreglar|repair|resolver|solve/)) {
    parsedIntent = "guide_repair";
  } else if (lower.match(/depende|depend|qué necesita|what depends|cadena|chain/)) {
    parsedIntent = "list_dependencies";
  } else if (lower.match(/desarrollador|developer|onboard|empezar|start|contribuir|contribute/)) {
    parsedIntent = "onboard_developer";
  }

  // Generate suggested actions
  const suggestedActions: string[] = [];
  for (const nodeId of matchedNodeIds) {
    const node = getAutomationNode(nodeId);
    if (node) {
      suggestedActions.push(`Check ${node.name}: ${node.repairProcedure}`);
      const affected = getAffectedChain(nodeId).filter((id) => id !== nodeId);
      if (affected.length > 0) {
        suggestedActions.push(
          `Also check affected: ${affected.map((id) => getAutomationNode(id)?.name || id).join(", ")}`,
        );
      }
    }
  }

  const confidence = Math.min(1, bestMatchCount / 3);

  return {
    rawText: text,
    parsedIntent,
    matchedNodeIds: [...matchedNodeIds],
    confidence,
    suggestedActions,
  };
}

// ============================================================================
// HUMAN-FACING API
// ============================================================================

/**
 * Interfaz principal: el humano describe un problema, la malla responde
 * con un plan de reparación claro y simple.
 */
export function describeProblem(humanText: string): {
  understanding: string;
  matchedModules: Array<{ id: string; name: string; description: string; health: string }>;
  repairPlan: string;
  affectedChain: string[];
  canAutoRepair: boolean;
  humanInstructions: string[];
  repairChain?: RepairChain;
} {
  const parsed = parseHumanDescription(humanText);

  const matchedModules = parsed.matchedNodeIds.map((id) => {
    const node = getAutomationNode(id);
    const health = checkNodeHealth(id);
    return {
      id,
      name: node?.name || id,
      description: node?.humanDescription || "Unknown module",
      health: health.status,
    };
  });

  // Build affected chain
  const allAffected = new Set<string>();
  for (const nodeId of parsed.matchedNodeIds) {
    for (const id of getAffectedChain(nodeId)) {
      allAffected.add(id);
    }
  }
  const affectedChain = [...allAffected];

  // Determine if auto-repair is possible
  const canAutoRepair = parsed.matchedNodeIds.every((id) => {
    const node = getAutomationNode(id);
    return node && node.complexity !== "critical";
  });

  // Build human-readable repair plan
  const repairSteps: string[] = [];
  const humanInstructions: string[] = [];

  repairSteps.push(`1. DIAGNOSE: Identify which module failed`);
  let step = 2;
  for (const nodeId of parsed.matchedNodeIds) {
    const node = getAutomationNode(nodeId);
    if (node) {
      repairSteps.push(`${step}. REPAIR ${node.name}: ${node.repairProcedure}`);
      step++;
    }
  }
  if (affectedChain.length > 0) {
    repairSteps.push(
      `${step}. VERIFY CHAIN: Reconnect ${affectedChain.map((id) => getAutomationNode(id)?.name || id).join(" → ")}`,
    );
    step++;
  }
  repairSteps.push(`${step}. TEST: Verify all modules return healthy`);

  if (!canAutoRepair) {
    humanInstructions.push(
      "This module requires manual intervention. Describe what you see in plain language, and the mesh will guide you through each step.",
      "You don't need to understand the 20 files inside. Just describe what happened.",
    );
  }

  // Create repair chain
  let repairChain: RepairChain | undefined;
  if (parsed.matchedNodeIds.length > 0) {
    repairChain = createRepairChain(parsed.matchedNodeIds[0], humanText);
  }

  return {
    understanding: `I understand you're reporting: "${parsed.parsedIntent}" for modules: ${matchedModules.map((m) => m.name).join(", ")}. Confidence: ${(parsed.confidence * 100).toFixed(0)}%.`,
    matchedModules,
    repairPlan: repairSteps.join("\n"),
    affectedChain,
    canAutoRepair,
    humanInstructions,
    repairChain,
  };
}

/**
 * Genera una guía simple para un desarrollador que nunca ha visto el código.
 */
export function explainToDeveloper(nodeId: string): {
  name: string;
  whatItDoes: string;
  howSimple: string;
  files: string[];
  dependencies: string[];
  dependents: string[];
  health: string;
  repairInstructions: string;
  analogies: string;
} {
  const node = getAutomationNode(nodeId);
  if (!node) {
    return {
      name: nodeId,
      whatItDoes: "Module not found in atlas",
      howSimple: "N/A",
      files: [],
      dependencies: [],
      dependents: [],
      health: "unknown",
      repairInstructions: "N/A",
      analogies: "N/A",
    };
  }

  const health = checkNodeHealth(nodeId);

  // Generate analogies
  const analogies = generateAnalogies(node);

  return {
    name: node.name,
    whatItDoes: node.description,
    howSimple: node.developerGuide,
    files: node.codeFiles,
    dependencies: node.dependencies.map((id) => getAutomationNode(id)?.name || id),
    dependents: node.dependents.map((id) => getAutomationNode(id)?.name || id),
    health: health.status,
    repairInstructions: node.repairProcedure,
    analogies,
  };
}

/**
 * Genera analogías simples para explicar un módulo.
 */
function generateAnalogies(node: AutomationNode): string {
  const analogies: Record<string, string> = {
    "A-identity": "Like a bouncer at a club door — checks IDs and lets authorized people in.",
    "B-consent": "Like asking permission before touching someone's belongings.",
    "C-policy": "Like a judge who reviews every request before it's allowed.",
    "D-intent": "Like a conductor who decides which musician plays when.",
    "E-device-registry": "Like a phone book of all available quantum computers.",
    "F-quantum-gateway": "Like a post office that routes packages to the right destination.",
    "G-scheduler": "Like a hospital triage nurse who prioritizes patients.",
    "H-workers":
      "Like a factory foreman who assigns tasks to workers and replaces those who faint.",
    "I-pennylane": "Like a quantum calculator that simulates circuits on a normal computer.",
    "O-pqc": "Like an unbreakable seal that even future computers can't forge.",
    "P-litle32": "Like a 32-question security quiz that every signature must pass.",
    "Q-bookpi": "Like a notary's logbook where every entry is chained to the previous one.",
    "R-hsm": "Like a safe with two locks — if one breaks, the other takes over.",
    "S-tee": "Like a locked room where code runs and nobody can peek inside.",
    "T-audit-tracer": "Like a security camera that records everything with a timestamp.",
    "U-event-bus": "Like a postal system that delivers messages between all departments.",
    "V-telemetry": "Like a dashboard showing speed, fuel, and engine temperature.",
    "W-postgresql": "Like a filing cabinet that never loses documents.",
    "Y-federation": "Like 7 backup copies of the same document in 7 different cities.",
    "Z-recovery": "Like a paramedic who arrives when something breaks.",
    "AA-cognitive": "Like 5 specialists consulting together to answer one question.",
    "AB-multimodal": "Like an artist who can draw, sing, and make movies.",
    "AC-billing": "Like a cash register that tracks subscriptions and payments.",
    "AD-territorial": "Like a local guide who knows every street and story of Real del Monte.",
  };

  return (
    analogies[node.id] ||
    `Like a component in the Isabella system with ${node.codeFiles.length} files.`
  );
}

/**
 * Obtiene un resumen completo del sistema para un humano.
 */
export function getSystemSummary() {
  const stats = getAtlasStats();
  const meshStatus = getMeshStatus();
  const failures = getActiveFailures();
  const chains = getActiveRepairChains();

  return {
    overview: `Isabella has ${stats.totalNodes} automations across ${Object.keys(stats.byCategory).length} categories. ${meshStatus.healthy} healthy, ${meshStatus.degraded} degraded, ${meshStatus.failing} failing.`,
    categories: stats.byCategory,
    complexity: stats.byComplexity,
    health: {
      healthy: meshStatus.healthy,
      degraded: meshStatus.degraded,
      failing: meshStatus.failing,
      offline: meshStatus.offline,
    },
    activeFailures: failures.length,
    activeRepairChains: chains.length,
    simpleExplanation:
      "Each automation is like a Lego block. When one breaks, you don't need to understand the entire castle — just describe which block broke, and the system reconnects everything else automatically.",
  };
}
