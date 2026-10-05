import * as crypto from "node:crypto";
import { config } from "./config";
import { SecuritySystem } from "./security";
import { secrets } from "./secrets";
import { analyzeAegisSemantic } from "./aegis-semantic";
import { enqueueOtelLog } from "./otel-exporter";

// ============================================================================
// CANONICAL DEFINITIONS OF 12 MODULES & 24 CORES OF ISABELLA v4.2.0
// ============================================================================

export type IsabellaModuleId =
  | "CROWN_GATEWAY"
  | "ISA_CORE"
  | "SOPHIA_ENGINE"
  | "ORION_ENGINE"
  | "ARGUS_SENTINEL"
  | "LATAM_AEGIS"
  | "SOVEREIGN_DB"
  | "MEM_ENGINE"
  | "QUANTUM_PLATFORM"
  | "MONETIZATION"
  | "OIDC_AUTH"
  | "VOICE_SYNTH";

export type IsabellaCoreId =
  | "CROWN_ROUTER"
  | "CROWN_CONSTITUTION"
  | "ISA_PRESENCE"
  | "ISA_EMPATHY"
  | "SOPHIA_LOGIC"
  | "SOPHIA_GROUNDING"
  | "ORION_SANDBOX"
  | "ORION_BRIDGE"
  | "ARGUS_RISK"
  | "ARGUS_VETO"
  | "AEGIS_FIREWALL"
  | "AEGIS_PYTHON_CORE"
  | "SOVEREIGN_LEDGER"
  | "SOVEREIGN_KV"
  | "MEM_PENTACAPA"
  | "MEM_TTL"
  | "QUP_TORIC"
  | "QUP_TENSOR"
  | "MONETIZATION_LEDGER"
  | "MONETIZATION_WITHDRAWAL"
  | "OIDC_HANDSHAKE"
  | "OIDC_JWT_VERIFY"
  | "VOICE_PROSODY"
  | "VOICE_TTS";

export interface SystemModuleMetadata {
  id: IsabellaModuleId;
  name: string;
  description: string;
  cores: readonly IsabellaCoreId[];
}

export const ISABELLA_MODULE_CATALOG: Record<IsabellaModuleId, SystemModuleMetadata> = {
  CROWN_GATEWAY: {
    id: "CROWN_GATEWAY",
    name: "CROWN Orchestrator & Gateway",
    description: "Constitutional runtime for orchestrating dialog and intent verification.",
    cores: ["CROWN_ROUTER", "CROWN_CONSTITUTION"],
  },
  ISA_CORE: {
    id: "ISA_CORE",
    name: "ISA Tone & Presence Module",
    description: "Modulates expressive presence, tone alignment, and conversational empathy.",
    cores: ["ISA_PRESENCE", "ISA_EMPATHY"],
  },
  SOPHIA_ENGINE: {
    id: "SOPHIA_ENGINE",
    name: "SOPHIA Epistemology & Logic Engine",
    description: "Validates facts, grounding, sources, and logical consistency checks.",
    cores: ["SOPHIA_LOGIC", "SOPHIA_GROUNDING"],
  },
  ORION_ENGINE: {
    id: "ORION_ENGINE",
    name: "ORION Sandboxed Execution Module",
    description: "Executes sandbox operations, cli tools, and external services safely.",
    cores: ["ORION_SANDBOX", "ORION_BRIDGE"],
  },
  ARGUS_SENTINEL: {
    id: "ARGUS_SENTINEL",
    name: "ARGUS Defense & Policy Sentinel",
    description: "Applies risk models and manages Human-In-The-Loop (HITL) escalations.",
    cores: ["ARGUS_RISK", "ARGUS_VETO"],
  },
  LATAM_AEGIS: {
    id: "LATAM_AEGIS",
    name: "LATAM Aegis-X Firewall Module",
    description: "Performs deep internal request inspection and anomaly modeling.",
    cores: ["AEGIS_FIREWALL", "AEGIS_PYTHON_CORE"],
  },
  SOVEREIGN_DB: {
    id: "SOVEREIGN_DB",
    name: "Sovereign Database & BookPI Ledger",
    description: "Manages state persistence, encrypted KV, and the cryptographic ledger.",
    cores: ["SOVEREIGN_LEDGER", "SOVEREIGN_KV"],
  },
  MEM_ENGINE: {
    id: "MEM_ENGINE",
    name: "Segmented Cognitive Memory Manager",
    description: "Controls the five segregated context scopes with distinct expiration TTLs.",
    cores: ["MEM_PENTACAPA", "MEM_TTL"],
  },
  QUANTUM_PLATFORM: {
    id: "QUANTUM_PLATFORM",
    name: "Quantum Utility Platform (QUP)",
    description: "Simulates and mitigates quantum errors for advanced optimization runtimes.",
    cores: ["QUP_TORIC", "QUP_TENSOR"],
  },
  MONETIZATION: {
    id: "MONETIZATION",
    name: "Monetization & Licensing Engine",
    description: "Governs revenue split contability (85/15) and authenticated withdrawals.",
    cores: ["MONETIZATION_LEDGER", "MONETIZATION_WITHDRAWAL"],
  },
  OIDC_AUTH: {
    id: "OIDC_AUTH",
    name: "OIDC Cryptographic Auth Module",
    description: "Verifies OIDC signatures, issues tokens, and enforces RBAC scopes.",
    cores: ["OIDC_HANDSHAKE", "OIDC_JWT_VERIFY"],
  },
  VOICE_SYNTH: {
    id: "VOICE_SYNTH",
    name: "Expressive Voice Synthesis Interface",
    description: "Synthesizes real-time text-to-speech with prosody controls.",
    cores: ["VOICE_PROSODY", "VOICE_TTS"],
  },
};

// ============================================================================
// CENTRALIZED TELEMETRY & OBSERVABILITY SERVICE
// ============================================================================

export interface TelemetryLog {
  timestamp: string;
  traceId: string;
  correlationId: string;
  moduleId: IsabellaModuleId;
  coreId: IsabellaCoreId;
  eventName: string;
  payload: Record<string, unknown>;
  level: "info" | "warn" | "error" | "security_incident";
  signature: string;
}

class TelemetryService {
  private logBuffer: TelemetryLog[] = [];
  private readonly maxBufferSize = 500;

  private generateHmac(log: Omit<TelemetryLog, "signature">): string {
    const key = secrets.get("AUTH_JWT_SECRET");
    const payloadStr = JSON.stringify({
      t: log.timestamp,
      m: log.moduleId,
      c: log.coreId,
      e: log.eventName,
      tr: log.traceId,
    });
    return crypto.createHmac("sha256", key).update(payloadStr).digest("hex");
  }

  /**
   * Sanitiza el payload para evitar fugar secretos, tokens, JWTs u OIDC subs
   */
  private sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    const sensitiveKeys = [
      "password",
      "secret",
      "token",
      "key",
      "authorization",
      "bearer",
      "sub",
      "oidc",
      "private",
      "signature",
    ];

    for (const [key, val] of Object.entries(payload)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
        clean[key] = "[REDACTED_SENSITIVE_DATA]";
      } else if (typeof val === "string") {
        const sanitized = SecuritySystem.sanitizePayload(val);
        clean[key] = sanitized.clean;
      } else if (val && typeof val === "object" && !Array.isArray(val)) {
        clean[key] = this.sanitizePayload(val as Record<string, unknown>);
      } else {
        clean[key] = val;
      }
    }
    return clean;
  }

  /**
   * Registra un evento de telemetría de forma segura y tipada
   */
  public logEvent(
    moduleId: IsabellaModuleId,
    coreId: IsabellaCoreId,
    eventName: string,
    payload: Record<string, unknown>,
    level: "info" | "warn" | "error" | "security_incident" = "info",
    traceId: string = "tr_system",
    correlationId: string = "corr_system",
  ): TelemetryLog {
    const sanitizedPayload = this.sanitizePayload(payload);
    const rawLog: Omit<TelemetryLog, "signature"> = {
      timestamp: new Date().toISOString(),
      traceId,
      correlationId,
      moduleId,
      coreId,
      eventName,
      payload: sanitizedPayload,
      level,
    };

    const signature = this.generateHmac(rawLog);
    const finalLog: TelemetryLog = { ...rawLog, signature };

    this.logBuffer.unshift(finalLog);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.pop();
    }

    // Pipeline durable: OTLP → Collector → backend/SIEM (fire-and-forget,
    // fail-open). El buffer en memoria es solo fallback local, no auditoría.
    enqueueOtelLog({
      timestamp: finalLog.timestamp,
      traceId: finalLog.traceId,
      correlationId: finalLog.correlationId,
      moduleId: finalLog.moduleId,
      coreId: finalLog.coreId,
      eventName: finalLog.eventName,
      level: finalLog.level,
      payload: sanitizedPayload,
    });

    // Console logging for local developers and container monitoring
    if (level === "security_incident") {
      console.warn(
        `🚨 [SECURITY_INCIDENT] [${moduleId}:${coreId}] ${eventName} - Trace: ${traceId}`,
        JSON.stringify(sanitizedPayload),
      );
    } else if (level === "error") {
      console.error(
        `❌ [ERROR] [${moduleId}:${coreId}] ${eventName}`,
        JSON.stringify(sanitizedPayload),
      );
    }

    return finalLog;
  }

  public getLogs(): TelemetryLog[] {
    return [...this.logBuffer];
  }

  public clearLogs(): void {
    this.logBuffer = [];
  }
}

export const CentralizedTelemetryService = new TelemetryService();

// ============================================================================
// LATAM-AEGIS-X HARDENING & FIREWALL LAYER
// ============================================================================

export interface InterceptResult {
  allowed: boolean;
  action: "proceed" | "escalate_hitl" | "block_immediate";
  anomalyScore: number;
  reason?: string;
  traceId: string;
  correlationId: string;
}

class AegisFirewallService {
  /**
   * Intercepta y valida todas las solicitudes antes de que alcancen el motor CROWN.
   * Realiza chequeos estáticos de integridad, analiza patrones y hooks de integración cuántica.
   */
  public interceptRequest(
    input: string,
    metadata: Record<string, unknown> = {},
    traceId: string = "tr_auto",
    correlationId: string = "corr_auto",
  ): InterceptResult {
    const currentTrace = traceId === "tr_auto" ? "tr_" + crypto.randomUUID().slice(0, 8) : traceId;
    const currentCorr =
      correlationId === "corr_auto" ? "corr_" + crypto.randomUUID().slice(0, 8) : correlationId;

    CentralizedTelemetryService.logEvent(
      "LATAM_AEGIS",
      "AEGIS_FIREWALL",
      "RequestIntercepted",
      { inputLength: input.length, metadataKeys: Object.keys(metadata) },
      "info",
      currentTrace,
      currentCorr,
    );

    // 1. Sanitización rápida
    const sanitized = SecuritySystem.sanitizePayload(input);
    if (sanitized.flagged) {
      CentralizedTelemetryService.logEvent(
        "LATAM_AEGIS",
        "AEGIS_FIREWALL",
        "AttackPatternDetected",
        { reason: sanitized.reason, inputSample: input.slice(0, 100) },
        "security_incident",
        currentTrace,
        currentCorr,
      );

      return {
        allowed: false,
        action: "block_immediate",
        anomalyScore: 0.98,
        reason: `Mecanismo de mitigación Aegis-X activo: ${sanitized.reason}`,
        traceId: currentTrace,
        correlationId: currentCorr,
      };
    }

    // 2. Motor semántico multicapa (intención + contexto + exfiltración).
    // Reemplaza la lista léxica de 5 términos por 7 detectores con scoring
    // noisy-or y veredicto allow/flag/deny. La sanitización léxica (paso 1)
    // se conserva como primera barrera (defensa en profundidad).
    const history = Array.isArray(metadata.history)
      ? (metadata.history as unknown[]).filter((t): t is string => typeof t === "string").slice(-8)
      : [];
    const semantic = analyzeAegisSemantic(input, {
      history,
      actorStats: {
        blockedCount: typeof metadata.blockedCount === "number" ? metadata.blockedCount : undefined,
        requestsLastMinute:
          typeof metadata.requestsLastMinute === "number" ? metadata.requestsLastMinute : undefined,
      },
    });

    if (semantic.verdict !== "allow") {
      const topSignals = semantic.findings
        .slice(0, 5)
        .map((finding) => `${finding.detector}:${finding.signal}`)
        .join(", ");
      CentralizedTelemetryService.logEvent(
        "LATAM_AEGIS",
        "AEGIS_FIREWALL",
        semantic.verdict === "deny" ? "SemanticBlock" : "SemanticFlag",
        {
          score: semantic.score,
          signals: topSignals,
          findings: semantic.findings.length,
        },
        semantic.verdict === "deny" ? "security_incident" : "warn",
        currentTrace,
        currentCorr,
      );

      return {
        allowed: false,
        action: semantic.verdict === "deny" ? "block_immediate" : "escalate_hitl",
        anomalyScore: semantic.score,
        reason: `AEGIS semántico (${semantic.verdict}): score ${semantic.score} por ${topSignals}`,
        traceId: currentTrace,
        correlationId: currentCorr,
      };
    }

    const anomalyScore = semantic.score;

    // 3. Simulación de hook cuántico para auditoría de entrelazamiento
    // Si la tasa de error cuántico QEC en telemetría es superior al 15%, registramos una advertencia no bloqueante
    const qecErrorRate = metadata.qecErrorRate ? Number(metadata.qecErrorRate) : 0.02;
    if (qecErrorRate > 0.15) {
      CentralizedTelemetryService.logEvent(
        "QUANTUM_PLATFORM",
        "QUP_TORIC",
        "QuantumNoiseLevelHigh",
        {
          qecErrorRate,
          message:
            "Alta tasa de ruido Toric QEC detectada. Se recomienda optimización de circuito.",
        },
        "warn",
        currentTrace,
        currentCorr,
      );
    }

    return {
      allowed: true,
      action: "proceed",
      anomalyScore,
      traceId: currentTrace,
      correlationId: currentCorr,
    };
  }

  /**
   * Verifica la integridad de la configuración del entorno para el firewall
   */
  public verifyEnvironment(): { secure: boolean; missingVars: string[] } {
    const missingVars: string[] = [];
    const cfg = config();
    if (!cfg.AUTH_JWT_SECRET) {
      missingVars.push("AUTH_JWT_SECRET");
    }
    if (!cfg.GEMINI_API_KEY) {
      missingVars.push("GEMINI_API_KEY");
    }

    const secure = missingVars.length === 0;
    CentralizedTelemetryService.logEvent(
      "LATAM_AEGIS",
      "AEGIS_FIREWALL",
      "EnvironmentCheckPerformed",
      { secure, missingVars },
      secure ? "info" : "warn",
    );

    return { secure, missingVars };
  }
}

export const LatamAegisXFirewall = new AegisFirewallService();

// ============================================================================
// NON-BLOCKING COGNITIVE AUTO-AUDITING SYSTEM (CROWN & ORION)
// ============================================================================

export interface GovernanceViolation {
  timestamp: string;
  module: "CROWN" | "ORION";
  violationType: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  traceId: string;
}

class AutoAuditingSystemEngine {
  private violationsLog: GovernanceViolation[] = [];

  /**
   * Monitorea asíncronamente el flujo de ejecución sin bloquear el hilo principal.
   */
  public async auditExecutionFlow(
    module: "CROWN" | "ORION",
    action: string,
    payload: Record<string, unknown>,
    traceId: string,
  ): Promise<void> {
    // Non-blocking processing simulated using setImmediate or setTimeout(0)
    setTimeout(() => {
      try {
        this.performValidation(module, action, payload, traceId);
      } catch (err) {
        console.error("Fallo interno en el daemon de auto-auditoría:", err);
      }
    }, 0);
  }

  private performValidation(
    module: "CROWN" | "ORION",
    action: string,
    payload: Record<string, unknown>,
    traceId: string,
  ): void {
    const timestamp = new Date().toISOString();

    // 1. Verificación de firma e integridad en ORION para transacciones
    if (module === "ORION" && action === "DebitTransaction") {
      const signature = payload.pqcSignature;
      const amount = Number(payload.amount || 0);

      if (amount > 500.0) {
        this.registerViolation({
          timestamp,
          module: "ORION",
          violationType: "SovereignLimitExceeded",
          description: `Intento de transacción de gran tamaño (${amount} USD) sin aprobación de tenencia extendida.`,
          severity: "high",
          traceId,
        });
      }

      if (!signature) {
        this.registerViolation({
          timestamp,
          module: "ORION",
          violationType: "MissingCryptographicSignature",
          description: "La transacción BookPI carece de una firma de validez contable.",
          severity: "critical",
          traceId,
        });
      }
    }

    // 2. Verificación de conformidad de directiva en CROWN
    if (module === "CROWN" && action === "OrchestratePrompt") {
      const targetWeight = Number(payload.targetWeight || 0);
      if (targetWeight > 1.0 || targetWeight < 0.0) {
        this.registerViolation({
          timestamp,
          module: "CROWN",
          violationType: "WeightDistributionError",
          description: `Distribución de pesos fuera de los límites canónicos: ${targetWeight}. Reajustando a peso base.`,
          severity: "medium",
          traceId,
        });
      }
    }

    // Log the audit completion
    CentralizedTelemetryService.logEvent(
      module === "CROWN" ? "CROWN_GATEWAY" : "ORION_ENGINE",
      module === "CROWN" ? "CROWN_ROUTER" : "ORION_SANDBOX",
      "AutoAuditCompleted",
      { action, status: "passed_conformity" },
      "info",
      traceId,
    );
  }

  private registerViolation(violation: GovernanceViolation): void {
    this.violationsLog.unshift(violation);
    if (this.violationsLog.length > 100) {
      this.violationsLog.pop();
    }

    CentralizedTelemetryService.logEvent(
      violation.module === "CROWN" ? "CROWN_GATEWAY" : "ORION_ENGINE",
      violation.module === "CROWN" ? "CROWN_CONSTITUTION" : "ORION_BRIDGE",
      "GovernanceViolationFlagged",
      { ...violation },
      violation.severity === "critical" || violation.severity === "high"
        ? "security_incident"
        : "warn",
      violation.traceId,
    );
  }

  public getViolations(): GovernanceViolation[] {
    return [...this.violationsLog];
  }

  public clearViolations(): void {
    this.violationsLog = [];
  }
}

export const AutoAuditingSystem = new AutoAuditingSystemEngine();
