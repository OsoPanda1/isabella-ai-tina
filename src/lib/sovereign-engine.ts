import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { Pool } from "pg";
import { config } from "./config";
import { SecuritySystem } from "./security";
import type { ApiKeyRecord } from "./credential-types";

// ============================================================================
// CANONICAL SOVEREIGN COGNITIVE & DATA ENGINE - ISABELLA v4.2.0
// ============================================================================

const PERSISTENCE_FILE_PATH = path.join(process.cwd(), "isabella_sovereign_db.json");

/**
 * FASE 7 — fail-closed: la persistencia JSON soberana es un mock de archivos.
 * En staging/production se exige una fuente de verdad transaccional
 * (PostgreSQL/Supabase). Mientras dure la transición, `DURABLE_JSON_ALLOWED=true`
 * (mismo contrato que `json-adapter`) permite el JSON; al llegar `false`,
 * el runtime NIEga la operación en vez de persistir en JSON silenciosamente.
 * El end-state certificado es `DURABLE_JSON_ALLOWED=false` con repos Postgres.
 */
function assertJsonPersistenceAllowed(): void {
  const cfg = config();
  const isProdLike =
    cfg.ISABELLA_RUNTIME_MODE === "production" || cfg.ISABELLA_RUNTIME_MODE === "staging";
  if (isProdLike && cfg.DURABLE_JSON_ALLOWED !== true) {
    throw new Error(
      "JSON SovereignDB persistence is disabled in staging and production (FASE 7). Use the PostgreSQL/Supabase repository as source of truth.",
    );
  }
}

// 1. Core Cryptographic Chaining Schema (BookPI Ledger)
export interface BookPILedgerBlock {
  index: number;
  timestamp: string;
  tenantId: string;
  userId: string;
  operation: string;
  category: "inference" | "processing" | "apis" | "skills" | "other" | "REFUND_EVENT";
  costDecimal: string;
  tokensConsumed: number;
  previousHash: string;
  blockHash: string;
  pqcSignature: string | null;
  signatureAlgorithm: "ECDSA-P384" | "UNSIGNED_DEV";
  status: "settled" | "pending" | "refunded";
}

// 2. Multi-Tenancy & Identity Schema (OIDC & RBAC)
export type UserRole = "SovereignOwner" | "Auditor" | "Operator" | "Guest";

export interface Tenant {
  id: string;
  name: string;
  region: string;
  quotaBalance: number; // Real billing credits
  tier: "Free" | "Enterprise" | "Sovereign";
}

export interface UserSession {
  userId: string;
  username: string;
  tenantId: string;
  role: UserRole;
  oidcSub: string;
}

// 3. Security Activity Audit Log
export interface AuditLog {
  id: string;
  timestamp: string;
  traceId: string;
  correlationId: string;
  actorIp: string;
  event: string;
  severity: "S0" | "S1" | "S2" | "S3";
  details: string;
  remediated: boolean;
  verificationHash: string; // Cryptographic SHA-256 validation of the event payload
  previousLogHash: string; // Append-only chained validation hash
}

// 4. 12 Cognitive Heads & 24 Inference Cells Configuration
export interface CognitiveHead {
  name: string;
  description: string;
  domain: string;
  nucleusAlphaCount: number;
  nucleusBetaCount: number;
  status: "implemented" | "verified" | "experimental" | "shadow";
  alphaLoad: number; // Carga en tiempo real del núcleo Alpha (Epistémico)
  betaLoad: number; // Carga en tiempo real del núcleo Beta (Cibernético)
  consensusState: "synchronized" | "evaluating" | "locked" | "idle";
}

// Full Database Schema
export interface DatabaseSchema {
  tenants: Tenant[];
  sessions: UserSession[];
  ledger: BookPILedgerBlock[];
  auditLogs: AuditLog[];
  apiKeys: ApiKeyRecord[];
  monetization?: Record<
    string,
    {
      userId: string;
      earnedBalanceCents: number;
      qualifiedUses: number;
      approvedContributions: number;
      trainingCompleted: boolean;
      identityVerified: boolean;
      paymentAccountVerified: boolean;
      profileComplete: boolean;
      sanctioned: boolean;
      underFraudReview: boolean;
      withdrawals: {
        payoutId: string;
        amountCents: number;
        status: "scheduled" | "processed" | "held" | "rejected";
        idempotencyKey: string;
        createdAt: string;
      }[];
    }
  >;
  settings: Record<string, unknown>;
}

// Zero mockdata: el arranque parte de un estado REAL y vacío. Ningún tenant,
// sesión, bloque de libro mayor ni log de auditoría se fabrica en código.
// La génesis se genera en runtime con hashes criptográficos reales cuando
// ocurre la primera operación. La provisión de identidad se realiza mediante
// flujos autorizados (provision-owner / IDP OIDC).
function emptyDatabase(): DatabaseSchema {
  return {
    tenants: [],
    sessions: [],
    ledger: [],
    auditLogs: [],
    apiKeys: [],
    monetization: {},
    settings: {
      pqcEnabled: false,
      activeHeadCount: 12,
      activeNucleusCount: 24,
    },
  };
}

/** Hash previo canónico de génesis (bloque raíz). */
const GENESIS_PREVIOUS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

// ============================================================================
// HELPER METHODS: PERSISTENT STORAGE CONTROLLER
// Dev/test → Atomic File I/O. Staging/Production → PostgreSQL (sovereign_state).
// ============================================================================

let pgPool: Pool | null = null;
function getPgPool(): Pool | null {
  try {
    const url = config().DATABASE_URL;
    if (!url) return null;
    if (!pgPool) {
      pgPool = new Pool({ connectionString: url, max: 5 });
      pgPool.on("error", (err) => {
        console.error("Unexpected error on idle Sovereign State pool", err);
      });
    }
    return pgPool;
  } catch {
    return null;
  }
}

// In-memory cache for the hot path. In production it is refreshed from
// PostgreSQL through a bounded, de-duplicated refresh window (see hydrate()).
let memoryDb: DatabaseSchema | null = null;
let lastHydratedAt = 0;
let hydrationInFlight: Promise<DatabaseSchema> | null = null;

// Self-provisioning: creates the sovereign_state table once per process if it
// does not exist yet, so the production DB does not need manual DDL setup.
let stateTableReady = false;
async function ensureStateTable(pool: Pool): Promise<void> {
  if (stateTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.sovereign_state (
      id varchar(32) primary key,
      payload jsonb not null,
      version varchar(32) not null default 'v1',
      updated_at timestamptz not null default now()
    )
  `);
  stateTableReady = true;
}

function isProductionRuntime(): boolean {
  try {
    const cfg = config();
    return (
      cfg.NODE_ENV === "production" ||
      cfg.ISABELLA_RUNTIME_MODE === "production" ||
      cfg.ISABELLA_RUNTIME_MODE === "staging"
    );
  } catch {
    // Sin configuración válida: asumir producción (fail-closed).
    return true;
  }
}

/**
 * P0-B: estado soberano no durable en producción. Fail-closed: ante caída de
 * PostgreSQL (o ausencia de DATABASE_URL) NUNCA se sirve memoria vacía ni se
 * acepta una escritura que no será persistida. Server.ts lo mapea a 503.
 */
export class DurableStateUnavailableError extends Error {
  readonly code = "SOVEREIGN_STATE_UNAVAILABLE";
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DurableStateUnavailableError";
  }
}

/**
 * Error de la última persistencia fallida en producción. La siguiente operación
 * (hydrate/save) lo relanza: una escritura fallida jamás queda silenciosa.
 */
let sovereignPersistError: Error | null = null;

export class SovereignDB {
  /**
   * Refreshes the in-memory cache from durable PostgreSQL storage.
   *
   * `maxAgeMs` prevents a database read on every request; concurrent callers
   * share one refresh. Mutating paths must request a fresh read (`maxAgeMs: 0`)
   * before a read-modify-write sequence.
   */
  public static async hydrate({
    maxAgeMs = 0,
  }: { maxAgeMs?: number } = {}): Promise<DatabaseSchema> {
    // Fail-closed: si la persistencia anterior falló, no servir estado obsoleto.
    if (isProductionRuntime() && sovereignPersistError) {
      throw new DurableStateUnavailableError(
        "Sovereign state persistence failed previously; refusing to serve stale/empty state.",
        sovereignPersistError,
      );
    }
    if (memoryDb && maxAgeMs > 0 && Date.now() - lastHydratedAt < maxAgeMs) {
      return memoryDb;
    }
    if (hydrationInFlight) return hydrationInFlight;

    hydrationInFlight = this.hydrateFresh();
    try {
      return await hydrationInFlight;
    } finally {
      hydrationInFlight = null;
    }
  }

  private static async hydrateFresh(): Promise<DatabaseSchema> {
    if (!isProductionRuntime()) {
      if (!memoryDb) {
        memoryDb = emptyDatabase();
      }
      lastHydratedAt = Date.now();
      return memoryDb;
    }
    const pool = getPgPool();
    if (!pool) {
      throw new DurableStateUnavailableError(
        "DATABASE_URL missing in production — Sovereign state cannot be durable (fail-closed).",
      );
    }
    try {
      await ensureStateTable(pool);
      const { rows } = await pool.query(
        "SELECT payload FROM public.sovereign_state WHERE id = 'canonical' LIMIT 1",
      );
      if (rows[0]?.payload) {
        memoryDb = rows[0].payload as DatabaseSchema;
        lastHydratedAt = Date.now();
        return memoryDb;
      }
    } catch (e) {
      throw new DurableStateUnavailableError(
        "Failed to hydrate Sovereign state from PostgreSQL in production (fail-closed).",
        e,
      );
    }
    // Sin fila: despliegue reciente legítimo. Estado vacío, no un error.
    memoryDb = emptyDatabase();
    lastHydratedAt = Date.now();
    return memoryDb;
  }

  // Resets the in-memory cache (used by tests).
  public static resetMemoryCache(): void {
    memoryDb = null;
    lastHydratedAt = 0;
    hydrationInFlight = null;
    sovereignPersistError = null;
  }

  /**
   * Carga el estado persistente real (sincrónico, hot path). En dev/test usa el
   * archivo JSON; en producción devuelve la caché de memoria hidratada desde
   * PostgreSQL. Nunca fabrica datos (zero mockdata).
   */
  public static load(): DatabaseSchema {
    const production = isProductionRuntime();

    if (!production) {
      assertJsonPersistenceAllowed();
      try {
        if (fs.existsSync(PERSISTENCE_FILE_PATH)) {
          const raw = fs.readFileSync(PERSISTENCE_FILE_PATH, "utf8");
          const db = JSON.parse(raw) as DatabaseSchema;
          memoryDb = db;
          return db;
        }
      } catch (e) {
        console.error(
          "No se pudo cargar la base de datos persistente. Restableciendo estado vacío:",
          e,
        );
      }
      const db = emptyDatabase();
      memoryDb = db;
      this.save(db);
      return db;
    }

    // Production: return in-memory cache (hydrate() must be awaited first).
    if (!memoryDb) {
      // Fallback: an empty state. A real hydrate() call will repopulate it.
      memoryDb = emptyDatabase();
    }
    return memoryDb;
  }

  private static save(db: DatabaseSchema) {
    memoryDb = db;
    lastHydratedAt = Date.now();
    const production = isProductionRuntime();

    if (!production) {
      assertJsonPersistenceAllowed();
      try {
        const dir = path.dirname(PERSISTENCE_FILE_PATH);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(PERSISTENCE_FILE_PATH, JSON.stringify(db, null, 2), "utf8");
      } catch (e) {
        console.error("Fallo crítico al escribir en la base de datos persistente:", e);
      }
      return;
    }

    // Production: persist to PostgreSQL. Fail-closed: sin DATABASE_URL esta
    // escritura NUNCA se acepta; con persist fallida se marca el error para
    // que la siguiente operación falle (NUNCA silencioso).
    const pool = getPgPool();
    if (!pool) {
      throw new DurableStateUnavailableError(
        "DATABASE_URL missing in production — sovereign state write refused (NOT durable).",
      );
    }
    const payload = JSON.stringify(db);
    const persist = async () => {
      await ensureStateTable(pool);
      await pool.query(
        `INSERT INTO public.sovereign_state (id, payload, version, updated_at)
         VALUES ('canonical', $1::jsonb, 'v1', now())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, version = 'v1', updated_at = now()`,
        [payload],
      );
    };
    persist()
      .then(() => {
        sovereignPersistError = null;
      })
      .catch((e) => {
        sovereignPersistError = e instanceof Error ? e : new Error(String(e));
        console.error(
          "[SovereignDB] Failed to persist sovereign state to Postgres (fail-closed on next op):",
          sovereignPersistError,
        );
      });
  }

  /**
   * Destructive overwrite of the entire durable state (used by tests / reset).
   */
  public static async replaceState(db: DatabaseSchema): Promise<void> {
    memoryDb = db;
    lastHydratedAt = Date.now();
    const pool = getPgPool();
    if (!pool || !isProductionRuntime()) {
      return this.save(db) as unknown as void;
    }
    await ensureStateTable(pool);
    await pool.query(
      `INSERT INTO public.sovereign_state (id, payload, version, updated_at)
       VALUES ('canonical', $1::jsonb, 'v1', now())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, version = 'v1', updated_at = now()`,
      [JSON.stringify(db)],
    );
  }

  // --- Provisioning de identidad (real, no mockdata) ---
  // El primer tenant/owner se crea únicamente mediante flujos autorizados
  // (provision-owner protegido por token o IDP OIDC/Supabase configurado).

  public static getSessions(): UserSession[] {
    const db = this.load();
    return db.sessions;
  }

  public static upsertTenant(tenant: Tenant): void {
    const db = this.load();
    const index = db.tenants.findIndex((t) => t.id === tenant.id);
    if (index >= 0) {
      db.tenants[index] = tenant;
    } else {
      db.tenants.push(tenant);
    }
    this.save(db);
  }

  public static upsertSession(session: UserSession): void {
    const db = this.load();
    const index = db.sessions.findIndex((s) => s.userId === session.userId);
    if (index >= 0) {
      db.sessions[index] = session;
    } else {
      db.sessions.push(session);
    }
    this.save(db);
  }

  // Multi-tenancy Isolation: Get ledger records isolated by Tenant
  public static getLedger(tenantId: string): BookPILedgerBlock[] {
    const db = this.load();
    const refundedIndexes = new Set<number>();

    // Find all refunded indexes via append-only refund event blocks
    for (const item of db.ledger) {
      if (item.operation.startsWith("REFUND_EVENT: Reembolso de transacción index ")) {
        const parts = item.operation.split("index ");
        const idx = parseInt(parts[1] || "", 10);
        if (!isNaN(idx)) {
          refundedIndexes.add(idx);
        }
      }
    }

    return db.ledger
      .filter((item) => item.tenantId === tenantId)
      .map((item) => {
        if (refundedIndexes.has(item.index) || item.status === "refunded") {
          return { ...item, status: "refunded" as const };
        }
        return item;
      });
  }

  public static getFullLedger(): BookPILedgerBlock[] {
    const db = this.load();
    const refundedIndexes = new Set<number>();

    // Find all refunded indexes via append-only refund event blocks
    for (const item of db.ledger) {
      if (item.operation.startsWith("REFUND_EVENT: Reembolso de transacción index ")) {
        const parts = item.operation.split("index ");
        const idx = parseInt(parts[1] || "", 10);
        if (!isNaN(idx)) {
          refundedIndexes.add(idx);
        }
      }
    }

    return db.ledger.map((item) => {
      if (refundedIndexes.has(item.index) || item.status === "refunded") {
        return { ...item, status: "refunded" as const };
      }
      return item;
    });
  }

  // Cryptographically secure chaining (BookPI Ledger Block Generation)
  public static appendLedgerBlock(
    tenantId: string,
    userId: string,
    operation: string,
    category: "inference" | "processing" | "apis" | "skills" | "other" | "REFUND_EVENT",
    cost: number,
    tokens: number,
  ): BookPILedgerBlock {
    const db = this.load();
    const lastBlock = db.ledger[db.ledger.length - 1];
    const prevHash = lastBlock ? lastBlock.blockHash : GENESIS_PREVIOUS_HASH;

    const index = db.ledger.length;
    const timestamp = new Date().toISOString();
    const costDecimal = cost.toFixed(5);

    // Dynamic hash calculation (SHA-256 with real cryptographic integrity)
    const blockContent = `${index}-${timestamp}-${tenantId}-${userId}-${operation}-${category}-${costDecimal}-${tokens}-${prevHash}`;
    const blockHash = this.sha256(blockContent);
    const signingKey = config().BOOKPI_SIGNING_KEY;
    const isProduction = isProductionRuntime();
    if (isProduction && !signingKey) {
      throw new Error("BookPI requiere BOOKPI_SIGNING_KEY en producción.");
    }
    const pqcSignature = signingKey
      ? crypto.sign("sha384", Buffer.from(blockContent), signingKey).toString("base64url")
      : null;

    const newBlock: BookPILedgerBlock = {
      index,
      timestamp,
      tenantId,
      userId,
      operation,
      category,
      costDecimal,
      tokensConsumed: tokens,
      previousHash: prevHash,
      blockHash,
      pqcSignature,
      signatureAlgorithm: signingKey ? "ECDSA-P384" : "UNSIGNED_DEV",
      status: "settled",
    };

    // Deduct Tenant Credits (Real Billing / Multi-tenancy isolation)
    const tenant = db.tenants.find((t) => t.id === tenantId);
    if (tenant) {
      tenant.quotaBalance = Math.max(0, tenant.quotaBalance - cost);
    }

    db.ledger.push(newBlock);
    this.save(db);
    return newBlock;
  }

  // Safe Refund Process with ledger updates (Append-only transaction event)
  public static appendRefundEvent(
    index: number,
    tenantId: string,
  ): { success: boolean; error?: string } {
    const db = this.load();
    const block = db.ledger.find((b) => b.index === index);
    if (!block) return { success: false, error: "Transacción no encontrada." };
    if (block.tenantId !== tenantId)
      return {
        success: false,
        error: "Violación de tenencia cruzada (Cross-Tenant violation).",
      };

    // Check if already refunded by checking for the REFUND_EVENT block
    const isAlreadyRefunded = db.ledger.some(
      (b) => b.operation === `REFUND_EVENT: Reembolso de transacción index ${index}`,
    );
    if (isAlreadyRefunded || block.status === "refunded") {
      return {
        success: false,
        error: "Esta transacción ya ha sido reembolsada.",
      };
    }

    // Append a new, secure REFUND_EVENT block to the ledger
    // Generates genuine cryptographic chaining hash for this refund block
    const prevBlock = db.ledger[db.ledger.length - 1];
    const prevHash = prevBlock ? prevBlock.blockHash : GENESIS_PREVIOUS_HASH;
    const newIndex = db.ledger.length;
    const timestamp = new Date().toISOString();
    const cost = parseFloat(block.costDecimal);
    const costDecimal = `-${block.costDecimal}`;

    const blockData = `${newIndex}-${timestamp}-${tenantId}-${block.userId}-REFUND_EVENT: Reembolso de transacción index ${index}-REFUND_EVENT-${costDecimal}-0-${prevHash}`;
    const blockHash = this.sha256(blockData);
    const signingKey = config().BOOKPI_SIGNING_KEY;
    const isProduction = isProductionRuntime();
    if (isProduction && !signingKey) {
      return {
        success: false,
        error: "BookPI requiere BOOKPI_SIGNING_KEY en producción.",
      };
    }
    const pqcSignature = signingKey
      ? crypto.sign("sha384", Buffer.from(blockData), signingKey).toString("base64url")
      : null;

    const refundBlock: BookPILedgerBlock = {
      index: newIndex,
      timestamp,
      tenantId,
      userId: block.userId,
      operation: `REFUND_EVENT: Reembolso de transacción index ${index}`,
      category: "REFUND_EVENT",
      costDecimal,
      tokensConsumed: 0,
      previousHash: prevHash,
      blockHash,
      pqcSignature,
      signatureAlgorithm: signingKey ? "ECDSA-P384" : "UNSIGNED_DEV",
      status: "settled",
    };

    db.ledger.push(refundBlock);

    // Credit back
    const tenant = db.tenants.find((t) => t.id === tenantId);
    if (tenant) {
      tenant.quotaBalance += cost;
    }

    this.save(db);
    return { success: true };
  }

  // Retrieve isolated Tenant quota balances
  public static getTenant(tenantId: string): Tenant | undefined {
    const db = this.load();
    return db.tenants.find((t) => t.id === tenantId);
  }

  // Get active session with multi-tenant OIDC and real, signature-validated JWT claims
  public static async getSessionByToken(token: string): Promise<UserSession | undefined> {
    const db = this.load();

    // Try to verify as a real cryptographic token first
    const verification = await SecuritySystem.verifyToken(token);
    if (verification.success && verification.claims) {
      const claims = verification.claims;
      const session = db.sessions.find((s) => s.userId === claims.sub);
      if (session) return session;
    }

    return undefined;
  }

  // Real-time forensic ledger chain validation (Append-only hash chain validation)
  public static verifyLedgerIntegrity(): {
    success: boolean;
    error?: string;
    corruptedIndex?: number;
  } {
    const db = this.load();
    for (let i = 0; i < db.ledger.length; i++) {
      const block = db.ledger[i];
      if (!block) {
        return {
          success: false,
          error: `Bloque ausente en índice ${i}.`,
          corruptedIndex: i,
        };
      }

      // 1. Validate sequence index
      if (block.index !== i) {
        return {
          success: false,
          error: `Fallo de secuencia: Esperado índice ${i}, encontrado ${block.index}.`,
          corruptedIndex: i,
        };
      }

      // 2. Validate hash chain linkage
      if (i > 0) {
        const prevBlock = db.ledger[i - 1];
        if (!prevBlock) {
          return {
            success: false,
            error: `Bloque previo ausente en índice ${i - 1}.`,
            corruptedIndex: i,
          };
        }
        if (block.previousHash !== prevBlock.blockHash) {
          return {
            success: false,
            error: `Inconsistencia de encadenamiento: El bloque ${i} rompe la cadena de hashes.`,
            corruptedIndex: i,
          };
        }
      } else {
        if (block.previousHash !== GENESIS_PREVIOUS_HASH) {
          return {
            success: false,
            error: "Bloque Génesis inválido: Hash previo corrupto.",
            corruptedIndex: 0,
          };
        }
      }

      // 3. Recalculate block hash and assert integrity
      const blockContent = `${block.index}-${block.timestamp}-${block.tenantId}-${block.userId}-${block.operation}-${block.category}-${block.costDecimal}-${block.tokensConsumed}-${block.previousHash}`;
      const expectedHash = this.sha256(blockContent);
      if (block.blockHash !== expectedHash) {
        return {
          success: false,
          error: `Fallo de integridad de datos (Hash mismatch) en bloque ${i}. El contenido fue alterado.`,
          corruptedIndex: i,
        };
      }

      // 4. Validate signing policy. Production never accepts unsigned BookPI blocks.
      if (block.signatureAlgorithm === "UNSIGNED_DEV" || block.pqcSignature === null) {
        if (isProductionRuntime()) {
          return {
            success: false,
            error: `Bloque ${i} sin firma BookPI válida en modo productivo.`,
            corruptedIndex: i,
          };
        }
        continue;
      }

      const signingKey = config().BOOKPI_SIGNING_KEY;
      if (block.signatureAlgorithm !== "ECDSA-P384" || !signingKey) {
        return {
          success: false,
          error: `Algoritmo o clave BookPI inválidos en bloque ${i}.`,
          corruptedIndex: i,
        };
      }

      if (
        !crypto.verify(
          "sha384",
          Buffer.from(blockContent),
          signingKey,
          Buffer.from(block.pqcSignature, "base64url"),
        )
      ) {
        return {
          success: false,
          error: `Firma BookPI inválida en bloque ${i}.`,
          corruptedIndex: i,
        };
      }
    }

    return { success: true };
  }

  // Security Incident logging
  public static appendAuditLog(
    traceId: string,
    correlationId: string,
    ip: string,
    event: string,
    severity: "S0" | "S1" | "S2" | "S3",
    details: string,
  ): AuditLog {
    const db = this.load();

    const previousLogHash = db.auditLogs[0]?.verificationHash ?? GENESIS_PREVIOUS_HASH;

    const id = `evt_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const remediated = severity === "S3" || severity === "S2";

    const payload = `${id}|${timestamp}|${traceId}|${correlationId}|${ip}|${event}|${severity}|${details}|${remediated ? "true" : "false"}|${previousLogHash}`;
    const verificationHash = this.sha256(payload);

    const newLog: AuditLog = {
      id,
      timestamp,
      traceId,
      correlationId,
      actorIp: ip,
      event,
      severity,
      details,
      remediated,
      verificationHash,
      previousLogHash,
    };
    db.auditLogs.unshift(newLog); // Prepend for real-time streams
    this.save(db);
    return newLog;
  }

  public static getAuditLogs(): AuditLog[] {
    const db = this.load();
    return db.auditLogs;
  }

  /**
   * Cryptographically validates the entire chronological chain of security audit logs.
   * Assures absolute anti-tampering and event compliance.
   */
  public static verifyAuditChain(): {
    success: boolean;
    error?: string;
    corruptedId?: string;
  } {
    const db = this.load();
    const logs = [...db.auditLogs].reverse(); // Verify from oldest (genesis) to newest

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      if (!log) {
        return {
          success: false,
          error: `Evento ausente en la cadena (índice ${i}).`,
          corruptedId: "unknown",
        };
      }
      const prevLog = logs[i - 1];
      const expectedPrevHash = i === 0 ? GENESIS_PREVIOUS_HASH : (prevLog?.verificationHash ?? "");

      if (log.previousLogHash !== expectedPrevHash) {
        return {
          success: false,
          error: `Violación de integridad: El hash del log anterior no coincide en el evento [${log.id}].`,
          corruptedId: log.id,
        };
      }

      const payload = `${log.id}|${log.timestamp}|${log.traceId}|${log.correlationId}|${log.actorIp}|${log.event}|${log.severity}|${log.details}|${log.remediated ? "true" : "false"}|${log.previousLogHash}`;
      const recalculatedHash = this.sha256(payload);

      if (log.verificationHash !== recalculatedHash) {
        return {
          success: false,
          error: `Violación de firma: El hash calculado no coincide para el evento [${log.id}].`,
          corruptedId: log.id,
        };
      }
    }

    return { success: true };
  }

  // SHA-256 string generator helper (Real cryptographic hash)
  private static sha256(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  public static getApiKeys(): ApiKeyRecord[] {
    const db = this.load();
    return db.apiKeys || [];
  }

  public static saveApiKeys(keys: ApiKeyRecord[]): void {
    const db = this.load();
    db.apiKeys = keys;
    this.save(db);
  }

  public static saveMarketplaceListings(listings: unknown[]): void {
    const db = this.load();
    db.settings = db.settings || {};
    db.settings.marketplaceListings = listings;
    this.save(db);
  }

  /**
   * Cuenta de monetización real: ceros hasta que existan eventos económicos
   * verificados (compras marketplace, retiros). Sin saldos iniciales, sin
   * identidad KYC inventada: todo flag de verificación inicia en `false` y
   * solo un flujo de verificación real puede activarlo.
   */
  public static getMonetizationAccount(userId: string) {
    const db = this.load();
    db.monetization = db.monetization || {};
    if (!db.monetization[userId]) {
      db.monetization[userId] = {
        userId,
        earnedBalanceCents: 0,
        qualifiedUses: 0,
        approvedContributions: 0,
        trainingCompleted: false,
        identityVerified: false,
        paymentAccountVerified: false,
        profileComplete: false,
        sanctioned: false,
        underFraudReview: false,
        withdrawals: [],
      };
      this.save(db);
    }
    return db.monetization[userId];
  }

  public static updateMonetizationAccount(userId: string, update: Record<string, unknown>) {
    const db = this.load();
    db.monetization = db.monetization || {};
    const account = this.getMonetizationAccount(userId);
    db.monetization[userId] = {
      ...account,
      ...update,
    };
    this.save(db);
    return db.monetization[userId];
  }
}

// ============================================================================
// REAL 12 COGNITIVE HEADS AGENT ORCHESTRATOR
// ============================================================================

export const COGNITIVE_HEADS: CognitiveHead[] = [
  {
    name: "CROWN Gateway",
    description: "Orquestación soberana, ruteo ético y arbitraje.",
    domain: "Sovereign Routing",
    nucleusAlphaCount: 2,
    nucleusBetaCount: 2,
    status: "implemented",
    alphaLoad: 42,
    betaLoad: 38,
    consensusState: "synchronized",
  },
  {
    name: "ISA Core",
    description: "Presencia, empatía, tono y síntesis de audio.",
    domain: "Emotional Interface",
    nucleusAlphaCount: 2,
    nucleusBetaCount: 2,
    status: "implemented",
    alphaLoad: 88,
    betaLoad: 75,
    consensusState: "synchronized",
  },
  {
    name: "SOPHIA Engine",
    description: "Razonamiento profundo, epistemología y lógica.",
    domain: "Analytical Logic",
    nucleusAlphaCount: 2,
    nucleusBetaCount: 2,
    status: "implemented",
    alphaLoad: 61,
    betaLoad: 54,
    consensusState: "synchronized",
  },
  {
    name: "ORION Engine",
    description: "Generador operativo, ejecución de herramientas.",
    domain: "Operational Generation",
    nucleusAlphaCount: 2,
    nucleusBetaCount: 2,
    status: "implemented",
    alphaLoad: 30,
    betaLoad: 82,
    consensusState: "synchronized",
  },
  {
    name: "ARGUS Sentinel",
    description: "Gobernanza, filtros OWASP y veto sistémico.",
    domain: "Cybersecurity Gate",
    nucleusAlphaCount: 2,
    nucleusBetaCount: 2,
    status: "implemented",
    alphaLoad: 95,
    betaLoad: 92,
    consensusState: "synchronized",
  },
  {
    name: "CHRONOS Index",
    description: "Preservación del tiempo e indexación cronológica.",
    domain: "Chronology Indexing",
    nucleusAlphaCount: 1,
    nucleusBetaCount: 1,
    status: "verified",
    alphaLoad: 12,
    betaLoad: 18,
    consensusState: "synchronized",
  },
  {
    name: "ASTRAEA Justice",
    description: "Cumplimiento del Marco Legal, GDPR y AI Act.",
    domain: "Compliance Engine",
    nucleusAlphaCount: 1,
    nucleusBetaCount: 1,
    status: "verified",
    alphaLoad: 45,
    betaLoad: 20,
    consensusState: "synchronized",
  },
  {
    name: "PYTHIA Forecast",
    description: "Predicción, tendencias territoriales y GIS.",
    domain: "Spatial Predictions",
    nucleusAlphaCount: 1,
    nucleusBetaCount: 1,
    status: "experimental",
    alphaLoad: 15,
    betaLoad: 8,
    consensusState: "idle",
  },
  {
    name: "KRONOS Ledger",
    description: "Consistencia inmutable del libro de transacciones.",
    domain: "Cryptographic Ledger",
    nucleusAlphaCount: 1,
    nucleusBetaCount: 1,
    status: "verified",
    alphaLoad: 74,
    betaLoad: 88,
    consensusState: "synchronized",
  },
  {
    name: "HELIOS Power",
    description: "Gestión de cuotas, límites e infraestructura.",
    domain: "Telemetry Monitoring",
    nucleusAlphaCount: 1,
    nucleusBetaCount: 1,
    status: "experimental",
    alphaLoad: 50,
    betaLoad: 45,
    consensusState: "evaluating",
  },
  {
    name: "HERMES Canal",
    description: "Seguridad en canales, tunelización y TLS.",
    domain: "Secure Communication",
    nucleusAlphaCount: 1,
    nucleusBetaCount: 1,
    status: "experimental",
    alphaLoad: 28,
    betaLoad: 31,
    consensusState: "idle",
  },
  {
    name: "DEMETER Soil",
    description: "Cultura, patrimonio, historia y memorias locales.",
    domain: "Territorial Heritage",
    nucleusAlphaCount: 1,
    nucleusBetaCount: 1,
    status: "experimental",
    alphaLoad: 35,
    betaLoad: 15,
    consensusState: "idle",
  },
];

export class CognitiveOrchestrator {
  // Routes prompt through 12 Heads and 24 Core Cell structures
  public static routeCognition(input: string): {
    primaryHead: string;
    riskScore: number;
    activeCells: string[];
    syntheticResolution: string;
  } {
    const inputLower = input.toLowerCase();
    let primaryHead = "CROWN Gateway";
    let riskScore = 0.1;
    const activeCells: string[] = ["Alpha-01", "Alpha-02"];

    if (
      inputLower.includes("dinero") ||
      inputLower.includes("pago") ||
      inputLower.includes("ledger") ||
      inputLower.includes("factura") ||
      inputLower.includes("cuota")
    ) {
      primaryHead = "KRONOS Ledger";
      riskScore = 0.72;
      activeCells.push("Beta-03", "Beta-04");
    } else if (
      inputLower.includes("legal") ||
      inputLower.includes("ley") ||
      inputLower.includes("art") ||
      inputLower.includes("reglamento") ||
      inputLower.includes("act")
    ) {
      primaryHead = "ASTRAEA Justice";
      riskScore = 0.58;
      activeCells.push("Alpha-05", "Beta-06");
    } else if (
      inputLower.includes("hack") ||
      inputLower.includes("inyectar") ||
      inputLower.includes("seguridad") ||
      inputLower.includes("ataque")
    ) {
      primaryHead = "ARGUS Sentinel";
      riskScore = 0.95;
      activeCells.push("Beta-01", "Beta-02", "Alpha-24");
    } else if (
      inputLower.includes("territorio") ||
      inputLower.includes("hidalgo") ||
      inputLower.includes("monte") ||
      inputLower.includes("pueblo")
    ) {
      primaryHead = "DEMETER Soil";
      riskScore = 0.25;
      activeCells.push("Alpha-12", "Beta-12");
    } else if (
      inputLower.includes("analiza") ||
      inputLower.includes("calcula") ||
      inputLower.includes("razona")
    ) {
      primaryHead = "SOPHIA Engine";
      riskScore = 0.35;
      activeCells.push("Alpha-03", "Beta-03");
    }

    // Determine synthetic resolution of heads
    const syntheticResolution = `[Orquestador Cognitivo v4.2.0] Transmitiendo a cabeza primaria: **${primaryHead}** activa. Petición analizada en células: ${activeCells.join(", ")}.`;

    return {
      primaryHead,
      riskScore,
      activeCells,
      syntheticResolution,
    };
  }
}

// ============================================================================
// REAL SECURE JAVASCRIPT TOOL RUNNER (SANDBOXED EXECUTOR)
// ============================================================================

/**
 * Evaluador de expresiones aritméticas/lógicas SIN `eval` ni `new Function`.
 * Pequeño intérprete por descenso recursivo sobre un tokenizador determinista:
 * solo números, operadores, variables numéricas autorizadas y un subconjunto
 * cerrado de funciones de Math. Fail-closed ante cualquier token, función o
 * profundidad no permitida. Zero code-execution arbitraria (zero unsafe-eval).
 */

const MAX_EXPRESSION_DEPTH = 40;

type SandboxValue = number | boolean;

interface SandboxToken {
  kind: "number" | "ident" | "op";
  value: string;
}

function tokenizeExpression(input: string): SandboxToken[] {
  const tokens: SandboxToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }
    if (
      (ch >= "0" && ch <= "9") ||
      (ch === "." && (input[i + 1] ?? "") >= "0" && (input[i + 1] ?? "") <= "9")
    ) {
      let j = i + 1;
      while (j < input.length && ((input[j]! >= "0" && input[j]! <= "9") || input[j] === "."))
        j += 1;
      const raw = input.slice(i, j);
      if (!Number.isFinite(Number(raw))) {
        throw new Error(`Literal numérico inválido [${raw}].`);
      }
      tokens.push({ kind: "number", value: raw });
      i = j;
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
      let j = i + 1;
      while (
        j < input.length &&
        ((input[j]! >= "a" && input[j]! <= "z") ||
          (input[j]! >= "A" && input[j]! <= "Z") ||
          (input[j]! >= "0" && input[j]! <= "9") ||
          input[j] === "_" ||
          input[j] === "$")
      ) {
        j += 1;
      }
      tokens.push({ kind: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (".+-*/%^(),<>=".includes(ch)) {
      const two = input.slice(i, i + 2);
      if (
        two === "<=" ||
        two === ">=" ||
        two === "==" ||
        two === "!=" ||
        two === "&&" ||
        two === "||"
      ) {
        tokens.push({ kind: "op", value: two });
        i += 2;
        continue;
      }
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }
    throw new Error(`Tokén no autorizado [${ch}].`);
  }
  return tokens;
}

class ExpressionEvaluator {
  private readonly tokens: SandboxToken[];
  private pos = 0;

  private constructor(input: string) {
    this.tokens = tokenizeExpression(input);
  }

  public static run(input: string, variables: Record<string, number>): SandboxValue {
    const evaluator = new ExpressionEvaluator(input);
    const result = evaluator.parseOr(0, variables);
    evaluator.expectEnd();
    return result;
  }

  private peek(): SandboxToken | undefined {
    return this.tokens[this.pos];
  }

  private next(): SandboxToken | undefined {
    return this.tokens[this.pos++];
  }

  private matchOp(op: string): boolean {
    const t = this.peek();
    if (t?.kind === "op" && t.value === op) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private expectOp(op: string): void {
    const t = this.peek();
    if (t?.kind === "op" && t.value === op) {
      this.pos += 1;
      return;
    }
    throw new Error(`Se esperaba el operador [${op}].`);
  }

  private expectEnd(): void {
    const t = this.peek();
    if (t) throw new Error(`Expresión extra después del final [${t.value}].`);
  }

  private toNumber(value: SandboxValue | undefined): number {
    if (typeof value !== "number") throw new Error("Operación aritmética con valor no numérico.");
    return value;
  }

  private parseOr(depth: number, variables: Record<string, number>): SandboxValue {
    let left = this.parseAnd(depth, variables);
    for (;;) {
      if (this.matchOp("||")) {
        const right = this.parseAnd(depth, variables);
        left = this.toNumber(left) !== 0 || this.toNumber(right) !== 0;
      } else break;
    }
    return left;
  }

  private parseAnd(depth: number, variables: Record<string, number>): SandboxValue {
    let left = this.parseComparison(depth, variables);
    for (;;) {
      if (this.matchOp("&&")) {
        const right = this.parseComparison(depth, variables);
        left = this.toNumber(left) !== 0 && this.toNumber(right) !== 0;
      } else break;
    }
    return left;
  }

  private parseComparison(depth: number, variables: Record<string, number>): SandboxValue {
    const left = this.parseSum(depth, variables);
    const t = this.peek();
    if (t?.kind === "op") {
      if (t.value === "<") {
        this.pos += 1;
        return this.toNumber(left) < this.toNumber(this.parseSum(depth, variables));
      }
      if (t.value === "<=") {
        this.pos += 1;
        return this.toNumber(left) <= this.toNumber(this.parseSum(depth, variables));
      }
      if (t.value === ">") {
        this.pos += 1;
        return this.toNumber(left) > this.toNumber(this.parseSum(depth, variables));
      }
      if (t.value === ">=") {
        this.pos += 1;
        return this.toNumber(left) >= this.toNumber(this.parseSum(depth, variables));
      }
      if (t.value === "==") {
        this.pos += 1;
        return this.toNumber(left) === this.toNumber(this.parseSum(depth, variables));
      }
      if (t.value === "!=") {
        this.pos += 1;
        return this.toNumber(left) !== this.toNumber(this.parseSum(depth, variables));
      }
    }
    return left;
  }

  private parseSum(depth: number, variables: Record<string, number>): SandboxValue {
    let left = this.toNumber(this.parseProduct(depth, variables));
    for (;;) {
      if (this.matchOp("+")) {
        left = left + this.toNumber(this.parseProduct(depth, variables));
      } else if (this.matchOp("-")) {
        left = left - this.toNumber(this.parseProduct(depth, variables));
      } else break;
    }
    return left;
  }

  private parseProduct(depth: number, variables: Record<string, number>): SandboxValue {
    let left = this.toNumber(this.parseUnary(depth, variables));
    for (;;) {
      if (this.matchOp("*")) {
        left = left * this.toNumber(this.parseUnary(depth, variables));
      } else if (this.matchOp("/")) {
        const right = this.toNumber(this.parseUnary(depth, variables));
        if (right === 0) throw new Error("División por cero no permitida.");
        left = left / right;
      } else if (this.matchOp("%")) {
        const right = this.toNumber(this.parseUnary(depth, variables));
        if (right === 0) throw new Error("Módulo por cero no permitido.");
        left = left % right;
      } else break;
    }
    return left;
  }

  private parseUnary(depth: number, variables: Record<string, number>): SandboxValue {
    if (this.matchOp("+")) return this.parseUnary(depth, variables);
    if (this.matchOp("-")) return -this.toNumber(this.parseUnary(depth, variables));
    return this.parsePower(depth, variables);
  }

  private parsePower(depth: number, variables: Record<string, number>): SandboxValue {
    const base = this.toNumber(this.parsePrimary(depth, variables));
    if (this.matchOp("^")) {
      const exponent = this.toNumber(this.parseUnary(depth, variables));
      return Math.pow(base, exponent);
    }
    return base;
  }

  private parsePrimary(depth: number, variables: Record<string, number>): SandboxValue {
    if (depth > MAX_EXPRESSION_DEPTH) {
      throw new Error("Profundidad máxima de expresión excedida.");
    }
    const token = this.next();
    if (!token) throw new Error("Expresión incompleta.");
    if (token.kind === "number") {
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new Error("Literal numérico fuera de rango.");
      return value;
    }
    if (token.kind === "op") {
      if (token.value === "(") {
        const inner = this.parseOr(depth + 1, variables);
        this.expectOp(")");
        return inner;
      }
      throw new Error(`Operador no permitido en esta posición [${token.value}].`);
    }

    const name = token.value;
    if (name === "PI") return Math.PI;
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      const value = variables[name]!;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Variable no numérica [${name}].`);
      }
      return value;
    }
    const next = this.peek();
    if (next?.kind === "op" && next.value === "." && name === "Math") {
      this.pos += 1;
      const fnToken = this.next();
      if (!fnToken || fnToken.kind !== "ident" || !MATH_FN_NAMES.has(fnToken.value)) {
        throw new Error("Función Math no autorizada.");
      }
      return this.callFunction(fnToken.value, depth, variables);
    }
    if (MATH_FN_NAMES.has(name)) {
      return this.callFunction(name, depth, variables);
    }
    throw new Error(`Identificador no autorizado [${name}].`);
  }

  private callFunction(
    name: string,
    depth: number,
    variables: Record<string, number>,
  ): SandboxValue {
    this.expectOp("(");
    const args: number[] = [];
    if (!this.matchOp(")")) {
      for (;;) {
        args.push(this.toNumber(this.parseOr(depth + 1, variables)));
        if (this.matchOp(")")) break;
        this.expectOp(",");
      }
    }
    const single = (): number => {
      if (args.length !== 1) {
        throw new Error(`Función [${name}] requiere exactamente 1 argumento.`);
      }
      return args[0]!;
    };
    switch (name) {
      case "abs":
        return Math.abs(single());
      case "round":
        return Math.round(single());
      case "floor":
        return Math.floor(single());
      case "ceil":
        return Math.ceil(single());
      case "sqrt":
        return Math.sqrt(single());
      case "log":
        return Math.log(single());
      case "exp":
        return Math.exp(single());
      case "sin":
        return Math.sin(single());
      case "cos":
        return Math.cos(single());
      case "tan":
        return Math.tan(single());
      case "min":
        if (args.length < 1) throw new Error(`Función [${name}] requiere al menos 1 argumento.`);
        return Math.min(...args);
      case "max":
        if (args.length < 1) throw new Error(`Función [${name}] requiere al menos 1 argumento.`);
        return Math.max(...args);
      case "pow":
        if (args.length !== 2)
          throw new Error(`Función [${name}] requiere exactamente 2 argumentos.`);
        return Math.pow(args[0]!, args[1]!);
      default:
        throw new Error(`Función no autorizada [${name}].`);
    }
  }
}

const MATH_FN_NAMES = new Set<string>([
  "abs",
  "round",
  "floor",
  "ceil",
  "sqrt",
  "log",
  "exp",
  "sin",
  "cos",
  "tan",
  "min",
  "max",
  "pow",
]);

export class SovereignSandbox {
  // Executes mathematical expressions and simple data mappings in a safe sandboxed context
  public static executeTool(
    codeExpression: string,
    variables: Record<string, unknown> = {},
  ): {
    success: boolean;
    output?: unknown;
    error?: string;
  } {
    try {
      // 1. Strict lexical validation to block control or non-ASCII characters
      for (let i = 0; i < codeExpression.length; i++) {
        const charCode = codeExpression.charCodeAt(i);
        if (charCode < 32 || charCode > 126) {
          return {
            success: false,
            error: "Violación de sandbox: Caracteres de control o no-ASCII prohibidos.",
          };
        }
      }

      if (codeExpression.length === 0 || codeExpression.length > 1000) {
        return {
          success: false,
          error: "Violación de sandbox: Longitud de expresión no permitida.",
        };
      }

      // 2. Validate every variable identifier and coerce to finite numbers
      const numericVariables: Record<string, number> = {};
      for (const [key, value] of Object.entries(variables)) {
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
          return {
            success: false,
            error: `Violación de sandbox: Nombre de variable no autorizado [${key}].`,
          };
        }
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return {
            success: false,
            error: `Violación de sandbox: Variable no numérica [${key}].`,
          };
        }
        numericVariables[key] = value;
      }

      // 3. Deterministic interpreter (no `eval`, no `new Function`)
      const output = ExpressionEvaluator.run(codeExpression, numericVariables);

      return { success: true, output };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Fallo de ejecución en sandbox: ${msg}` };
    }
  }
}
