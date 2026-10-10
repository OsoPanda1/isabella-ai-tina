/**
 * @file otel-init.ts
 * @description Configuración e inicialización de OpenTelemetry OTLP para observabilidad
 * distribuida según lo definido en .env.example (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_SERVICE_NAME).
 * Autoría: Edwin Oswaldo Castillo Trejo (Anubis Villaseñor)
 * Ecosistema: TAMV ONLINE NETWORK / Nodo Cero (Real del Monte, Hidalgo, México)
 */

import { randomUUID } from "node:crypto";
import { config, passthroughEnv } from "../config";
import { createOTelEvent, toOTelLog, type MetricKind } from "./otel-neutral";

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface SpanRecord {
  context: SpanContext;
  name: string;
  kind: "INTERNAL" | "SERVER" | "CLIENT" | "PRODUCER" | "CONSUMER";
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  durationMs: number;
  status: {
    code: "UNSET" | "OK" | "ERROR";
    message?: string;
  };
  attributes: Record<string, string | number | boolean>;
}

export interface OTelMetricPoint {
  name: string;
  description?: string;
  unit?: string;
  value: number;
  timestampUnixNano: string;
  attributes: Record<string, string | number | boolean>;
}

class OpenTelemetryService {
  private static instance: OpenTelemetryService | null = null;
  private endpoint: string | null = null;
  private serviceName = "isabella-ai";
  private isEnabled = false;
  private isInitialized = false;

  private spanQueue: SpanRecord[] = [];
  private metricQueue: OTelMetricPoint[] = [];
  private maxQueueSize = 250;
  private flushTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.init();
  }

  public static getInstance(): OpenTelemetryService {
    if (!OpenTelemetryService.instance) {
      OpenTelemetryService.instance = new OpenTelemetryService();
    }
    return OpenTelemetryService.instance;
  }

  public init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      const cfg = config();
      this.serviceName = cfg.OTEL_SERVICE_NAME || "isabella-ai";
      const endpoint = cfg.OTEL_EXPORTER_OTLP_ENDPOINT;

      if (endpoint && endpoint.trim().length > 0) {
        this.endpoint = endpoint.trim().replace(/\/+$/, "");
        this.isEnabled = true;
        console.log(
          `[OpenTelemetry] Inicializado con endpoint OTLP: ${this.endpoint} (Service: ${this.serviceName})`,
        );
      } else {
        this.isEnabled = false;
        console.log(
          `[OpenTelemetry] Endpoint OTLP no definido en .env. Modo local de observabilidad activado.`,
        );
      }

      // Iniciar ciclo de vaciado por lotes (cada 5 segundos)
      if (typeof setInterval !== "undefined") {
        this.flushTimer = setInterval(() => {
          void this.flush();
        }, 5000);
      }
    } catch (err) {
      this.isEnabled = false;
      console.warn("[OpenTelemetry] Error inicializando configuración OTel:", err);
    }
  }

  public generateTraceId(): string {
    return randomUUID().replace(/-/g, "");
  }

  public generateSpanId(): string {
    return randomUUID().replace(/-/g, "").slice(0, 16);
  }

  /**
   * Ejecuta una función instrumentada bajo un span de OpenTelemetry
   */
  public async withSpan<T>(
    name: string,
    operation: (spanContext: SpanContext) => Promise<T>,
    options?: {
      kind?: "INTERNAL" | "SERVER" | "CLIENT";
      parentSpanId?: string;
      traceId?: string;
      attributes?: Record<string, string | number | boolean>;
    },
  ): Promise<T> {
    const traceId = options?.traceId || this.generateTraceId();
    const spanId = this.generateSpanId();
    const spanContext: SpanContext = {
      traceId,
      spanId,
      parentSpanId: options?.parentSpanId,
    };

    const startTime = performance.now();
    const startUnixNano = (BigInt(Date.now()) * 1_000_000n).toString();
    const attributes = { ...(options?.attributes || {}) };

    try {
      const result = await operation(spanContext);
      const elapsed = performance.now() - startTime;
      const endUnixNano = (BigInt(Date.now()) * 1_000_000n).toString();

      this.recordSpan({
        context: spanContext,
        name,
        kind: options?.kind || "INTERNAL",
        startTimeUnixNano: startUnixNano,
        endTimeUnixNano: endUnixNano,
        durationMs: Number(elapsed.toFixed(2)),
        status: { code: "OK" },
        attributes,
      });

      return result;
    } catch (error) {
      const elapsed = performance.now() - startTime;
      const endUnixNano = (BigInt(Date.now()) * 1_000_000n).toString();
      const errorMessage = error instanceof Error ? error.message : String(error);

      attributes["error"] = true;
      attributes["error.message"] = errorMessage;

      this.recordSpan({
        context: spanContext,
        name,
        kind: options?.kind || "INTERNAL",
        startTimeUnixNano: startUnixNano,
        endTimeUnixNano: endUnixNano,
        durationMs: Number(elapsed.toFixed(2)),
        status: { code: "ERROR", message: errorMessage },
        attributes,
      });

      throw error;
    }
  }

  public recordSpan(span: SpanRecord): void {
    // También enviamos evento estructurado a OTel neutral / logs locales
    const otelEvent = createOTelEvent({
      traceId: span.context.traceId,
      kind: (span.status.code === "ERROR" ? "error" : "request") as MetricKind,
      name: span.name,
      durationMs: span.durationMs,
      status: span.status.code === "OK" ? "ok" : "error",
      attributes: {
        service_name: this.serviceName,
        span_id: span.context.spanId,
        parent_span_id: span.context.parentSpanId || "",
        ...span.attributes,
      },
    });

    if (passthroughEnv("NODE_ENV") === "development" && span.status.code === "ERROR") {
      console.log(`[OTel] ${toOTelLog(otelEvent)}`);
    }

    if (!this.isEnabled) return;

    this.spanQueue.push(span);
    if (this.spanQueue.length >= this.maxQueueSize) {
      void this.flush();
    }
  }

  public recordMetric(metric: {
    name: string;
    value: number;
    unit?: string;
    description?: string;
    attributes?: Record<string, string | number | boolean>;
  }): void {
    if (!this.isEnabled) return;

    this.metricQueue.push({
      name: metric.name,
      value: metric.value,
      unit: metric.unit || "1",
      description: metric.description,
      timestampUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
      attributes: metric.attributes || {},
    });

    if (this.metricQueue.length >= this.maxQueueSize) {
      void this.flush();
    }
  }

  /**
   * Envía las trazas y métricas acumuladas al OTLP collector
   */
  public async flush(): Promise<void> {
    if (!this.isEnabled || !this.endpoint) {
      this.spanQueue = [];
      this.metricQueue = [];
      return;
    }

    if (this.spanQueue.length === 0 && this.metricQueue.length === 0) return;

    const currentSpans = [...this.spanQueue];
    const currentMetrics = [...this.metricQueue];
    this.spanQueue = [];
    this.metricQueue = [];

    // 1. Exportar Spans (OTLP /v1/traces)
    if (currentSpans.length > 0) {
      const tracesUrl = this.endpoint.endsWith("/v1/traces")
        ? this.endpoint
        : `${this.endpoint}/v1/traces`;

      const payload = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: this.serviceName } },
                { key: "service.version", value: { stringValue: "4.3.3" } },
                {
                  key: "deployment.environment",
                  value: { stringValue: passthroughEnv("NODE_ENV") || "development" },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "isabella-core-tracer", version: "1.0.0" },
                spans: currentSpans.map((s) => ({
                  traceId: s.context.traceId,
                  spanId: s.context.spanId,
                  parentSpanId: s.context.parentSpanId || "",
                  name: s.name,
                  kind: s.kind === "SERVER" ? 2 : s.kind === "CLIENT" ? 3 : 1,
                  startTimeUnixNano: s.startTimeUnixNano,
                  endTimeUnixNano: s.endTimeUnixNano,
                  attributes: Object.entries(s.attributes).map(([k, v]) => ({
                    key: k,
                    value:
                      typeof v === "number"
                        ? { doubleValue: v }
                        : typeof v === "boolean"
                          ? { boolValue: v }
                          : { stringValue: String(v) },
                  })),
                  status: {
                    code: s.status.code === "OK" ? 1 : s.status.code === "ERROR" ? 2 : 0,
                    message: s.status.message,
                  },
                })),
              },
            ],
          },
        ],
      };

      try {
        await fetch(tracesUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(3000),
        });
      } catch (err) {
        // En caso de fallo en el colector no interrumpir la ejecución
        console.warn("[OpenTelemetry] Error enviando lote de trazas a OTLP:", err);
      }
    }

    // 2. Exportar Métricas (OTLP /v1/metrics)
    if (currentMetrics.length > 0) {
      const metricsUrl = this.endpoint.endsWith("/v1/metrics")
        ? this.endpoint
        : `${this.endpoint}/v1/metrics`;

      const metricPayload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [{ key: "service.name", value: { stringValue: this.serviceName } }],
            },
            scopeMetrics: [
              {
                scope: { name: "isabella-metrics", version: "1.0.0" },
                metrics: currentMetrics.map((m) => ({
                  name: m.name,
                  description: m.description || "",
                  unit: m.unit || "1",
                  gauge: {
                    dataPoints: [
                      {
                        timeUnixNano: m.timestampUnixNano,
                        asDouble: m.value,
                        attributes: Object.entries(m.attributes).map(([k, v]) => ({
                          key: k,
                          value: { stringValue: String(v) },
                        })),
                      },
                    ],
                  },
                })),
              },
            ],
          },
        ],
      };

      try {
        await fetch(metricsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metricPayload),
          signal: AbortSignal.timeout(3000),
        });
      } catch (err) {
        console.warn("[OpenTelemetry] Error enviando métricas a OTLP:", err);
      }
    }
  }

  public getStatus() {
    return {
      initialized: this.isInitialized,
      enabled: this.isEnabled,
      serviceName: this.serviceName,
      endpoint: this.endpoint,
      queueDepth: {
        spans: this.spanQueue.length,
        metrics: this.metricQueue.length,
      },
    };
  }

  public shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush();
  }
}

export const otelService = OpenTelemetryService.getInstance();
export const initOpenTelemetry = () => otelService.init();
export const withSpan = <T>(
  name: string,
  op: (ctx: SpanContext) => Promise<T>,
  options?: Parameters<OpenTelemetryService["withSpan"]>[2],
) => otelService.withSpan(name, op, options);
export const recordSpan = (span: SpanRecord) => otelService.recordSpan(span);
export const recordMetric = (m: Parameters<OpenTelemetryService["recordMetric"]>[0]) =>
  otelService.recordMetric(m);
export const flushTelemetry = () => otelService.flush();
