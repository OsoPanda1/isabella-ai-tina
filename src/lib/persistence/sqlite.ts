// @ts-nocheck
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nodeRequire } from "../node-require";
import type BetterSqlite3 from "better-sqlite3";

export type PersistenceMode = "sqlite" | "in-memory";

let db: InstanceType<typeof BetterSqlite3> | null = null;
let mode: PersistenceMode = "in-memory";
let initAttempted = false;

export function getPersistenceMode(): PersistenceMode {
  return mode;
}

export function getDatabase(): InstanceType<typeof BetterSqlite3> {
  if (db) return db;
  if (initAttempted) throw new Error("better-sqlite3 unavailable — running in in-memory mode");
  initAttempted = true;

  try {
    const BetterSqlite3Constructor = nodeRequire("better-sqlite3") as typeof BetterSqlite3;
    const dbPath = process.env.ISABELLA_DB_PATH || "./data/isabella.db";
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new BetterSqlite3Constructor(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
    mode = "sqlite";
    return db;
  } catch {
    mode = "in-memory";
    throw new Error("better-sqlite3 unavailable — running in in-memory mode");
  }
}

function migrate(database: InstanceType<typeof BetterSqlite3>): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      memoryId TEXT PRIMARY KEY,
      tenantId TEXT,
      sessionId TEXT,
      scope TEXT,
      content TEXT,
      contentJson TEXT,
      sourceType TEXT,
      relevance REAL,
      expiresAt TEXT,
      checksum TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      tenantId TEXT,
      sessionId TEXT,
      actorId TEXT,
      eventType TEXT,
      payload TEXT,
      traceId TEXT,
      checksum TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS quantum_events (
      eventId TEXT PRIMARY KEY,
      eventType TEXT,
      schemaVersion TEXT,
      traceId TEXT,
      requestId TEXT,
      tenantId TEXT,
      subjectId TEXT,
      originCore INTEGER,
      targetCore INTEGER,
      occurredAt TEXT,
      policyVersion TEXT,
      payloadHash TEXT,
      previousEventHash TEXT,
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS bookpi_blocks (
      blockHash TEXT PRIMARY KEY,
      version TEXT,
      previousHash TEXT,
      requestId TEXT,
      tenantId TEXT,
      circuitHash TEXT,
      implementation TEXT,
      status TEXT,
      policyVersion TEXT,
      signerKeyId TEXT,
      teeVerified INTEGER,
      createdAt TEXT,
      blockData TEXT
    );

    CREATE TABLE IF NOT EXISTS telemetry_counters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      labels TEXT,
      value INTEGER,
      timestamp TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_counters_name_labels ON telemetry_counters(name, labels);

    CREATE TABLE IF NOT EXISTS telemetry_histograms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      value REAL,
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS telemetry_spans (
      spanId TEXT PRIMARY KEY,
      traceId TEXT,
      parentSpanId TEXT,
      operation TEXT,
      startTime TEXT,
      endTime TEXT,
      durationMs INTEGER,
      status TEXT,
      attributes TEXT
    );
  `);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    mode = "in-memory";
    initAttempted = false;
  }
}
