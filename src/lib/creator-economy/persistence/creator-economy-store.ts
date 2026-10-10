/**
 * Native persistence for the Creator Economy module — SQLite (WAL) with
 * in-memory degradation, same operational contract as the subscription
 * store. Ledger entries are append-only by construction: the write path
 * exposes insertTransaction/insertEntries only; reversals are new
 * transactions that flip direction.
 */

import { randomUUID } from "node:crypto";
import { nodeRequire } from "../../node-require";
import type BetterSqlite3 from "better-sqlite3";
import type {
  ContentAsset,
  CreatorProfile,
  Entitlement,
  KycVerificationStatus,
  LedgerEntry,
  LedgerTransaction,
  MonetizationOffer,
  PayoutRequest,
  PayoutStatus,
  ScheduledPublication,
  SkillExecution,
  SocialChannel,
} from "../types";
import type { AccountType, Currency } from "../types";

type SqliteDatabase = BetterSqlite3.Database;

export interface CreatorEconomyStore {
  readonly mode: "sqlite" | "in-memory";

  // profiles / kyc / entitlements
  upsertProfile(profile: CreatorProfile): void;
  getProfile(creatorId: string): CreatorProfile | null;
  upsertKyc(kyc: KycVerificationStatus): void;
  getKyc(creatorId: string): KycVerificationStatus | null;
  upsertEntitlement(ent: Entitlement): void;
  getEntitlement(creatorId: string): Entitlement | null;

  // assets
  insertAsset(asset: ContentAsset): void;
  getAsset(assetId: string): ContentAsset | null;
  updateAssetStatus(
    assetId: string,
    status: ContentAsset["status"],
    approvedByCreatorAt?: string | null,
  ): void;
  listAssets(creatorId: string): ContentAsset[];

  // offers / gifts
  upsertOffer(offer: MonetizationOffer): void;
  getOffer(offerId: string): MonetizationOffer | null;
  listOffers(creatorId?: string, status?: MonetizationOffer["status"]): MonetizationOffer[];

  // ledger (append-only)
  insertTransaction(tx: LedgerTransaction): boolean; // false if idempotencyKey already used
  insertEntries(entries: LedgerEntry[]): void;
  getEntriesByTransaction(transactionId: string): LedgerEntry[];
  getAccountBalance(creatorTenant: string, account: AccountType): number; // debit − credit, posted only
  verifyLedgerBalance(transactionId: string): number; // Σdebit − Σcredit; 0 = OK
  listUnbalancedTransactions(limit?: number): string[];

  // skills
  insertSkillExecution(exec: SkillExecution): void;
  listSkillExecutions(creatorId: string, limit?: number): SkillExecution[];

  // payouts
  insertPayout(payout: PayoutRequest): boolean; // false if idempotencyKey exists
  getPayoutByIdempotencyKey(key: string): PayoutRequest | null;
  updatePayoutStatus(
    id: string,
    status: PayoutStatus,
    processedAt?: string | null,
    ref?: string | null,
  ): void;
  listPayouts(creatorId: string): PayoutRequest[];

  // social channels
  upsertChannel(channel: SocialChannel): void;
  getChannel(channelId: string): SocialChannel | null;
  listChannels(creatorId: string): SocialChannel[];
  updateChannelStatus(channelId: string, status: SocialChannel["status"]): void;

  // scheduled publications
  insertPublication(pub: ScheduledPublication): void;
  updatePublicationStatus(
    id: string,
    status: ScheduledPublication["status"],
    externalRef?: string | null,
  ): void;
  listPublications(creatorId: string): ScheduledPublication[];
}

// ---------- shared row mappers ----------

const j = (v: unknown) => JSON.stringify(v ?? null);
const p = <T>(s: string | null | undefined, fallback: T): T => {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

function now(): string {
  return new Date().toISOString();
}

// ============================ SQLite ============================

class SqliteCreatorEconomyStore implements CreatorEconomyStore {
  readonly mode = "sqlite" as const;
  private db: SqliteDatabase;

  constructor(dbPath?: string) {
    const Ctor = nodeRequire("better-sqlite3") as new (filename: string) => SqliteDatabase;
    this.db = new Ctor(dbPath || process.env.ISABELLA_DB_PATH || "./data/isabella.db");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ce_profiles (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        displayName TEXT NOT NULL,
        skills TEXT NOT NULL DEFAULT '[]',
        interests TEXT NOT NULL DEFAULT '[]',
        audienceSegments TEXT NOT NULL DEFAULT '[]',
        availabilityMinutesPerWeek INTEGER NOT NULL DEFAULT 120,
        privacyPreferences TEXT NOT NULL DEFAULT '{}',
        objectives TEXT NOT NULL DEFAULT '[]',
        onboardingStatus TEXT NOT NULL DEFAULT 'incomplete',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ce_kyc (
        creatorId TEXT PRIMARY KEY REFERENCES ce_profiles(id) ON DELETE CASCADE,
        level TEXT NOT NULL DEFAULT 'none',
        rfcSubmitted INTEGER NOT NULL DEFAULT 0,
        rfcValidated INTEGER NOT NULL DEFAULT 0,
        eFirmaValid INTEGER NOT NULL DEFAULT 0,
        bankAccountVerified INTEGER NOT NULL DEFAULT 0,
        clabeHolderNameMatch INTEGER NOT NULL DEFAULT 0,
        proofOfAddressVerified INTEGER NOT NULL DEFAULT 0,
        taxResidencyCountry TEXT NOT NULL DEFAULT 'MX',
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ce_entitlements (
        creatorId TEXT PRIMARY KEY REFERENCES ce_profiles(id) ON DELETE CASCADE,
        tenantId TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        monthlyCredits INTEGER NOT NULL DEFAULT 50,
        remainingCredits INTEGER NOT NULL DEFAULT 50,
        canUseSkills INTEGER NOT NULL DEFAULT 1,
        canCreateOffers INTEGER NOT NULL DEFAULT 0,
        maxActiveOffers INTEGER NOT NULL DEFAULT 0,
        canReceiveGifts INTEGER NOT NULL DEFAULT 0,
        canRequestPayout INTEGER NOT NULL DEFAULT 0,
        canPublishExternally INTEGER NOT NULL DEFAULT 0,
        maxConnectedChannels INTEGER NOT NULL DEFAULT 1,
        requiresHumanApproval INTEGER NOT NULL DEFAULT 1,
        policyVersion TEXT NOT NULL,
        expiresAt TEXT
      );
      CREATE TABLE IF NOT EXISTS ce_assets (
        id TEXT PRIMARY KEY,
        creatorId TEXT NOT NULL REFERENCES ce_profiles(id) ON DELETE CASCADE,
        sourceAssetId TEXT,
        format TEXT NOT NULL,
        contentUri TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        provenance TEXT NOT NULL,
        hashSHA256 TEXT NOT NULL,
        approvedByCreatorAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ce_assets_creator ON ce_assets(creatorId, status);

      CREATE TABLE IF NOT EXISTS ce_offers (
        id TEXT PRIMARY KEY,
        creatorId TEXT NOT NULL REFERENCES ce_profiles(id) ON DELETE CASCADE,
        tenantId TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priceAmountMinor INTEGER NOT NULL CHECK (priceAmountMinor >= 0),
        priceCurrency TEXT NOT NULL DEFAULT 'MXN',
        status TEXT NOT NULL DEFAULT 'draft',
        evidence TEXT NOT NULL DEFAULT '{}',
        sponsorshipDisclosed INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ce_offers_creator ON ce_offers(creatorId, status);

      CREATE TABLE IF NOT EXISTS ce_ledger_transactions (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        kind TEXT NOT NULL,
        idempotencyKey TEXT UNIQUE NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ce_ledger_entries (
        id TEXT PRIMARY KEY,
        transactionId TEXT NOT NULL REFERENCES ce_ledger_transactions(id),
        tenantId TEXT NOT NULL,
        account TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
        amountMinor INTEGER NOT NULL CHECK (amountMinor > 0),
        currency TEXT NOT NULL DEFAULT 'MXN',
        status TEXT NOT NULL DEFAULT 'posted',
        memo TEXT NOT NULL DEFAULT '',
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ce_ledger_tx ON ce_ledger_entries(transactionId);
      CREATE INDEX IF NOT EXISTS idx_ce_ledger_account ON ce_ledger_entries(tenantId, account, createdAt);

      CREATE TABLE IF NOT EXISTS ce_skill_executions (
        executionId TEXT PRIMARY KEY,
        skillId TEXT NOT NULL,
        creatorId TEXT NOT NULL,
        creditsDeducted INTEGER NOT NULL,
        remainingCredits INTEGER NOT NULL,
        status TEXT NOT NULL,
        inputHash TEXT NOT NULL,
        outputSummary TEXT NOT NULL DEFAULT '',
        executedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ce_payouts (
        id TEXT PRIMARY KEY,
        creatorId TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'MXN',
        requestedMinor INTEGER NOT NULL,
        feeMinor INTEGER NOT NULL DEFAULT 0,
        taxWithheldMinor INTEGER NOT NULL DEFAULT 0,
        netPayoutMinor INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'requested',
        idempotencyKey TEXT UNIQUE NOT NULL,
        requestedAt TEXT NOT NULL,
        processedAt TEXT,
        bankAccountMasked TEXT NOT NULL DEFAULT '',
        disbursementReference TEXT
      );

      CREATE TABLE IF NOT EXISTS ce_channels (
        id TEXT PRIMARY KEY,
        creatorId TEXT NOT NULL,
        provider TEXT NOT NULL,
        externalAccountId TEXT NOT NULL,
        displayName TEXT NOT NULL DEFAULT '',
        scopes TEXT NOT NULL DEFAULT '[]',
        tokenCiphertext TEXT NOT NULL,
        tokenIv TEXT NOT NULL,
        tokenTag TEXT NOT NULL,
        expiresAt TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        connectedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ce_publications (
        id TEXT PRIMARY KEY,
        creatorId TEXT NOT NULL,
        channelId TEXT NOT NULL REFERENCES ce_channels(id),
        assetId TEXT NOT NULL,
        scheduledAt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        approvedByCreatorAt TEXT NOT NULL,
        publishedAt TEXT,
        externalRef TEXT
      );
    `);
  }

  upsertProfile(profile: CreatorProfile): void {
    this.db
      .prepare(
        `INSERT INTO ce_profiles (id, tenantId, displayName, skills, interests, audienceSegments,
          availabilityMinutesPerWeek, privacyPreferences, objectives, onboardingStatus, createdAt, updatedAt)
         VALUES (@id,@tenantId,@displayName,@skills,@interests,@audienceSegments,
          @availabilityMinutesPerWeek,@privacyPreferences,@objectives,@onboardingStatus,@createdAt,@updatedAt)
         ON CONFLICT(id) DO UPDATE SET
          displayName=excluded.displayName, skills=excluded.skills, interests=excluded.interests,
          audienceSegments=excluded.audienceSegments,
          availabilityMinutesPerWeek=excluded.availabilityMinutesPerWeek,
          privacyPreferences=excluded.privacyPreferences, objectives=excluded.objectives,
          onboardingStatus=excluded.onboardingStatus, updatedAt=excluded.updatedAt`,
      )
      .run({
        ...profile,
        skills: j(profile.skills),
        interests: j(profile.interests),
        audienceSegments: j(profile.audienceSegments),
        privacyPreferences: j(profile.privacyPreferences),
        objectives: j(profile.objectives),
      });
  }

  getProfile(creatorId: string): CreatorProfile | null {
    const row = this.db.prepare("SELECT * FROM ce_profiles WHERE id = ?").get(creatorId) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      tenantId: row.tenantId as string,
      displayName: row.displayName as string,
      skills: p(row.skills as string, []),
      interests: p(row.interests as string, []),
      audienceSegments: p(row.audienceSegments as string, []),
      availabilityMinutesPerWeek: row.availabilityMinutesPerWeek as number,
      privacyPreferences: p(row.privacyPreferences as string, {
        showFace: true,
        allowVoice: true,
        allowLocation: false,
        allowExternalPublishing: false,
      }),
      objectives: p(row.objectives as string, []),
      onboardingStatus: row.onboardingStatus as CreatorProfile["onboardingStatus"],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  upsertKyc(kyc: KycVerificationStatus): void {
    this.db
      .prepare(
        `INSERT INTO ce_kyc (creatorId, level, rfcSubmitted, rfcValidated, eFirmaValid,
          bankAccountVerified, clabeHolderNameMatch, proofOfAddressVerified, taxResidencyCountry, updatedAt)
         VALUES (@creatorId,@level,@rfcSubmitted,@rfcValidated,@eFirmaValid,
          @bankAccountVerified,@clabeHolderNameMatch,@proofOfAddressVerified,@taxResidencyCountry,@updatedAt)
         ON CONFLICT(creatorId) DO UPDATE SET
          level=excluded.level, rfcSubmitted=excluded.rfcSubmitted, rfcValidated=excluded.rfcValidated,
          eFirmaValid=excluded.eFirmaValid, bankAccountVerified=excluded.bankAccountVerified,
          clabeHolderNameMatch=excluded.clabeHolderNameMatch,
          proofOfAddressVerified=excluded.proofOfAddressVerified,
          taxResidencyCountry=excluded.taxResidencyCountry, updatedAt=excluded.updatedAt`,
      )
      .run({
        ...kyc,
        rfcSubmitted: kyc.rfcSubmitted ? 1 : 0,
        rfcValidated: kyc.rfcValidated ? 1 : 0,
        eFirmaValid: kyc.eFirmaValid ? 1 : 0,
        bankAccountVerified: kyc.bankAccountVerified ? 1 : 0,
        clabeHolderNameMatch: kyc.clabeHolderNameMatch ? 1 : 0,
        proofOfAddressVerified: kyc.proofOfAddressVerified ? 1 : 0,
      });
  }

  getKyc(creatorId: string): KycVerificationStatus | null {
    const row = this.db.prepare("SELECT * FROM ce_kyc WHERE creatorId = ?").get(creatorId) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      creatorId,
      level: row.level as KycVerificationStatus["level"],
      rfcSubmitted: row.rfcSubmitted === 1,
      rfcValidated: row.rfcValidated === 1,
      eFirmaValid: row.eFirmaValid === 1,
      bankAccountVerified: row.bankAccountVerified === 1,
      clabeHolderNameMatch: row.clabeHolderNameMatch === 1,
      proofOfAddressVerified: row.proofOfAddressVerified === 1,
      taxResidencyCountry: row.taxResidencyCountry as string,
      updatedAt: row.updatedAt as string,
    };
  }

  upsertEntitlement(ent: Entitlement): void {
    this.db
      .prepare(
        `INSERT INTO ce_entitlements (creatorId, tenantId, plan, monthlyCredits, remainingCredits,
          canUseSkills, canCreateOffers, maxActiveOffers, canReceiveGifts, canRequestPayout,
          canPublishExternally, maxConnectedChannels, requiresHumanApproval, policyVersion, expiresAt)
         VALUES (@creatorId,@tenantId,@plan,@monthlyCredits,@remainingCredits,
          @canUseSkills,@canCreateOffers,@maxActiveOffers,@canReceiveGifts,@canRequestPayout,
          @canPublishExternally,@maxConnectedChannels,@requiresHumanApproval,@policyVersion,@expiresAt)
         ON CONFLICT(creatorId) DO UPDATE SET
          plan=excluded.plan, monthlyCredits=excluded.monthlyCredits,
          remainingCredits=excluded.remainingCredits, canUseSkills=excluded.canUseSkills,
          canCreateOffers=excluded.canCreateOffers, maxActiveOffers=excluded.maxActiveOffers,
          canReceiveGifts=excluded.canReceiveGifts, canRequestPayout=excluded.canRequestPayout,
          canPublishExternally=excluded.canPublishExternally,
          maxConnectedChannels=excluded.maxConnectedChannels,
          requiresHumanApproval=excluded.requiresHumanApproval,
          policyVersion=excluded.policyVersion, expiresAt=excluded.expiresAt`,
      )
      .run({
        ...ent,
        canUseSkills: ent.canUseSkills ? 1 : 0,
        canCreateOffers: ent.canCreateOffers ? 1 : 0,
        canReceiveGifts: ent.canReceiveGifts ? 1 : 0,
        canRequestPayout: ent.canRequestPayout ? 1 : 0,
        canPublishExternally: ent.canPublishExternally ? 1 : 0,
        requiresHumanApproval: ent.requiresHumanApproval ? 1 : 0,
      });
  }

  getEntitlement(creatorId: string): Entitlement | null {
    const row = this.db
      .prepare("SELECT * FROM ce_entitlements WHERE creatorId = ?")
      .get(creatorId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      creatorId,
      tenantId: row.tenantId as string,
      plan: row.plan as Entitlement["plan"],
      monthlyCredits: row.monthlyCredits as number,
      remainingCredits: row.remainingCredits as number,
      canUseSkills: row.canUseSkills === 1,
      canCreateOffers: row.canCreateOffers === 1,
      maxActiveOffers: row.maxActiveOffers as number,
      canReceiveGifts: row.canReceiveGifts === 1,
      canRequestPayout: row.canRequestPayout === 1,
      canPublishExternally: row.canPublishExternally === 1,
      maxConnectedChannels: row.maxConnectedChannels as number,
      requiresHumanApproval: row.requiresHumanApproval === 1,
      policyVersion: row.policyVersion as string,
      expiresAt: (row.expiresAt as string | null) ?? null,
    };
  }

  insertAsset(asset: ContentAsset): void {
    this.db
      .prepare(
        `INSERT INTO ce_assets (id, creatorId, sourceAssetId, format, contentUri, status,
          provenance, hashSHA256, approvedByCreatorAt, createdAt, updatedAt)
         VALUES (@id,@creatorId,@sourceAssetId,@format,@contentUri,@status,
          @provenance,@hashSHA256,@approvedByCreatorAt,@createdAt,@updatedAt)`,
      )
      .run({
        ...asset,
        provenance: j(asset.provenance),
        sourceAssetId: asset.sourceAssetId ?? null,
      });
  }

  getAsset(assetId: string): ContentAsset | null {
    const row = this.db.prepare("SELECT * FROM ce_assets WHERE id = ?").get(assetId) as
      Record<string, unknown> | undefined;
    return row ? this.rowToAsset(row) : null;
  }

  private rowToAsset(row: Record<string, unknown>): ContentAsset {
    return {
      id: row.id as string,
      creatorId: row.creatorId as string,
      sourceAssetId: (row.sourceAssetId as string | null) ?? undefined,
      format: row.format as ContentAsset["format"],
      contentUri: row.contentUri as string,
      status: row.status as ContentAsset["status"],
      provenance: p(row.provenance as string, {
        generatedBy: "user",
        transformations: [],
        createdAt: now(),
      }),
      hashSHA256: row.hashSHA256 as string,
      approvedByCreatorAt: (row.approvedByCreatorAt as string | null) ?? null,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  updateAssetStatus(
    assetId: string,
    status: ContentAsset["status"],
    approvedByCreatorAt?: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE ce_assets SET status = ?, approvedByCreatorAt = COALESCE(?, approvedByCreatorAt),
         updatedAt = ? WHERE id = ?`,
      )
      .run(status, approvedByCreatorAt ?? null, now(), assetId);
  }

  listAssets(creatorId: string): ContentAsset[] {
    const rows = this.db
      .prepare("SELECT * FROM ce_assets WHERE creatorId = ? ORDER BY createdAt DESC")
      .all(creatorId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAsset(r));
  }

  upsertOffer(offer: MonetizationOffer): void {
    this.db
      .prepare(
        `INSERT INTO ce_offers (id, creatorId, tenantId, type, title, description,
          priceAmountMinor, priceCurrency, status, evidence, sponsorshipDisclosed, createdAt)
         VALUES (@id,@creatorId,@tenantId,@type,@title,@description,
          @priceAmountMinor,@priceCurrency,@status,@evidence,@sponsorshipDisclosed,@createdAt)
         ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, description=excluded.description,
          priceAmountMinor=excluded.priceAmountMinor, priceCurrency=excluded.priceCurrency,
          status=excluded.status, evidence=excluded.evidence,
          sponsorshipDisclosed=excluded.sponsorshipDisclosed`,
      )
      .run({
        id: offer.id,
        creatorId: offer.creatorId,
        tenantId: offer.tenantId,
        type: offer.type,
        title: offer.title,
        description: offer.description,
        priceAmountMinor: offer.price.amountMinor,
        priceCurrency: offer.price.currency,
        status: offer.status,
        evidence: j(offer.evidence),
        sponsorshipDisclosed: offer.sponsorshipDisclosed ? 1 : 0,
        createdAt: offer.createdAt,
      });
  }

  getOffer(offerId: string): MonetizationOffer | null {
    const row = this.db.prepare("SELECT * FROM ce_offers WHERE id = ?").get(offerId) as
      Record<string, unknown> | undefined;
    return row ? this.rowToOffer(row) : null;
  }

  private rowToOffer(row: Record<string, unknown>): MonetizationOffer {
    return {
      id: row.id as string,
      creatorId: row.creatorId as string,
      tenantId: row.tenantId as string,
      type: row.type as MonetizationOffer["type"],
      title: row.title as string,
      description: row.description as string,
      price: {
        amountMinor: row.priceAmountMinor as number,
        currency: row.priceCurrency as Currency,
      },
      status: row.status as MonetizationOffer["status"],
      evidence: p(row.evidence as string, { interviews: 0, leads: 0, preorders: 0, sales: 0 }),
      sponsorshipDisclosed: row.sponsorshipDisclosed === 1,
      createdAt: row.createdAt as string,
    };
  }

  listOffers(creatorId?: string, status?: MonetizationOffer["status"]): MonetizationOffer[] {
    let sql = "SELECT * FROM ce_offers";
    const conds: string[] = [];
    const args: unknown[] = [];
    if (creatorId) {
      conds.push("creatorId = ?");
      args.push(creatorId);
    }
    if (status) {
      conds.push("status = ?");
      args.push(status);
    }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    sql += " ORDER BY createdAt DESC";
    const rows = this.db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
    return rows.map((r) => this.rowToOffer(r));
  }

  insertTransaction(tx: LedgerTransaction): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO ce_ledger_transactions (id, tenantId, kind, idempotencyKey, createdAt)
         VALUES (?,?,?,?,?)`,
      )
      .run(tx.id, tx.tenantId, tx.kind, tx.idempotencyKey, tx.createdAt);
    return res.changes > 0;
  }

  insertEntries(entries: LedgerEntry[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO ce_ledger_entries (id, transactionId, tenantId, account, direction,
        amountMinor, currency, status, memo, createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    const runAll = this.db.transaction((list: LedgerEntry[]) => {
      for (const e of list) {
        stmt.run(
          e.id,
          e.transactionId,
          e.tenantId,
          e.account,
          e.direction,
          e.amountMinor,
          e.currency,
          e.status,
          e.memo,
          e.createdAt,
        );
      }
    });
    runAll(entries);
  }

  getEntriesByTransaction(transactionId: string): LedgerEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM ce_ledger_entries WHERE transactionId = ?")
      .all(transactionId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      transactionId: r.transactionId as string,
      tenantId: r.tenantId as string,
      account: r.account as AccountType,
      direction: r.direction as LedgerEntry["direction"],
      amountMinor: r.amountMinor as number,
      currency: r.currency as Currency,
      status: r.status as LedgerEntry["status"],
      memo: r.memo as string,
      createdAt: r.createdAt as string,
    }));
  }

  getAccountBalance(tenantId: string, account: AccountType): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amountMinor ELSE -amountMinor END),0) AS bal
         FROM ce_ledger_entries WHERE tenantId = ? AND account = ? AND status = 'posted'`,
      )
      .get(tenantId, account) as { bal: number };
    return row.bal;
  }

  verifyLedgerBalance(transactionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amountMinor ELSE -amountMinor END),0) AS diff
         FROM ce_ledger_entries WHERE transactionId = ?`,
      )
      .get(transactionId) as { diff: number };
    return row.diff;
  }

  listUnbalancedTransactions(limit = 50): string[] {
    const rows = this.db
      .prepare(
        `SELECT transactionId, SUM(CASE WHEN direction='debit' THEN amountMinor ELSE -amountMinor END) AS diff
         FROM ce_ledger_entries GROUP BY transactionId HAVING diff <> 0 LIMIT ?`,
      )
      .all(limit) as Array<{ transactionId: string }>;
    return rows.map((r) => r.transactionId);
  }

  insertSkillExecution(exec: SkillExecution): void {
    this.db
      .prepare(
        `INSERT INTO ce_skill_executions (executionId, skillId, creatorId, creditsDeducted,
          remainingCredits, status, inputHash, outputSummary, executedAt)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        exec.executionId,
        exec.skillId,
        exec.creatorId,
        exec.creditsDeducted,
        exec.remainingCredits,
        exec.status,
        exec.inputHash,
        exec.outputSummary,
        exec.executedAt,
      );
  }

  listSkillExecutions(creatorId: string, limit = 50): SkillExecution[] {
    return this.db
      .prepare(
        "SELECT * FROM ce_skill_executions WHERE creatorId = ? ORDER BY executedAt DESC LIMIT ?",
      )
      .all(creatorId, limit) as SkillExecution[];
  }

  insertPayout(payout: PayoutRequest): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO ce_payouts (id, creatorId, currency, requestedMinor, feeMinor,
          taxWithheldMinor, netPayoutMinor, status, idempotencyKey, requestedAt, processedAt,
          bankAccountMasked, disbursementReference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        payout.id,
        payout.creatorId,
        payout.currency,
        payout.requestedMinor,
        payout.feeMinor,
        payout.taxWithheldMinor,
        payout.netPayoutMinor,
        payout.status,
        payout.idempotencyKey,
        payout.requestedAt,
        payout.processedAt,
        payout.bankAccountMasked,
        payout.disbursementReference,
      );
    return res.changes > 0;
  }

  getPayoutByIdempotencyKey(key: string): PayoutRequest | null {
    const row = this.db.prepare("SELECT * FROM ce_payouts WHERE idempotencyKey = ?").get(key) as
      PayoutRequest | undefined;
    return row ?? null;
  }

  updatePayoutStatus(
    id: string,
    status: PayoutStatus,
    processedAt?: string | null,
    ref?: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE ce_payouts SET status = ?, processedAt = COALESCE(?, processedAt),
         disbursementReference = COALESCE(?, disbursementReference) WHERE id = ?`,
      )
      .run(status, processedAt ?? null, ref ?? null, id);
  }

  listPayouts(creatorId: string): PayoutRequest[] {
    return this.db
      .prepare("SELECT * FROM ce_payouts WHERE creatorId = ? ORDER BY requestedAt DESC")
      .all(creatorId) as PayoutRequest[];
  }

  upsertChannel(channel: SocialChannel): void {
    this.db
      .prepare(
        `INSERT INTO ce_channels (id, creatorId, provider, externalAccountId, displayName,
          scopes, tokenCiphertext, tokenIv, tokenTag, expiresAt, status, connectedAt)
         VALUES (@id,@creatorId,@provider,@externalAccountId,@displayName,
          @scopes,@tokenCiphertext,@tokenIv,@tokenTag,@expiresAt,@status,@connectedAt)
         ON CONFLICT(id) DO UPDATE SET
          displayName=excluded.displayName, scopes=excluded.scopes,
          tokenCiphertext=excluded.tokenCiphertext, tokenIv=excluded.tokenIv,
          tokenTag=excluded.tokenTag, expiresAt=excluded.expiresAt, status=excluded.status`,
      )
      .run({ ...channel, scopes: j(channel.scopes) });
  }

  getChannel(channelId: string): SocialChannel | null {
    const row = this.db.prepare("SELECT * FROM ce_channels WHERE id = ?").get(channelId) as
      Record<string, unknown> | undefined;
    return row ? this.rowToChannel(row) : null;
  }

  private rowToChannel(row: Record<string, unknown>): SocialChannel {
    return {
      id: row.id as string,
      creatorId: row.creatorId as string,
      provider: row.provider as SocialChannel["provider"],
      externalAccountId: row.externalAccountId as string,
      displayName: row.displayName as string,
      scopes: p(row.scopes as string, []),
      tokenCiphertext: row.tokenCiphertext as string,
      tokenIv: row.tokenIv as string,
      tokenTag: row.tokenTag as string,
      expiresAt: (row.expiresAt as string | null) ?? null,
      status: row.status as SocialChannel["status"],
      connectedAt: row.connectedAt as string,
    };
  }

  listChannels(creatorId: string): SocialChannel[] {
    const rows = this.db
      .prepare("SELECT * FROM ce_channels WHERE creatorId = ?")
      .all(creatorId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToChannel(r));
  }

  updateChannelStatus(channelId: string, status: SocialChannel["status"]): void {
    this.db.prepare("UPDATE ce_channels SET status = ? WHERE id = ?").run(status, channelId);
  }

  insertPublication(pub: ScheduledPublication): void {
    this.db
      .prepare(
        `INSERT INTO ce_publications (id, creatorId, channelId, assetId, scheduledAt,
          status, approvedByCreatorAt, publishedAt, externalRef)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        pub.id,
        pub.creatorId,
        pub.channelId,
        pub.assetId,
        pub.scheduledAt,
        pub.status,
        pub.approvedByCreatorAt,
        pub.publishedAt,
        pub.externalRef,
      );
  }

  updatePublicationStatus(
    id: string,
    status: ScheduledPublication["status"],
    externalRef?: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE ce_publications SET status = ?, externalRef = COALESCE(?, externalRef),
         publishedAt = CASE WHEN ? = 'published' THEN ? ELSE publishedAt END WHERE id = ?`,
      )
      .run(status, externalRef ?? null, status, now(), id);
  }

  listPublications(creatorId: string): ScheduledPublication[] {
    return this.db
      .prepare("SELECT * FROM ce_publications WHERE creatorId = ? ORDER BY scheduledAt DESC")
      .all(creatorId) as ScheduledPublication[];
  }
}

// ============================ In-memory ============================

class InMemoryCreatorEconomyStore implements CreatorEconomyStore {
  readonly mode = "in-memory" as const;
  private profiles = new Map<string, CreatorProfile>();
  private kycs = new Map<string, KycVerificationStatus>();
  private ents = new Map<string, Entitlement>();
  private assets = new Map<string, ContentAsset>();
  private offers = new Map<string, MonetizationOffer>();
  private txs = new Map<string, LedgerTransaction>();
  private idemKeys = new Set<string>();
  private entries: LedgerEntry[] = [];
  private execs: SkillExecution[] = [];
  private payouts = new Map<string, PayoutRequest>();
  private payoutIdem = new Map<string, string>();
  private channels = new Map<string, SocialChannel>();
  private pubs = new Map<string, ScheduledPublication>();

  upsertProfile(profile: CreatorProfile): void {
    this.profiles.set(profile.id, structuredClone(profile));
  }
  getProfile(creatorId: string): CreatorProfile | null {
    const v = this.profiles.get(creatorId);
    return v ? structuredClone(v) : null;
  }
  upsertKyc(kyc: KycVerificationStatus): void {
    this.kycs.set(kyc.creatorId, structuredClone(kyc));
  }
  getKyc(creatorId: string): KycVerificationStatus | null {
    const v = this.kycs.get(creatorId);
    return v ? structuredClone(v) : null;
  }
  upsertEntitlement(ent: Entitlement): void {
    this.ents.set(ent.creatorId, structuredClone(ent));
  }
  getEntitlement(creatorId: string): Entitlement | null {
    const v = this.ents.get(creatorId);
    return v ? structuredClone(v) : null;
  }

  insertAsset(asset: ContentAsset): void {
    this.assets.set(asset.id, structuredClone(asset));
  }
  getAsset(assetId: string): ContentAsset | null {
    const v = this.assets.get(assetId);
    return v ? structuredClone(v) : null;
  }
  updateAssetStatus(
    assetId: string,
    status: ContentAsset["status"],
    approvedByCreatorAt?: string | null,
  ): void {
    const a = this.assets.get(assetId);
    if (!a) return;
    a.status = status;
    if (approvedByCreatorAt) a.approvedByCreatorAt = approvedByCreatorAt;
    a.updatedAt = now();
  }
  listAssets(creatorId: string): ContentAsset[] {
    return [...this.assets.values()]
      .filter((a) => a.creatorId === creatorId)
      .map((a) => structuredClone(a));
  }

  upsertOffer(offer: MonetizationOffer): void {
    this.offers.set(offer.id, structuredClone(offer));
  }
  getOffer(offerId: string): MonetizationOffer | null {
    const v = this.offers.get(offerId);
    return v ? structuredClone(v) : null;
  }
  listOffers(creatorId?: string, status?: MonetizationOffer["status"]): MonetizationOffer[] {
    return [...this.offers.values()]
      .filter((o) => (!creatorId || o.creatorId === creatorId) && (!status || o.status === status))
      .map((o) => structuredClone(o));
  }

  insertTransaction(tx: LedgerTransaction): boolean {
    if (this.idemKeys.has(tx.idempotencyKey)) return false;
    this.idemKeys.add(tx.idempotencyKey);
    this.txs.set(tx.id, structuredClone(tx));
    return true;
  }
  insertEntries(entries: LedgerEntry[]): void {
    this.entries.push(...entries.map((e) => structuredClone(e)));
  }
  getEntriesByTransaction(transactionId: string): LedgerEntry[] {
    return this.entries
      .filter((e) => e.transactionId === transactionId)
      .map((e) => structuredClone(e));
  }
  getAccountBalance(tenantId: string, account: AccountType): number {
    return this.entries
      .filter((e) => e.tenantId === tenantId && e.account === account && e.status === "posted")
      .reduce((acc, e) => acc + (e.direction === "debit" ? e.amountMinor : -e.amountMinor), 0);
  }
  verifyLedgerBalance(transactionId: string): number {
    return this.entries
      .filter((e) => e.transactionId === transactionId)
      .reduce((acc, e) => acc + (e.direction === "debit" ? e.amountMinor : -e.amountMinor), 0);
  }
  listUnbalancedTransactions(limit = 50): string[] {
    const byTx = new Map<string, number>();
    for (const e of this.entries) {
      byTx.set(
        e.transactionId,
        (byTx.get(e.transactionId) ?? 0) +
          (e.direction === "debit" ? e.amountMinor : -e.amountMinor),
      );
    }
    return [...byTx.entries()]
      .filter(([, d]) => d !== 0)
      .slice(0, limit)
      .map(([id]) => id);
  }

  insertSkillExecution(exec: SkillExecution): void {
    this.execs.unshift(structuredClone(exec));
  }
  listSkillExecutions(creatorId: string, limit = 50): SkillExecution[] {
    return this.execs
      .filter((e) => e.creatorId === creatorId)
      .slice(0, limit)
      .map((e) => structuredClone(e));
  }

  insertPayout(payout: PayoutRequest): boolean {
    if (this.payoutIdem.has(payout.idempotencyKey)) return false;
    this.payoutIdem.set(payout.idempotencyKey, payout.id);
    this.payouts.set(payout.id, structuredClone(payout));
    return true;
  }
  getPayoutByIdempotencyKey(key: string): PayoutRequest | null {
    const id = this.payoutIdem.get(key);
    const v = id ? this.payouts.get(id) : undefined;
    return v ? structuredClone(v) : null;
  }
  updatePayoutStatus(
    id: string,
    status: PayoutStatus,
    processedAt?: string | null,
    ref?: string | null,
  ): void {
    const v = this.payouts.get(id);
    if (!v) return;
    v.status = status;
    if (processedAt) v.processedAt = processedAt;
    if (ref) v.disbursementReference = ref;
  }
  listPayouts(creatorId: string): PayoutRequest[] {
    return [...this.payouts.values()]
      .filter((v) => v.creatorId === creatorId)
      .map((v) => structuredClone(v));
  }

  upsertChannel(channel: SocialChannel): void {
    this.channels.set(channel.id, structuredClone(channel));
  }
  getChannel(channelId: string): SocialChannel | null {
    const v = this.channels.get(channelId);
    return v ? structuredClone(v) : null;
  }
  listChannels(creatorId: string): SocialChannel[] {
    return [...this.channels.values()]
      .filter((c) => c.creatorId === creatorId)
      .map((c) => structuredClone(c));
  }
  updateChannelStatus(channelId: string, status: SocialChannel["status"]): void {
    const v = this.channels.get(channelId);
    if (v) v.status = status;
  }

  insertPublication(pub: ScheduledPublication): void {
    this.pubs.set(pub.id, structuredClone(pub));
  }
  updatePublicationStatus(
    id: string,
    status: ScheduledPublication["status"],
    externalRef?: string | null,
  ): void {
    const v = this.pubs.get(id);
    if (!v) return;
    v.status = status;
    if (externalRef) v.externalRef = externalRef;
    if (status === "published") v.publishedAt = now();
  }
  listPublications(creatorId: string): ScheduledPublication[] {
    return [...this.pubs.values()]
      .filter((v) => v.creatorId === creatorId)
      .map((v) => structuredClone(v));
  }
}

// ---------- singleton ----------

let activeStore: CreatorEconomyStore | null = null;

export function getCreatorEconomyStore(): CreatorEconomyStore {
  if (activeStore) return activeStore;
  if (process.env.ISABELLA_PERSISTENCE === "memory") {
    activeStore = new InMemoryCreatorEconomyStore();
    return activeStore;
  }
  try {
    activeStore = new SqliteCreatorEconomyStore();
  } catch {
    activeStore = new InMemoryCreatorEconomyStore();
  }
  return activeStore;
}

/** Test hook: reset the singleton so scenarios can isolate stores. */
export function resetCreatorEconomyStore(): void {
  activeStore = null;
}

export function newId(): string {
  return randomUUID();
}
