/**
 * SQLite-backed ApiKeyRepository for single-node deployments.
 * Uses better-sqlite3 synchronous API with WAL mode.
 * Transactions use SQLite BEGIN IMMEDIATE for write serialization.
 */

// @ts-nocheck
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nodeRequire } from "../node-require";
import type BetterSqlite3 from "better-sqlite3";
import type { ApiKeyRecord, ApiKeyRepository, ApiKeyAuditEvent } from "../api-keys";

type SqliteDatabase = BetterSqlite3.Database;
type SqliteStatement<
  BindParameters extends unknown[] = unknown[],
  Result = unknown,
> = BetterSqlite3.Statement<BindParameters, Result>;

interface ApiKeyRow {
  id: string;
  version: number;
  keyPrefix: string;
  keyDigest: string;
  name: string;
  userId: string;
  tenantId: string;
  scopes: string;
  plan: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rateLimitPerMinute: number;
  createdBy: string;
  replacedBy: string | null;
}

export class SqliteApiKeyRepository implements ApiKeyRepository {
  private db: SqliteDatabase;
  private stmts: {
    insert: SqliteStatement<unknown[]>;
    findById: SqliteStatement<[string], ApiKeyRow>;
    listByOwner: SqliteStatement<[string, string], ApiKeyRow>;
    markUsed: SqliteStatement<unknown[]>;
    revoke: SqliteStatement<unknown[]>;
    deleteKey: SqliteStatement<unknown[]>;
    insertAudit: SqliteStatement<unknown[]>;
  };

  constructor(dbPath?: string) {
    this.db = createDatabase(dbPath);
    this.stmts = prepareStatements(this.db);
  }

  insert(record: ApiKeyRecord): void {
    this.stmts.insert.run(
      record.id,
      record.version,
      record.keyPrefix,
      record.keyDigest,
      record.name,
      record.userId,
      record.tenantId,
      JSON.stringify(record.scopes),
      record.plan,
      record.createdAt,
      record.lastUsedAt,
      record.expiresAt,
      record.revokedAt,
      record.rateLimitPerMinute,
      record.createdBy,
      record.replacedBy,
    );
  }

  findById(id: string): ApiKeyRecord | null {
    const row = this.stmts.findById.get(id);
    return row ? rowToRecord(row) : null;
  }

  listByOwner(userId: string, tenantId: string): ApiKeyRecord[] {
    const rows = this.stmts.listByOwner.all(userId, tenantId);
    return rows.map(rowToRecord);
  }

  markUsed(id: string, at: string): void {
    this.stmts.markUsed.run(at, id);
  }

  revoke(id: string, userId: string, tenantId: string, at: string, replacedBy?: string): boolean {
    const result = this.stmts.revoke.run(at, replacedBy ?? null, id, userId, tenantId);
    return result.changes > 0;
  }

  delete(id: string, userId: string, tenantId: string): boolean {
    const result = this.stmts.deleteKey.run(id, userId, tenantId);
    return result.changes > 0;
  }

  transaction<T>(callback: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  audit(event: ApiKeyAuditEvent): void {
    this.stmts.insertAudit.run(
      event.eventId,
      event.event,
      event.keyId,
      event.userId,
      event.tenantId,
      event.occurredAt,
      event.traceId ?? null,
      event.reasonCode ?? null,
    );
  }

  close(): void {
    this.db.close();
  }
}

/* ========================================================================== *
 * SQLite bootstrap
 * ========================================================================== */

function createDatabase(dbPath?: string): SqliteDatabase {
  const BetterSqlite3Ctor = nodeRequire("better-sqlite3") as new (
    filename: string,
  ) => SqliteDatabase;
  const path = dbPath || process.env.ISABELLA_DB_PATH || "./data/isabella.db";
  mkdirSync(dirname(path), { recursive: true });
  const db = new BetterSqlite3Ctor(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      keyPrefix TEXT NOT NULL,
      keyDigest TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      userId TEXT NOT NULL,
      tenantId TEXT NOT NULL DEFAULT 'nodo-cero-rdm',
      scopes TEXT NOT NULL DEFAULT '[]',
      plan TEXT NOT NULL DEFAULT 'free',
      createdAt TEXT NOT NULL,
      lastUsedAt TEXT,
      expiresAt TEXT,
      revokedAt TEXT,
      rateLimitPerMinute INTEGER NOT NULL DEFAULT 60,
      createdBy TEXT NOT NULL DEFAULT 'system',
      replacedBy TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_user_tenant
      ON api_keys(userId, tenantId);
    CREATE INDEX IF NOT EXISTS idx_api_keys_keyPrefix
      ON api_keys(keyPrefix);

    CREATE TABLE IF NOT EXISTS api_key_audit (
      eventId TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      keyId TEXT,
      userId TEXT,
      tenantId TEXT,
      occurredAt TEXT NOT NULL,
      traceId TEXT,
      reasonCode TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_key_audit_keyId
      ON api_key_audit(keyId);
    CREATE INDEX IF NOT EXISTS idx_api_key_audit_occurredAt
      ON api_key_audit(occurredAt);
  `);

  return db;
}

function prepareStatements(db: SqliteDatabase): SqliteApiKeyRepository["stmts"] {
  return {
    insert: db.prepare(`
      INSERT INTO api_keys (
        id, version, keyPrefix, keyDigest, name, userId, tenantId,
        scopes, plan, createdAt, lastUsedAt, expiresAt, revokedAt,
        rateLimitPerMinute, createdBy, replacedBy
      ) VALUES (
        @id, @version, @keyPrefix, @keyDigest, @name, @userId, @tenantId,
        @scopes, @plan, @createdAt, @lastUsedAt, @expiresAt, @revokedAt,
        @rateLimitPerMinute, @createdBy, @replacedBy
      )
    `),
    findById: db.prepare("SELECT * FROM api_keys WHERE id = ?"),
    listByOwner: db.prepare(
      "SELECT * FROM api_keys WHERE userId = ? AND tenantId = ? ORDER BY createdAt DESC",
    ),
    markUsed: db.prepare("UPDATE api_keys SET lastUsedAt = ? WHERE id = ?"),
    revoke: db.prepare(`
      UPDATE api_keys
      SET revokedAt = ?, replacedBy = ?
      WHERE id = ? AND userId = ? AND tenantId = ? AND revokedAt IS NULL
    `),
    deleteKey: db.prepare("DELETE FROM api_keys WHERE id = ? AND userId = ? AND tenantId = ?"),
    insertAudit: db.prepare(`
      INSERT INTO api_key_audit (eventId, event, keyId, userId, tenantId, occurredAt, traceId, reasonCode)
      VALUES (@eventId, @event, @keyId, @userId, @tenantId, @occurredAt, @traceId, @reasonCode)
    `),
  };
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    version: row.version,
    keyPrefix: row.keyPrefix,
    keyDigest: row.keyDigest,
    name: row.name,
    userId: row.userId,
    tenantId: row.tenantId,
    scopes: JSON.parse(row.scopes || "[]"),
    plan: row.plan,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    rateLimitPerMinute: row.rateLimitPerMinute,
    createdBy: row.createdBy,
    replacedBy: row.replacedBy,
  };
}
