/**
 * Isabella Quantum Mesh — Telemetry & Observability (SQLite-backed)
 * Nunca incluir: tokens, claves, payloads completos, credenciales, datos biométricos.
 */
import { randomUUID } from "node:crypto";
import type { QuantumSpan } from "./contracts";
import { getDatabase } from "../persistence/sqlite";

let useSqlite: boolean | null = null;

function isSqlite(): boolean {
  if (useSqlite !== null) return useSqlite;
  try {
    getDatabase();
    useSqlite = true;
  } catch {
    useSqlite = false;
  }
  return useSqlite;
}

const counters = new Map<string, Map<string, number>>();
const histograms = new Map<string, number[]>();
const spans: QuantumSpan[] = [];
const MAX_SPANS = 5_000;

export function incCounter(
  name: string,
  labels: Record<string, string> = {},
  amount: number = 1,
): void {
  const key = `${name}:${JSON.stringify(labels)}`;
  if (isSqlite()) {
    try {
      const db = getDatabase();
      db.prepare(
        "INSERT INTO telemetry_counters (name, labels, value, timestamp) VALUES (?, ?, ?, ?) ON CONFLICT(name, labels) DO UPDATE SET value = value + excluded.value, timestamp = excluded.timestamp",
      ).run(name, key, amount, new Date().toISOString());
      import("../persistence/postgres")
        .then(({ pgExecute }) =>
          pgExecute(
            `INSERT INTO telemetry_counters (name, labels, value, timestamp) VALUES ($1,$2,$3,$4)`,
            [name, key, amount, new Date().toISOString()],
          ).catch(() => {}),
        )
        .catch(() => {});
      return;
    } catch {
      /* fall through to in-memory */
    }
  }
  const current = counters.get(name)?.get(key) || 0;
  if (!counters.has(name)) counters.set(name, new Map());
  counters.get(name)!.set(key, current + amount);
}

export function observeHistogram(name: string, value: number): void {
  if (isSqlite()) {
    try {
      const db = getDatabase();
      db.prepare("INSERT INTO telemetry_histograms (name, value, timestamp) VALUES (?, ?, ?)").run(
        name,
        value,
        new Date().toISOString(),
      );
      import("../persistence/postgres")
        .then(({ pgExecute }) =>
          pgExecute(`INSERT INTO telemetry_histograms (name, value, timestamp) VALUES ($1,$2,$3)`, [
            name,
            value,
            new Date().toISOString(),
          ]).catch(() => {}),
        )
        .catch(() => {});
      return;
    } catch {
      /* fall through */
    }
  }
  if (!histograms.has(name)) histograms.set(name, []);
  const arr = histograms.get(name)!;
  arr.push(value);
  if (arr.length > 10_000) arr.splice(0, arr.length - 10_000);
}

export function startSpan(params: {
  traceId: string;
  operation: string;
  parentSpanId?: string;
  attributes?: Record<string, string>;
}): QuantumSpan {
  const span: QuantumSpan = {
    spanId: randomUUID(),
    traceId: params.traceId,
    parentSpanId: params.parentSpanId,
    operation: params.operation,
    startTime: new Date().toISOString(),
    status: "ok",
    attributes: params.attributes || {},
  };

  if (isSqlite()) {
    try {
      const db = getDatabase();
      db.prepare(
        `INSERT INTO telemetry_spans (spanId, traceId, parentSpanId, operation, startTime, endTime, durationMs, status, attributes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        span.spanId,
        span.traceId,
        span.parentSpanId ?? null,
        span.operation,
        span.startTime,
        null,
        null,
        span.status,
        JSON.stringify(span.attributes),
      );
      import("../persistence/postgres")
        .then(({ pgExecute }) =>
          pgExecute(
            `INSERT INTO telemetry_spans (spanId, traceId, parentSpanId, operation, startTime, endTime, durationMs, status, attributes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              span.spanId,
              span.traceId,
              span.parentSpanId ?? null,
              span.operation,
              span.startTime,
              null,
              null,
              span.status,
              JSON.stringify(span.attributes),
            ],
          ).catch(() => {}),
        )
        .catch(() => {});
      return span;
    } catch {
      /* fall through */
    }
  }

  spans.push(span);
  if (spans.length > MAX_SPANS) spans.splice(0, spans.length - MAX_SPANS);
  return span;
}

export function endSpan(spanId: string, status: "ok" | "error" | "degraded" = "ok"): void {
  if (isSqlite()) {
    try {
      const db = getDatabase();
      const row = db
        .prepare("SELECT startTime FROM telemetry_spans WHERE spanId = ?")
        .get(spanId) as { startTime: string } | undefined;
      if (row) {
        const endTime = new Date().toISOString();
        const durationMs = new Date(endTime).getTime() - new Date(row.startTime).getTime();
        db.prepare(
          "UPDATE telemetry_spans SET endTime = ?, durationMs = ?, status = ? WHERE spanId = ?",
        ).run(endTime, durationMs, status, spanId);
      }
      return;
    } catch {
      /* fall through */
    }
  }
  const span = spans.find((s) => s.spanId === spanId);
  if (!span) return;
  span.endTime = new Date().toISOString();
  span.durationMs = new Date(span.endTime).getTime() - new Date(span.startTime).getTime();
  span.status = status;
}

export const QUANTUM_COUNTERS = {
  requestsAccepted: (provider: string, tenantClass: string) =>
    incCounter("quantum_requests_total", {
      provider,
      status: "accepted",
      tenant_class: tenantClass,
    }),
  requestsRejected: (provider: string, reason: string) =>
    incCounter("quantum_requests_total", { provider, status: "rejected", tenant_class: reason }),
  jobQueued: (provider: string) => incCounter("quantum_jobs_total", { provider, status: "queued" }),
  jobStarted: (provider: string) =>
    incCounter("quantum_jobs_total", { provider, status: "started" }),
  jobCompleted: (provider: string) =>
    incCounter("quantum_jobs_total", { provider, status: "completed" }),
  jobDegraded: (provider: string) =>
    incCounter("quantum_jobs_total", { provider, status: "degraded" }),
  jobFailed: (provider: string) => incCounter("quantum_jobs_total", { provider, status: "failed" }),
  workerReplaced: (pool: string) => incCounter("quantum_worker_restarts_total", { pool }),
  providerUnavailable: (provider: string) =>
    incCounter("quantum_provider_unavailable_total", { provider }),
  policyDenial: (reason: string) => incCounter("quantum_policy_denials_total", { reason }),
  fallback: (reason: string) => incCounter("quantum_fallback_total", { reason }),
  bookpiCommitFailure: () => incCounter("quantum_bookpi_commit_failures_total"),
  federationReplicationFailure: (node: string) =>
    incCounter("quantum_federation_replication_failures_total", { node }),
  hsmSignLatency: (ms: number) => observeHistogram("quantum_hsm_sign_latency_ms", ms),
  teeAttestationFailure: () => incCounter("quantum_tee_attestation_failures_total"),
};

export const QUANTUM_HISTOGRAMS = {
  requestDuration: (provider: string, ms: number) =>
    observeHistogram(`quantum_request_duration_ms:${provider}`, ms),
  queueWait: (provider: string, ms: number) =>
    observeHistogram(`quantum_queue_wait_ms:${provider}`, ms),
};

export function getCounterValue(name: string, labels?: Record<string, string>): number {
  if (isSqlite()) {
    try {
      const db = getDatabase();
      if (!labels) {
        const row = db
          .prepare("SELECT SUM(value) as total FROM telemetry_counters WHERE name = ?")
          .get(name) as { total: number | null };
        return row?.total ?? 0;
      }
      const key = `${name}:${JSON.stringify(labels)}`;
      const row = db
        .prepare("SELECT value FROM telemetry_counters WHERE name = ? AND labels = ?")
        .get(name, key) as { value: number } | undefined;
      return row?.value ?? 0;
    } catch {
      /* fall through */
    }
  }
  if (!labels) {
    let total = 0;
    const labelMap = counters.get(name);
    if (labelMap) for (const v of labelMap.values()) total += v;
    return total;
  }
  const key = `${name}:${JSON.stringify(labels)}`;
  return counters.get(name)?.get(key) || 0;
}

export function getHistogramStats(name: string): {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
} {
  if (isSqlite()) {
    try {
      const db = getDatabase();
      const rows = db
        .prepare("SELECT value FROM telemetry_histograms WHERE name = ? ORDER BY value")
        .all(name) as Array<{ value: number }>;
      if (rows.length === 0) return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
      const sorted = rows.map((r) => r.value);
      return {
        count: sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      };
    } catch {
      /* fall through */
    }
  }
  const values = histograms.get(name) || [];
  if (values.length === 0) return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
  };
}

export function getSpans(traceId: string): QuantumSpan[] {
  if (isSqlite()) {
    try {
      const db = getDatabase();
      const rows = db
        .prepare("SELECT * FROM telemetry_spans WHERE traceId = ?")
        .all(traceId) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        spanId: r.spanId as string,
        traceId: r.traceId as string,
        parentSpanId: (r.parentSpanId as string) ?? undefined,
        operation: r.operation as string,
        startTime: r.startTime as string,
        endTime: (r.endTime as string) ?? undefined,
        durationMs: (r.durationMs as number) ?? undefined,
        status: r.status as QuantumSpan["status"],
        attributes: r.attributes ? JSON.parse(r.attributes as string) : {},
      }));
    } catch {
      /* fall through */
    }
  }
  return spans.filter((s) => s.traceId === traceId);
}

export function getTelemetrySnapshot() {
  const allCounters: Record<string, number> = {};

  if (isSqlite()) {
    try {
      const db = getDatabase();
      const rows = db
        .prepare("SELECT name, SUM(value) as total FROM telemetry_counters GROUP BY name")
        .all() as Array<{ name: string; total: number }>;
      for (const r of rows) allCounters[r.name] = r.total;
      const histNames = db
        .prepare("SELECT DISTINCT name FROM telemetry_histograms")
        .all() as Array<{ name: string }>;
      const histogramsData = Object.fromEntries(
        histNames.map((h) => [h.name, getHistogramStats(h.name)]),
      );
      const activeSpans = db
        .prepare("SELECT COUNT(*) as cnt FROM telemetry_spans WHERE endTime IS NULL")
        .get() as { cnt: number };
      const totalSpans = db.prepare("SELECT COUNT(*) as cnt FROM telemetry_spans").get() as {
        cnt: number;
      };
      return {
        counters: allCounters,
        histograms: histogramsData,
        activeSpans: activeSpans.cnt,
        totalSpans: totalSpans.cnt,
      };
    } catch {
      /* fall through */
    }
  }

  for (const [name, labelMap] of counters) {
    let total = 0;
    for (const v of labelMap.values()) total += v;
    allCounters[name] = total;
  }
  return {
    counters: allCounters,
    histograms: Object.fromEntries(
      Array.from(histograms.keys()).map((k) => [k, getHistogramStats(k)]),
    ),
    activeSpans: spans.filter((s) => !s.endTime).length,
    totalSpans: spans.length,
  };
}
