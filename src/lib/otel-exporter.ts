/**
 * EXPORTADOR OTLP DURABLE (src/lib/otel-exporter.ts)
 * -----------------------------------------------------------------
 * Puente real: Telemetría → OTLP/HTTP → Collector → backend durable
 * → SIEM/observabilidad. El buffer en memoria (500 registros) queda
 * degradado a fallback local de último recurso, NUNCA como auditoría.
 *
 * Diseño:
 *  - `enqueueOtelLog`: encola sin bloquear; jamás lanza (fail-open solo
 *    para telemetría: un fallo de observabilidad nunca rompe requests).
 *  - `flushOtelOutbox`: POST OTLP/HTTP JSON a
 *    `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs` con timeout de 3s.
 *  - Auto-flush cada 5s (timer unref) + flush en `getLogs` si >50 pendientes.
 *  - Sin endpoint configurado: no-op documentado (desarrollo local).
 */

import { config } from "./config";

export interface OtelQueuedLog {
  timestamp: string;
  traceId: string;
  correlationId: string;
  moduleId: string;
  coreId: string;
  eventName: string;
  level: string;
  payload: Record<string, unknown>;
}

export interface OtelFlushResult {
  attempted: boolean;
  delivered: boolean;
  count: number;
  error?: string;
}

const outbox: OtelQueuedLog[] = [];
const FLUSH_INTERVAL_MS = 5000;
const FETCH_TIMEOUT_MS = 3000;
let timerStarted = false;

function endpoint(): string | undefined {
  try {
    const url = config().OTEL_EXPORTER_OTLP_ENDPOINT;
    return url && url.length > 0 ? url.replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
}

function serviceName(): string {
  try {
    return config().OTEL_SERVICE_NAME || "isabella-ai";
  } catch {
    return "isabella-ai";
  }
}

function toUnixNano(iso: string): string {
  const ms = Date.parse(iso);
  const safe = Number.isFinite(ms) ? ms : Date.now();
  return String(BigInt(safe) * 1_000_000n);
}

function attribute(key: string, value: unknown): { key: string; value: { stringValue: string } } {
  let rendered: string;
  if (typeof value === "string") rendered = value;
  else {
    try {
      rendered = JSON.stringify(value) ?? "null";
    } catch {
      rendered = "[unserializable]";
    }
  }
  return { key, value: { stringValue: rendered.slice(0, 4000) } };
}

/** Encola un log para exportación durable. Nunca lanza. */
export function enqueueOtelLog(log: OtelQueuedLog): void {
  try {
    outbox.push(log);
    startTimer();
    if (outbox.length >= 50) void flushOtelOutbox();
  } catch {
    // Telemetría fail-open: nunca romper el request por observabilidad.
  }
}

function startTimer(): void {
  if (timerStarted) return;
  timerStarted = true;
  try {
    const timer = setInterval(() => {
      void flushOtelOutbox();
    }, FLUSH_INTERVAL_MS);
    // No retener el proceso por telemetría (tests, CLI, serverless).
    (timer as unknown as { unref?: () => void }).unref?.();
  } catch {
    timerStarted = false;
  }
}

/** Envía lo encolado al Collector OTLP/HTTP. Nunca lanza. */
export async function flushOtelOutbox(): Promise<OtelFlushResult> {
  const batch = outbox.splice(0, outbox.length);
  if (batch.length === 0) return { attempted: false, delivered: false, count: 0 };

  const url = endpoint();
  if (!url) {
    // Sin collector configurado: se descarta el lote (el buffer en memoria
    // conserva los últimos 500 para depuración local). Documentado, no silente.
    return {
      attempted: false,
      delivered: false,
      count: batch.length,
      error: "no-endpoint",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const body = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              attribute("service.name", serviceName()),
              attribute("service.version", "v4.2.0"),
            ],
          },
          scopeLogs: [
            {
              scope: { name: "isabella-telemetry" },
              logRecords: batch.map((log) => ({
                timeUnixNano: toUnixNano(log.timestamp),
                severityText: log.level.toUpperCase(),
                body: {
                  stringValue: `${log.moduleId}:${log.coreId}:${log.eventName}`,
                },
                attributes: [
                  attribute("isabella.trace_id", log.traceId),
                  attribute("isabella.correlation_id", log.correlationId),
                  attribute("isabella.module", log.moduleId),
                  attribute("isabella.core", log.coreId),
                  attribute("isabella.event", log.eventName),
                  attribute("isabella.payload", log.payload),
                ],
              })),
            },
          ],
        },
      ],
    };
    const response = await fetch(`${url}/v1/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        attempted: true,
        delivered: false,
        count: batch.length,
        error: `http-${response.status}`,
      };
    }
    return { attempted: true, delivered: true, count: batch.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return {
      attempted: true,
      delivered: false,
      count: batch.length,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Solo tests: drena la cola sin red. */
export function drainOtelOutboxForTests(): OtelQueuedLog[] {
  return outbox.splice(0, outbox.length);
}

export const OTEL_EXPORTER = {
  enqueue: enqueueOtelLog,
  flush: flushOtelOutbox,
  drainForTests: drainOtelOutboxForTests,
};
