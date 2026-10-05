import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server, type IncomingMessage } from "node:http";

/**
 * EXPORTADOR OTLP (test/unit/otel-exporter.test.ts)
 * -----------------------------------------------------------------
 * Evidencia de pipeline durable: un Collector OTLP/HTTP local recibe el
 * lote con estructura OTLP válida, atributos de correlación y servicio.
 */

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

describe("OTel exporter durable", () => {
  let server: Server;
  let received: Array<{ url: string; body: unknown }>;
  let endpoint = "";

  beforeEach(async () => {
    received = [];
    server = createServer(async (request, response) => {
      const body = await readBody(request);
      try {
        if (body) received.push({ url: request.url ?? "", body: JSON.parse(body) });
      } catch (e) {
        // Ignore parse errors from interrupted tests
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    endpoint = `http://127.0.0.1:${port}`;
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint);
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const { drainOtelOutboxForTests } = await import("@/lib/otel-exporter");
    drainOtelOutboxForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("entrega un lote OTLP válido al collector", async () => {
    const { enqueueOtelLog, flushOtelOutbox } = await import("@/lib/otel-exporter");
    enqueueOtelLog({
      timestamp: new Date().toISOString(),
      traceId: "tr_test_123",
      correlationId: "corr_test_456",
      moduleId: "LATAM_AEGIS",
      coreId: "AEGIS_FIREWALL",
      eventName: "SemanticBlock",
      level: "security_incident",
      payload: { score: 0.91 },
    });

    const result = await flushOtelOutbox();
    expect(result.attempted).toBe(true);
    expect(result.delivered).toBe(true);
    expect(result.count).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe("/v1/logs");

    const body = received[0].body as {
      resourceLogs: Array<{
        resource: { attributes: Array<{ key: string }> };
        scopeLogs: Array<{
          logRecords: Array<{
            severityText: string;
            attributes: Array<{ key: string; value: { stringValue: string } }>;
          }>;
        }>;
      }>;
    };
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(record.severityText).toBe("SECURITY_INCIDENT");
    const keys = record.attributes.map((attribute) => attribute.key);
    expect(keys).toContain("isabella.trace_id");
    expect(keys).toContain("isabella.correlation_id");
    const trace = record.attributes.find((attribute) => attribute.key === "isabella.trace_id");
    expect(trace?.value.stringValue).toBe("tr_test_123");
  });

  it("sin endpoint no intenta red (documentado, no silente)", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const { enqueueOtelLog, flushOtelOutbox } = await import("@/lib/otel-exporter");
    enqueueOtelLog({
      timestamp: new Date().toISOString(),
      traceId: "tr_x",
      correlationId: "corr_x",
      moduleId: "M",
      coreId: "C",
      eventName: "E",
      level: "info",
      payload: {},
    });
    const result = await flushOtelOutbox();
    expect(result.attempted).toBe(false);
    expect(result.error).toBe("no-endpoint");
    expect(received).toHaveLength(0);
  });

  it("collector caído no rompe (fail-open con error tipado)", async () => {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const { enqueueOtelLog, flushOtelOutbox } = await import("@/lib/otel-exporter");
    enqueueOtelLog({
      timestamp: new Date().toISOString(),
      traceId: "tr_x",
      correlationId: "corr_x",
      moduleId: "M",
      coreId: "C",
      eventName: "E",
      level: "error",
      payload: {},
    });
    const result = await flushOtelOutbox();
    expect(result.attempted).toBe(true);
    expect(result.delivered).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("migración TelemetryService → OTel", () => {
  it("logEvent encola al outbox durable además del buffer local", async () => {
    vi.stubEnv("AUTH_JWT_SECRET", "test-jwt-secret-min-32-chars-0123456789");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
    const { CentralizedTelemetryService } = await import("@/lib/latam-aegis-x");
    const { drainOtelOutboxForTests } = await import("@/lib/otel-exporter");
    drainOtelOutboxForTests();

    const logged = CentralizedTelemetryService.logEvent(
      "LATAM_AEGIS",
      "AEGIS_FIREWALL",
      "MigrationProbe",
      { probe: true },
      "info",
      "tr_probe",
      "corr_probe",
    );
    expect(logged.traceId).toBe("tr_probe");

    const queued = drainOtelOutboxForTests();
    expect(queued).toHaveLength(1);
    expect(queued[0].eventName).toBe("MigrationProbe");
    expect(queued[0].traceId).toBe("tr_probe");
    vi.unstubAllEnvs();
    resetConfigCache();
  });
});
