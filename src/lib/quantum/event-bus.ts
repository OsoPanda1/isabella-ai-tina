/**
 * Isabella Quantum Mesh — Quantum Event Bus (SQLite-backed)
 * Eventos tipados con trazabilidad completa entre los 24 núcleos.
 * Persiste en SQLite. Fallback a in-memory si better-sqlite3 no está disponible.
 */
import { randomUUID, createHash } from "node:crypto";
import type { IsabellaEvent, QuantumEventType } from "./contracts";
import { getDatabase } from "../persistence/sqlite";

type EventHandler<T = unknown> = (event: IsabellaEvent<T>) => void | Promise<void>;

const handlers = new Map<string, Set<EventHandler>>();
let lastEventHash: string = createHash("sha256").update("genesis").digest("hex");

const fallbackLog: IsabellaEvent[] = [];
const MAX_LOG_SIZE = 5_000;
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

function loadLastHash(): void {
  if (!isSqlite()) return;
  try {
    const db = getDatabase();
    const row = db
      .prepare("SELECT payloadHash FROM quantum_events ORDER BY rowid DESC LIMIT 1")
      .get() as { payloadHash: string } | undefined;
    if (row) lastEventHash = row.payloadHash;
  } catch {
    /* ignore */
  }
}

let hashLoaded = false;

export function emitQuantumEvent<T = unknown>(
  eventType: QuantumEventType,
  data: T,
  meta: {
    traceId: string;
    requestId: string;
    tenantId: string;
    subjectId: string;
    originCore: number;
    targetCore?: number;
    policyVersion?: string;
  },
): IsabellaEvent<T> {
  if (!hashLoaded) {
    loadLastHash();
    hashLoaded = true;
  }

  const payloadStr = JSON.stringify(data);
  const payloadHash = createHash("sha256").update(payloadStr).digest("hex");

  const event: IsabellaEvent<T> = {
    eventId: randomUUID(),
    eventType,
    schemaVersion: "isabella-quantum-v1",
    traceId: meta.traceId,
    requestId: meta.requestId,
    tenantId: meta.tenantId,
    subjectId: meta.subjectId,
    originCore: meta.originCore,
    targetCore: meta.targetCore,
    occurredAt: new Date().toISOString(),
    policyVersion: meta.policyVersion || "quantum-policy-v1",
    payloadHash,
    previousEventHash: lastEventHash,
    data,
  };

  lastEventHash = createHash("sha256")
    .update(`${lastEventHash}:${event.eventId}:${payloadHash}`)
    .digest("hex");

  if (isSqlite()) {
    try {
      const db = getDatabase();
      db.prepare(
        `INSERT INTO quantum_events (eventId, eventType, schemaVersion, traceId, requestId, tenantId, subjectId, originCore, targetCore, occurredAt, policyVersion, payloadHash, previousEventHash, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.eventId,
        event.eventType,
        event.schemaVersion,
        event.traceId,
        event.requestId,
        event.tenantId,
        event.subjectId,
        event.originCore,
        event.targetCore ?? null,
        event.occurredAt,
        event.policyVersion,
        event.payloadHash,
        event.previousEventHash ?? null,
        JSON.stringify(data),
      );
      import("../persistence/postgres")
        .then(({ pgExecute }) =>
          pgExecute(
            `INSERT INTO quantum_events (eventId, eventType, schemaVersion, traceId, requestId, tenantId, subjectId, originCore, targetCore, occurredAt, policyVersion, payloadHash, previousEventHash, data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (eventId) DO NOTHING`,
            [
              event.eventId,
              event.eventType,
              event.schemaVersion,
              event.traceId,
              event.requestId,
              event.tenantId,
              event.subjectId,
              event.originCore,
              event.targetCore ?? null,
              event.occurredAt,
              event.policyVersion,
              event.payloadHash,
              event.previousEventHash ?? null,
              JSON.stringify(data),
            ],
          ).catch(() => {}),
        )
        .catch(() => {});
    } catch {
      /* fall through */
    }
  } else {
    fallbackLog.push(event as IsabellaEvent);
    if (fallbackLog.length > MAX_LOG_SIZE) fallbackLog.splice(0, fallbackLog.length - MAX_LOG_SIZE);
  }

  const eventHandlers = handlers.get(eventType);
  if (eventHandlers) {
    for (const h of eventHandlers) {
      Promise.resolve(h(event as IsabellaEvent)).catch((err) => {
        console.error(`[EventBus] Handler error for ${eventType}:`, err);
      });
    }
  }

  return event;
}

export function getEventBusHealth() {
  let totalEvents = 0;
  if (isSqlite()) {
    try {
      const db = getDatabase();
      const countRow = db.prepare("SELECT COUNT(*) as cnt FROM quantum_events").get() as {
        cnt: number;
      };
      totalEvents = countRow.cnt;
    } catch {
      /* ignore */
    }
  } else {
    totalEvents = fallbackLog.length;
  }
  return {
    totalEvents,
    handlerCount: Array.from(handlers.values()).reduce((sum, s) => sum + s.size, 0),
    lastEventHash,
    healthy: true,
  };
}

export function onQuantumEvent(eventType: string, handler: EventHandler): () => void {
  if (!handlers.has(eventType)) handlers.set(eventType, new Set());
  handlers.get(eventType)!.add(handler);
  return () => handlers.get(eventType)?.delete(handler);
}

export function getEventLog(limit: number = 100): IsabellaEvent[] {
  if (isSqlite()) {
    try {
      const db = getDatabase();
      const rows = db
        .prepare(
          `SELECT eventId, eventType, schemaVersion, traceId, requestId, tenantId, subjectId, originCore, targetCore, occurredAt, policyVersion, payloadHash, previousEventHash, data
         FROM quantum_events ORDER BY rowid DESC LIMIT ?`,
        )
        .all(limit) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        eventId: r.eventId,
        eventType: r.eventType,
        schemaVersion: r.schemaVersion,
        traceId: r.traceId,
        requestId: r.requestId,
        tenantId: r.tenantId,
        subjectId: r.subjectId,
        originCore: r.originCore,
        targetCore: r.targetCore,
        occurredAt: r.occurredAt,
        policyVersion: r.policyVersion,
        payloadHash: r.payloadHash,
        previousEventHash: r.previousEventHash,
        data: r.data ? JSON.parse(r.data as string) : null,
      })) as IsabellaEvent[];
    } catch {
      /* fall through */
    }
  }
  return fallbackLog.slice(-limit);
}

export function getLastEventHash(): string {
  return lastEventHash;
}

export function getEventBusMetrics() {
  let totalEvents = 0;
  const recentEventTypes: Record<string, number> = {};

  if (isSqlite()) {
    try {
      const db = getDatabase();
      const countRow = db.prepare("SELECT COUNT(*) as cnt FROM quantum_events").get() as {
        cnt: number;
      };
      totalEvents = countRow.cnt;
      const recent = db
        .prepare("SELECT eventType FROM quantum_events ORDER BY rowid DESC LIMIT 200")
        .all() as Array<{ eventType: string }>;
      for (const e of recent)
        recentEventTypes[e.eventType] = (recentEventTypes[e.eventType] || 0) + 1;
    } catch {
      /* fall through */
    }
  } else {
    totalEvents = fallbackLog.length;
    const recent = fallbackLog.slice(-200);
    for (const e of recent)
      recentEventTypes[e.eventType] = (recentEventTypes[e.eventType] || 0) + 1;
  }

  return {
    totalEvents,
    lastEventHash,
    recentEventTypes,
    handlerCount: Array.from(handlers.values()).reduce((sum, s) => sum + s.size, 0),
  };
}
