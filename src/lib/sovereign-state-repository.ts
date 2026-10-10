import { config } from "./config";
import { NeonRepository } from "./persistence/adapters/neon-adapter";
import * as crypto from "node:crypto";

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

export type UserRole = "SovereignOwner" | "Auditor" | "Operator" | "Guest";

export interface Tenant {
  id: string;
  name: string;
  region: string;
  quotaBalance: number;
  tier: "Free" | "Enterprise" | "Sovereign";
  metadata?: Record<string, unknown>;
}

export interface UserSession {
  userId: string;
  username: string;
  tenantId: string;
  role: UserRole;
  oidcSub: string;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  timestamp: string;
  traceId: string;
  correlationId: string;
  actorIp: string;
  event: string;
  severity: "S0" | "S1" | "S2" | "S3";
  details: string;
  remediated: boolean;
  verificationHash: string;
  previousLogHash: string;
}

export interface MonetizationAccount {
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

const GENESIS_PREVIOUS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

function isProductionRuntime(): boolean {
  try {
    const cfg = config();
    return (
      cfg.NODE_ENV === "production" ||
      cfg.ISABELLA_RUNTIME_MODE === "production" ||
      cfg.ISABELLA_RUNTIME_MODE === "staging"
    );
  } catch {
    return true;
  }
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function getSigningKey(): crypto.KeyObject | null {
  const key = config().BOOKPI_SIGNING_KEY;
  if (!key) return null;
  try {
    return crypto.createPrivateKey(key);
  } catch {
    return null;
  }
}

class SovereignStateRepository {
  private readonly tenantRepo: NeonRepository<Tenant>;
  private readonly sessionRepo: NeonRepository<UserSession>;
  private readonly ledgerRepo: NeonRepository<BookPILedgerBlock>;
  private readonly auditRepo: NeonRepository<AuditLog>;
  private readonly monetizationRepo: NeonRepository<MonetizationAccount>;
  private initialized = false;

  constructor() {
    this.tenantRepo = new NeonRepository<Tenant>("tenant");
    this.sessionRepo = new NeonRepository<UserSession>("session");
    this.ledgerRepo = new NeonRepository<BookPILedgerBlock>("ledger");
    this.auditRepo = new NeonRepository<AuditLog>("audit");
    this.monetizationRepo = new NeonRepository<MonetizationAccount>("monetization");
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    if (!isProductionRuntime()) {
      this.initialized = true;
      return;
    }
    await this.tenantRepo.health();
    await this.sessionRepo.health();
    await this.ledgerRepo.health();
    await this.auditRepo.health();
    await this.monetizationRepo.health();
    this.initialized = true;
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    await this.ensureInit();
    return this.tenantRepo.read(tenantId, tenantId);
  }

  async upsertTenant(tenant: Tenant): Promise<Tenant> {
    await this.ensureInit();
    const existing = await this.tenantRepo.read(tenant.id, tenant.id);
    if (existing) {
      return this.tenantRepo.update(tenant.id, tenant.id, tenant);
    }
    return this.tenantRepo.create(tenant.id, tenant);
  }

  async getSession(userId: string): Promise<UserSession | null> {
    await this.ensureInit();
    const { items } = await this.sessionRepo.list(userId, { userId }, 1, 0);
    return items[0] ?? null;
  }

  async upsertSession(session: UserSession): Promise<UserSession> {
    await this.ensureInit();
    const existing = await this.getSession(session.userId);
    if (existing) {
      return this.sessionRepo.update(session.userId, session.userId, session);
    }
    return this.sessionRepo.create(session.userId, session);
  }

  async getLedger(tenantId: string): Promise<BookPILedgerBlock[]> {
    await this.ensureInit();
    const { items } = await this.ledgerRepo.list(tenantId, { tenantId }, 1000, 0);
    return items;
  }

  async getFullLedger(): Promise<BookPILedgerBlock[]> {
    await this.ensureInit();
    const { items } = await this.ledgerRepo.list("system", {}, 10000, 0);
    return items;
  }

  async appendLedgerBlock(
    tenantId: string,
    userId: string,
    operation: string,
    category: BookPILedgerBlock["category"],
    cost: number,
    tokens: number,
  ): Promise<BookPILedgerBlock> {
    await this.ensureInit();
    const signingKey = getSigningKey();
    const isProduction = isProductionRuntime();
    if (isProduction && !signingKey) {
      throw new Error("BookPI requiere BOOKPI_SIGNING_KEY en producción.");
    }

    return this.ledgerRepo.withTransaction(async (client) => {
      const { rows: lastBlocks } = await client.query(
        `SELECT * FROM ledger WHERE tenant_id = $1 ORDER BY index DESC LIMIT 1`,
        [tenantId],
      );
      const lastBlock = lastBlocks[0];
      const prevHash = lastBlock ? lastBlock.block_hash : GENESIS_PREVIOUS_HASH;
      const index = (lastBlock?.index ?? -1) + 1;
      const timestamp = new Date().toISOString();
      const costDecimal = cost.toFixed(5);
      const blockContent = `${index}-${timestamp}-${tenantId}-${userId}-${operation}-${category}-${costDecimal}-${tokens}-${prevHash}`;
      const blockHash = sha256(blockContent);
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

      await client.query(
        `INSERT INTO ledger (id, index, timestamp, tenant_id, user_id, operation, category, cost_decimal, tokens_consumed, previous_hash, block_hash, pqc_signature, signature_algorithm, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          `blk_${index}`,
          index,
          timestamp,
          tenantId,
          userId,
          operation,
          category,
          costDecimal,
          tokens,
          prevHash,
          blockHash,
          pqcSignature,
          newBlock.signatureAlgorithm,
          "settled",
        ],
      );

      const { rows: tenantRows } = await client.query(
        `SELECT quota_balance FROM tenants WHERE id = $1 FOR UPDATE`,
        [tenantId],
      );
      if (tenantRows[0]) {
        const newBalance = Math.max(0, Number(tenantRows[0].quota_balance) - cost);
        await client.query(`UPDATE tenants SET quota_balance = $1 WHERE id = $2`, [
          newBalance,
          tenantId,
        ]);
      }

      return newBlock;
    });
  }

  async appendRefundEvent(
    index: number,
    tenantId: string,
  ): Promise<{ success: boolean; error?: string }> {
    await this.ensureInit();
    const signingKey = getSigningKey();
    const isProduction = isProductionRuntime();
    if (isProduction && !signingKey) {
      return {
        success: false,
        error: "BookPI requiere BOOKPI_SIGNING_KEY en producción.",
      };
    }

    return this.ledgerRepo.withTransaction(async (client) => {
      const { rows: blockRows } = await client.query(
        `SELECT * FROM ledger WHERE index = $1 AND tenant_id = $2 LIMIT 1`,
        [index, tenantId],
      );
      if (!blockRows[0]) return { success: false, error: "Transacción no encontrada." };
      const block = blockRows[0];

      const { rows: refundCheck } = await client.query(
        `SELECT 1 FROM ledger WHERE operation = $1 AND tenant_id = $2 LIMIT 1`,
        [`REFUND_EVENT: Reembolso de transacción index ${index}`, tenantId],
      );
      if (refundCheck[0] || block.status === "refunded") {
        return {
          success: false,
          error: "Esta transacción ya ha sido reembolsada.",
        };
      }

      const { rows: lastBlocks } = await client.query(
        `SELECT * FROM ledger WHERE tenant_id = $1 ORDER BY index DESC LIMIT 1`,
        [tenantId],
      );
      const prevBlock = lastBlocks[0];
      const prevHash = prevBlock ? prevBlock.block_hash : GENESIS_PREVIOUS_HASH;
      const newIndex = (prevBlock?.index ?? -1) + 1;
      const timestamp = new Date().toISOString();
      const cost = parseFloat(block.cost_decimal);
      const costDecimal = `-${block.cost_decimal}`;

      const blockData = `${newIndex}-${timestamp}-${tenantId}-${block.user_id}-REFUND_EVENT: Reembolso de transacción index ${index}-REFUND_EVENT-${costDecimal}-0-${prevHash}`;
      const blockHash = sha256(blockData);
      const pqcSignature = signingKey
        ? crypto.sign("sha384", Buffer.from(blockData), signingKey).toString("base64url")
        : null;

      await client.query(
        `INSERT INTO ledger (id, index, timestamp, tenant_id, user_id, operation, category, cost_decimal, tokens_consumed, previous_hash, block_hash, pqc_signature, signature_algorithm, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          `blk_${newIndex}`,
          newIndex,
          timestamp,
          tenantId,
          block.user_id,
          `REFUND_EVENT: Reembolso de transacción index ${index}`,
          "REFUND_EVENT",
          costDecimal,
          0,
          prevHash,
          blockHash,
          pqcSignature,
          signingKey ? "ECDSA-P384" : "UNSIGNED_DEV",
          "settled",
        ],
      );

      const { rows: tenantRows } = await client.query(
        `SELECT quota_balance FROM tenants WHERE id = $1 FOR UPDATE`,
        [tenantId],
      );
      if (tenantRows[0]) {
        const newBalance = Number(tenantRows[0].quota_balance) + cost;
        await client.query(`UPDATE tenants SET quota_balance = $1 WHERE id = $2`, [
          newBalance,
          tenantId,
        ]);
      }

      return { success: true };
    });
  }

  async getAuditLogs(tenantId: string, limit = 100): Promise<AuditLog[]> {
    await this.ensureInit();
    const { items } = await this.auditRepo.list(tenantId, { tenantId }, limit, 0);
    return items;
  }

  async appendAuditLog(
    traceId: string,
    correlationId: string,
    ip: string,
    event: string,
    severity: AuditLog["severity"],
    details: string,
    tenantId: string,
  ): Promise<AuditLog> {
    await this.ensureInit();
    return this.auditRepo.withTransaction(async (client) => {
      const { rows: lastLogs } = await client.query(
        `SELECT verification_hash FROM audit_events WHERE tenant_id = $1 ORDER BY timestamp DESC LIMIT 1`,
        [tenantId],
      );
      const previousLogHash = (lastLogs[0]?.verification_hash as string) ?? "0".repeat(64);
      const timestamp = new Date().toISOString();
      const remediated = severity === "S3" || severity === "S2";
      const id = `evt_${crypto.randomUUID().slice(0, 8)}`;
      const payload = `${id}|${timestamp}|${traceId}|${correlationId}|${ip}|${event}|${severity}|${details}|${remediated ? "true" : "false"}|${tenantId}|${previousLogHash}`;
      const verificationHash = sha256(payload);

      const newLog: AuditLog = {
        id,
        tenantId,
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

      await client.query(
        `INSERT INTO audit_events (id, tenant_id, trace_id, correlation_id, actor_ip, event, severity, details, remediated, verification_hash, previous_log_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          tenantId,
          traceId,
          correlationId,
          ip,
          event,
          severity,
          details,
          remediated,
          verificationHash,
          previousLogHash,
        ],
      );

      return newLog;
    });
  }

  async verifyLedgerIntegrity(): Promise<{
    success: boolean;
    error?: string;
    corruptedIndex?: number;
  }> {
    await this.ensureInit();
    const { items: ledger } = await this.ledgerRepo.list("system", {}, 10000, 0);
    for (let i = 0; i < ledger.length; i++) {
      const block = ledger[i];
      if (!block) {
        return {
          success: false,
          error: `Bloque ausente en índice ${i}.`,
          corruptedIndex: i,
        };
      }
      if (block.index !== i) {
        return {
          success: false,
          error: `Fallo de secuencia: Esperado índice ${i}, encontrado ${block.index}.`,
          corruptedIndex: i,
        };
      }
      if (i > 0) {
        const prevBlock = ledger[i - 1];
        if (!prevBlock || block.previousHash !== prevBlock.blockHash) {
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
      const blockContent = `${block.index}-${block.timestamp}-${block.tenantId}-${block.userId}-${block.operation}-${block.category}-${block.costDecimal}-${block.tokensConsumed}-${block.previousHash}`;
      const expectedHash = sha256(blockContent);
      if (block.blockHash !== expectedHash) {
        return {
          success: false,
          error: `Fallo de integridad de datos (Hash mismatch) en bloque ${i}.`,
          corruptedIndex: i,
        };
      }
      if (
        isProductionRuntime() &&
        (block.signatureAlgorithm === "UNSIGNED_DEV" || block.pqcSignature === null)
      ) {
        return {
          success: false,
          error: `Bloque ${i} sin firma BookPI válida en modo productivo.`,
          corruptedIndex: i,
        };
      }
    }
    return { success: true };
  }

  async verifyAuditChain(): Promise<{
    success: boolean;
    error?: string;
    corruptedId?: string;
  }> {
    await this.ensureInit();
    const { items: logs } = await this.auditRepo.list("system", {}, 10000, 0);
    const sorted = [...logs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    for (let i = 0; i < sorted.length; i++) {
      const log = sorted[i];
      const prevLog = sorted[i - 1];
      const expectedPrevHash = i === 0 ? GENESIS_PREVIOUS_HASH : (prevLog?.verificationHash ?? "");
      if (log.previousLogHash !== expectedPrevHash) {
        return {
          success: false,
          error: `Violación de integridad: El hash del log anterior no coincide en el evento [${log.id}].`,
          corruptedId: log.id,
        };
      }
      const payload = `${log.id}|${log.timestamp}|${log.traceId}|${log.correlationId}|${log.actorIp}|${log.event}|${log.severity}|${log.details}|${log.remediated ? "true" : "false"}|${log.tenantId}|${log.previousLogHash}`;
      const recalculatedHash = sha256(payload);
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

  async getMonetizationAccount(userId: string): Promise<MonetizationAccount> {
    await this.ensureInit();
    let account = await this.monetizationRepo.read(userId, userId);
    if (!account) {
      account = {
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
      await this.monetizationRepo.create(userId, account);
    }
    return account;
  }

  async updateMonetizationAccount(
    userId: string,
    update: Partial<MonetizationAccount>,
  ): Promise<MonetizationAccount> {
    await this.ensureInit();
    const account = await this.getMonetizationAccount(userId);
    const updated = { ...account, ...update };
    return this.monetizationRepo.update(userId, userId, updated);
  }

  async getMarketplaceListings(): Promise<unknown[]> {
    await this.ensureInit();
    const { items } = await this.tenantRepo.list("system", { slug: "marketplace" }, 1, 0);
    if (items[0]?.metadata?.marketplaceListings) {
      return items[0].metadata.marketplaceListings as unknown[];
    }
    return [];
  }

  async saveMarketplaceListings(listings: unknown[]): Promise<void> {
    await this.ensureInit();
    const { items } = await this.tenantRepo.list("system", { slug: "marketplace" }, 1, 0);
    if (items[0]) {
      await this.tenantRepo.update("system", items[0].id, {
        metadata: { ...items[0].metadata, marketplaceListings: listings },
      });
    } else {
      await this.tenantRepo.create("system", {
        id: "marketplace",
        name: "Marketplace",
        region: "global",
        quotaBalance: 0,
        tier: "Sovereign",
        slug: "marketplace",
        metadata: { marketplaceListings: listings },
      } as Tenant);
    }
  }
}

export const sovereignStateRepository = new SovereignStateRepository();
