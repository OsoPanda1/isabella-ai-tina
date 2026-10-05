/**
 * TELEMETRÍA DE CLIENTE (src/lib/telemetry/telemetry-client.ts)
 * -------------------------------------------------------------
 * Búfer de telemetría seguro para el navegador. Comparte el contrato de
 * `TelemetryLog` con el servicio soberano del servidor, pero NO firma con
 * secretos ni toca `node:crypto`: los secretos jamás deben viajar al cliente.
 * Los eventos de la sesión se marcan con un sello local no criptográfico para
 * poder correlacionarlos en la UI.
 */

import type { IsabellaCoreId, IsabellaModuleId } from "../isabella-catalog";

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

const SENSITIVE_KEYS = [
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

/** Sello local FNV-1a: sirve para deduplicar y correlacionar, no para probar autenticidad. */
function localSeal(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `local_${h.toString(16).padStart(8, "0")}`;
}

class ClientTelemetryService {
  private logBuffer: TelemetryLog[] = [];
  private readonly maxBufferSize = 500;

  private sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(payload)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
        clean[key] = "[REDACTED_SENSITIVE_DATA]";
      } else if (val && typeof val === "object" && !Array.isArray(val)) {
        clean[key] = this.sanitizePayload(val as Record<string, unknown>);
      } else {
        clean[key] = val;
      }
    }
    return clean;
  }

  public logEvent(
    moduleId: IsabellaModuleId,
    coreId: IsabellaCoreId,
    eventName: string,
    payload: Record<string, unknown>,
    level: TelemetryLog["level"] = "info",
    traceId: string = "tr_client",
    correlationId: string = "corr_client",
  ): TelemetryLog {
    const sanitizedPayload = this.sanitizePayload(payload);
    const timestamp = new Date().toISOString();
    const finalLog: TelemetryLog = {
      timestamp,
      traceId,
      correlationId,
      moduleId,
      coreId,
      eventName,
      payload: sanitizedPayload,
      level,
      signature: localSeal(`${timestamp}|${moduleId}|${coreId}|${eventName}|${traceId}`),
    };

    this.logBuffer.unshift(finalLog);
    if (this.logBuffer.length > this.maxBufferSize) this.logBuffer.pop();

    if (level === "security_incident") {
      console.warn(`[SECURITY_INCIDENT] [${moduleId}:${coreId}] ${eventName}`);
    } else if (level === "error") {
      console.error(`[ERROR] [${moduleId}:${coreId}] ${eventName}`);
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

export const CentralizedTelemetryService = new ClientTelemetryService();
