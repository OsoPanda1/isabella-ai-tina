#!/usr/bin/env node

/**
 * db:verify — Verificación real del contrato PostgreSQL.
 *
 * Sin DATABASE_URL: verifica estáticamente las migraciones.
 * Con DATABASE_URL: consulta la DB viva y verifica tablas, columnas críticas,
 * RLS, triggers de inmutabilidad y pgvector. FORCE RLS se documenta como una decisión de conexión.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../supabase/migrations");
const databaseUrl = process.env.DATABASE_URL;

const REQUIRED_COLUMNS = {
  tenants: ["id", "slug", "tier", "quota_balance", "quota_tier_limit", "created_by", "metadata"],
  profiles: ["id", "tenant_id"],
  sessions: ["id", "user_id", "tenant_id", "token_jti", "is_active", "expires_at"],
  memories: [
    "id",
    "tenant_id",
    "content",
    "scope",
    "sensitivity",
    "purpose",
    "consent_required",
    "consent",
    "provenance",
    "content_hash",
    "previous_chain_hash",
    "chain_hash",
    "expires_at",
    "source",
    "user_id",
    "metadata",
  ],
  audit_events: [
    "id",
    "tenant_id",
    "timestamp",
    "trace_id",
    "correlation_id",
    "actor_ip",
    "actor",
    "action",
    "resource",
    "event",
    "severity",
    "result",
    "details",
    "verification_hash",
    "previous_log_hash",
  ],
  bookpi_ledger: [
    "index",
    "tenant_id",
    "user_id",
    "timestamp",
    "operation",
    "category",
    "cost_decimal",
    "tokens_consumed",
    "previous_hash",
    "block_hash",
    "signature_algorithm",
    "status",
    "nonce",
  ],
  api_keys: [
    "id",
    "tenant_id",
    "user_id",
    "key_hash",
    "key_prefix",
    "prefix",
    "status",
    "expires_at",
    "revoked_at",
    "rotated_at",
    "last_used_at",
  ],
  webhook_events: [
    "id",
    "provider",
    "provider_event_id",
    "event_type",
    "payload_hash",
    "received_at",
    "status",
  ],
  economic_events: [
    "id",
    "tenant_id",
    "actor_id",
    "event_type",
    "amount_minor",
    "provider",
    "provider_event_id",
    "idempotency_key",
    "correlation_id",
    "created_at",
  ],
  sovereign_state: ["id", "payload", "version", "updated_at"],
  observability_events: [
    "id",
    "trace_id",
    "event_type",
    "source",
    "duration_ms",
    "severity",
    "payload",
    "created_at",
  ],
};

const RLS_REQUIRED = [
  "memories",
  "audit_events",
  "bookpi_ledger",
  "api_keys",
  "webhook_events",
  "economic_events",
  // Tablas server-only endurecidas en 20260926020000 (auditoría S2/S3).
  "accounting_accounts",
  "accounting_journal_entries",
  "accounting_ledger_lines",
  "episodic_memory",
  "semantic_memory",
  "procedural_memory",
  "fgais_model_registry",
  "fgais_federation_replay",
  "isabella_learning_state",
  "billing_payment_intents",
  "billing_checkout_idempotency",
  "billing_run_authorizations",
  "observability_events",
];

// Tablas que NUNCA deben ser alcanzables por PostgREST (anon/authenticated).
const SERVER_ONLY_TABLES = [
  "webhook_events",
  "accounting_accounts",
  "accounting_journal_entries",
  "accounting_ledger_lines",
  "episodic_memory",
  "semantic_memory",
  "procedural_memory",
  "fgais_model_registry",
  "fgais_federation_replay",
  "isabella_learning_state",
  "billing_payment_intents",
  "billing_checkout_idempotency",
  "billing_run_authorizations",
  "observability_events",
  "connector_webhook_events",
];

const IMMUTABLE_TABLES = ["bookpi_ledger", "audit_events"];

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function staticCheck() {
  const files = listMigrations();
  const errors = [];
  const allSql = files
    .map((file) => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"))
    .join("\n");
  for (const table of Object.keys(REQUIRED_COLUMNS)) {
    const declared = new RegExp(
      `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?[^;]*\\b${table}\\b`,
      "i",
    ).test(allSql);
    if (!declared) errors.push(`Tabla canónica no declarada: ${table}`);
    for (const column of REQUIRED_COLUMNS[table])
      if (!new RegExp(`\\b${column}\\b`, "i").test(allSql))
        errors.push(`Columna crítica no declarada: ${table}.${column}`);
  }
  if (!/create\\s+extension[\\s\S]*vector/i.test(allSql) && !/pgvector/i.test(allSql))
    errors.push("pgvector no aparece en migraciones");
  for (const table of RLS_REQUIRED)
    if (
      !new RegExp(
        `alter\\s+table\\s+[^;]*\\b${table}\\b[^;]*enable\\s+row\\s+level\\s+security`,
        "i",
      ).test(allSql)
    )
      errors.push(`RLS no declarada para ${table}`);
  // No FORCE RLS assertion: the canonical production migration explicitly
  // removes FORCE RLS for backend-owned PostgreSQL connections.
  // Toda tabla server-only debe tener un REVOKE explícito a los roles de
  // PostgREST declarado en alguna migración (gate estático).
  for (const table of SERVER_ONLY_TABLES) {
    const revoked = new RegExp(
      `revoke\\s+all\\s+on\\s+(?:public\\.)?${table}\\s+from\\s+[^;]*\\b(anon|authenticated)\\b`,
      "i",
    ).test(allSql);
    if (!revoked) errors.push(`REVOKE a anon/authenticated no declarado para ${table}`);
  }
  if (!/prevent_bookpi_mutation|bookpi.*immutable|immutable.*bookpi/i.test(allSql))
    errors.push("No se encontró evidencia estática de inmutabilidad BookPI");
  return { errors, files };
}

async function liveCheck() {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
  });
  try {
    const errors = [];
    const tables = Object.keys(REQUIRED_COLUMNS);
    const { rows: tableRows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])`,
      [tables],
    );
    const tableSet = new Set(tableRows.map((row) => String(row.table_name)));
    for (const table of tables)
      if (!tableSet.has(table)) errors.push(`Tabla ausente en DB viva: ${table}`);

    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      if (!tableSet.has(table)) continue;
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name = ANY($2::text[])`,
        [table, columns],
      );
      const found = new Set(rows.map((row) => String(row.column_name)));
      const missing = columns.filter((column) => !found.has(column));
      if (missing.length) errors.push(`Columnas ausentes en ${table}: ${missing.join(", ")}`);
    }

    const { rows: rlsRows } = await pool.query(
      `SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname = ANY($1::text[])`,
      [RLS_REQUIRED],
    );
    for (const table of RLS_REQUIRED) {
      const row = rlsRows.find((item) => String(item.table_name) === table);
      if (!row?.relrowsecurity) errors.push(`RLS desactivada en DB viva: ${table}`);
      // FORCE RLS is intentionally false for backend-owned connections.
    }

    // PostgREST no debe tener privilegio sobre tablas server-only.
    for (const table of SERVER_ONLY_TABLES) {
      const { rows } = await pool.query(
        `SELECT CASE WHEN to_regclass('public.' || $1) IS NULL THEN false
                     ELSE has_table_privilege('anon', 'public.' || $1, 'SELECT') END AS anon_select,
                CASE WHEN to_regclass('public.' || $1) IS NULL THEN false
                     ELSE has_table_privilege('authenticated', 'public.' || $1, 'SELECT') END AS auth_select`,
        [table],
      );
      if (rows[0]?.anon_select) errors.push(`anon tiene SELECT sobre ${table}`);
      if (rows[0]?.auth_select) errors.push(`authenticated tiene SELECT sobre ${table}`);
    }

    const { rows: triggerRows } = await pool.query(
      `SELECT event_object_table AS table_name, trigger_name FROM information_schema.triggers WHERE trigger_schema='public' AND event_object_table = ANY($1::text[])`,
      [IMMUTABLE_TABLES],
    );
    for (const table of IMMUTABLE_TABLES)
      if (!triggerRows.some((row) => String(row.table_name) === table))
        errors.push(`Trigger de inmutabilidad ausente: ${table}`);

    const vector = await pool.query(`SELECT 1 FROM pg_extension WHERE extname='vector'`);
    if (vector.rowCount === 0) errors.push("Extensión vector ausente en DB viva");

    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      `DB viva verificada: ${tables.length} tablas, contratos RLS, triggers y vector OK.`,
    );
  } finally {
    await pool.end();
  }
}

if (databaseUrl) {
  try {
    await liveCheck();
    process.exit(0);
  } catch (error) {
    console.error(`Verificación SQL falló:\n${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

const { errors, files } = staticCheck();
console.log(`Migraciones detectadas: ${files.length}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Contrato estático de migraciones OK.");
console.log("Sin DATABASE_URL no se declara que una base viva esté verificada.");
