/**
 * Durable subscription/usage persistence.
 *
 * Production/staging MUST use PostgreSQL. SQLite and in-memory stores are
 * intentionally limited to local development/test environments.
 */
import { Pool } from "pg";
import { nodeRequire } from "../node-require";
import type BetterSqlite3 from "better-sqlite3";
import type { IsabellaPlanId, MeteredCapability, UsageBucket } from "../subscription.server";

type SqliteDatabase = BetterSqlite3.Database;

export interface UsageLimits {
  dailyMessages: number;
  dailyImages: number;
  dailyVoiceSeconds: number;
  maxAgentSessions: number;
}

export interface UsageMutationResult {
  allowed: boolean;
  usage: UsageBucket;
}

export interface SubscriptionStore {
  getBucket(userId: string, dayKey: string): UsageBucket | null;
  saveBucket(bucket: UsageBucket): void;
  getPlan(userId: string): IsabellaPlanId | null;
  savePlan(userId: string, planId: IsabellaPlanId): void;
  tryConsume(
    userId: string,
    dayKey: string,
    capability: MeteredCapability,
    amount: number,
    limits: UsageLimits,
  ): Promise<UsageMutationResult>;
  readonly mode: "postgres" | "sqlite" | "in-memory";
}

const PLANS: readonly IsabellaPlanId[] = ["free", "plus", "premium", "vip", "enterprise", "custom"];
const isPlanId = (value: unknown): value is IsabellaPlanId =>
  typeof value === "string" && (PLANS as readonly string[]).includes(value);

function productionLike(): boolean {
  const mode = String(process.env.ISABELLA_RUNTIME_MODE ?? "")
    .trim()
    .toLowerCase();
  return process.env.NODE_ENV === "production" || mode === "production" || mode === "staging";
}

class InMemorySubscriptionStore implements SubscriptionStore {
  readonly mode = "in-memory" as const;
  private buckets = new Map<string, UsageBucket>();
  private plans = new Map<string, IsabellaPlanId>();

  getBucket(userId: string, dayKey: string): UsageBucket | null {
    return this.buckets.get(`${userId}:${dayKey}`) ?? null;
  }

  saveBucket(bucket: UsageBucket): void {
    this.buckets.set(`${bucket.userId}:${bucket.dayKey}`, { ...bucket });
  }

  getPlan(userId: string): IsabellaPlanId | null {
    return this.plans.get(userId) ?? null;
  }

  savePlan(userId: string, planId: IsabellaPlanId): void {
    this.plans.set(userId, planId);
  }

  async tryConsume(
    userId: string,
    dayKey: string,
    capability: MeteredCapability,
    amount: number,
    limits: UsageLimits,
  ): Promise<UsageMutationResult> {
    const current =
      this.getBucket(userId, dayKey) ??
      ({
        userId,
        dayKey,
        messages: 0,
        images: 0,
        voiceSeconds: 0,
        agentSessions: 0,
        updatedAt: new Date().toISOString(),
      } satisfies UsageBucket);
    const next = { ...current };
    const requested = Math.max(1, Math.ceil(amount));
    if (capability === "chat" || capability === "tool") next.messages += requested;
    if (capability === "image") next.images += requested;
    if (capability === "voice") next.voiceSeconds += requested;
    if (capability === "agent") next.agentSessions += requested;
    const allowed =
      next.messages <= limits.dailyMessages &&
      next.images <= limits.dailyImages &&
      next.voiceSeconds <= limits.dailyVoiceSeconds &&
      next.agentSessions <= limits.maxAgentSessions;
    if (allowed) {
      next.updatedAt = new Date().toISOString();
      this.saveBucket(next);
    }
    return { allowed, usage: allowed ? next : current };
  }
}

class PostgresSubscriptionStore implements SubscriptionStore {
  readonly mode = "postgres" as const;
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    if (!databaseUrl) throw new Error("DATABASE_URL required for production quota persistence");
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      idleTimeoutMillis: 30_000,
    });
    this.pool.on("error", (error) =>
      console.error("[subscription-store] postgres pool error", error),
    );
  }

  private async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_usage (
        user_id TEXT NOT NULL,
        day_key TEXT NOT NULL,
        messages BIGINT NOT NULL DEFAULT 0,
        images BIGINT NOT NULL DEFAULT 0,
        voice_seconds BIGINT NOT NULL DEFAULT 0,
        agent_sessions BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, day_key)
      );
      CREATE TABLE IF NOT EXISTS subscription_plans (
        user_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL DEFAULT 'free',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  getBucket(_userId: string, _dayKey: string): UsageBucket {
    throw new Error(
      "getBucket on postgres requires async access; use subscription server async path",
    );
  }

  saveBucket(_bucket: UsageBucket): void {
    throw new Error("saveBucket on postgres is async-only; use tryConsume");
  }

  getPlan(_userId: string): IsabellaPlanId | null {
    throw new Error(
      "getPlan on postgres requires async access; use subscription server async path",
    );
  }

  savePlan(_userId: string, _planId: IsabellaPlanId): void {
    throw new Error("savePlan on postgres is async-only");
  }

  async getBucketAsync(userId: string, dayKey: string): Promise<UsageBucket | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query(
      `SELECT user_id, day_key, messages, images, voice_seconds, agent_sessions, updated_at
       FROM subscription_usage WHERE user_id=$1 AND day_key=$2`,
      [userId, dayKey],
    );
    const row = rows[0];
    return row
      ? {
          userId: String(row.user_id),
          dayKey: String(row.day_key),
          messages: Number(row.messages),
          images: Number(row.images),
          voiceSeconds: Number(row.voice_seconds),
          agentSessions: Number(row.agent_sessions),
          updatedAt: new Date(row.updated_at).toISOString(),
        }
      : null;
  }

  async getPlanAsync(userId: string): Promise<IsabellaPlanId | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query(
      "SELECT plan_id FROM subscription_plans WHERE user_id=$1",
      [userId],
    );
    const plan = rows[0]?.plan_id;
    return isPlanId(plan) ? plan : null;
  }

  async savePlanAsync(userId: string, planId: IsabellaPlanId): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO subscription_plans(user_id,plan_id,updated_at) VALUES($1,$2,NOW())
       ON CONFLICT(user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,updated_at=NOW()`,
      [userId, planId],
    );
  }

  async tryConsume(
    userId: string,
    dayKey: string,
    capability: MeteredCapability,
    amount: number,
    limits: UsageLimits,
  ): Promise<UsageMutationResult> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    const requested = Math.max(1, Math.ceil(amount));
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO subscription_usage(user_id,day_key) VALUES($1,$2)
         ON CONFLICT(user_id,day_key) DO NOTHING`,
        [userId, dayKey],
      );
      const { rows } = await client.query(
        `SELECT user_id,day_key,messages,images,voice_seconds,agent_sessions,updated_at
         FROM subscription_usage WHERE user_id=$1 AND day_key=$2 FOR UPDATE`,
        [userId, dayKey],
      );
      const row = rows[0];
      if (!row) throw new Error("subscription_usage row unavailable");
      const current: UsageBucket = {
        userId: String(row.user_id),
        dayKey: String(row.day_key),
        messages: Number(row.messages),
        images: Number(row.images),
        voiceSeconds: Number(row.voice_seconds),
        agentSessions: Number(row.agent_sessions),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
      const next = { ...current };
      if (capability === "chat" || capability === "tool") next.messages += requested;
      if (capability === "image") next.images += requested;
      if (capability === "voice") next.voiceSeconds += requested;
      if (capability === "agent") next.agentSessions += requested;
      const allowed =
        next.messages <= limits.dailyMessages &&
        next.images <= limits.dailyImages &&
        next.voiceSeconds <= limits.dailyVoiceSeconds &&
        next.agentSessions <= limits.maxAgentSessions;
      if (!allowed) {
        await client.query("COMMIT");
        return { allowed: false, usage: current };
      }
      next.updatedAt = new Date().toISOString();
      await client.query(
        `UPDATE subscription_usage
         SET messages=$3,images=$4,voice_seconds=$5,agent_sessions=$6,updated_at=NOW()
         WHERE user_id=$1 AND day_key=$2`,
        [userId, dayKey, next.messages, next.images, next.voiceSeconds, next.agentSessions],
      );
      await client.query("COMMIT");
      return { allowed: true, usage: next };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

class SqliteSubscriptionStore implements SubscriptionStore {
  readonly mode = "sqlite" as const;
  private db: SqliteDatabase;

  constructor(dbPath?: string) {
    const BetterSqlite3Ctor = nodeRequire("better-sqlite3") as new (
      filename: string,
    ) => SqliteDatabase;
    this.db = new BetterSqlite3Ctor(dbPath || process.env.ISABELLA_DB_PATH || "./data/isabella.db");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscription_usage (
        userId TEXT NOT NULL,
        dayKey TEXT NOT NULL,
        messages INTEGER NOT NULL DEFAULT 0,
        images INTEGER NOT NULL DEFAULT 0,
        voiceSeconds INTEGER NOT NULL DEFAULT 0,
        agentSessions INTEGER NOT NULL DEFAULT 0,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (userId, dayKey)
      );
      CREATE TABLE IF NOT EXISTS subscription_plans (
        userId TEXT PRIMARY KEY,
        planId TEXT NOT NULL DEFAULT 'free',
        updatedAt TEXT NOT NULL
      );
    `);
  }

  getBucket(userId: string, dayKey: string): UsageBucket | null {
    const row = this.db
      .prepare(
        "SELECT userId, dayKey, messages, images, voiceSeconds, agentSessions, updatedAt FROM subscription_usage WHERE userId = ? AND dayKey = ?",
      )
      .get(userId, dayKey) as UsageBucket | undefined;
    return row ? { ...row } : null;
  }

  saveBucket(bucket: UsageBucket): void {
    this.db
      .prepare(
        `INSERT INTO subscription_usage (userId, dayKey, messages, images, voiceSeconds, agentSessions, updatedAt)
       VALUES (@userId, @dayKey, @messages, @images, @voiceSeconds, @agentSessions, @updatedAt)
       ON CONFLICT (userId, dayKey) DO UPDATE SET
         messages=excluded.messages, images=excluded.images, voiceSeconds=excluded.voiceSeconds,
         agentSessions=excluded.agentSessions, updatedAt=excluded.updatedAt`,
      )
      .run(bucket);
  }

  getPlan(userId: string): IsabellaPlanId | null {
    const row = this.db
      .prepare("SELECT planId FROM subscription_plans WHERE userId = ?")
      .get(userId) as { planId: string } | undefined;
    return row && isPlanId(row.planId) ? row.planId : null;
  }

  savePlan(userId: string, planId: IsabellaPlanId): void {
    this.db
      .prepare(
        `INSERT INTO subscription_plans (userId, planId, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT (userId) DO UPDATE SET planId=excluded.planId, updatedAt=excluded.updatedAt`,
      )
      .run(userId, planId, new Date().toISOString());
  }

  async tryConsume(
    userId: string,
    dayKey: string,
    capability: MeteredCapability,
    amount: number,
    limits: UsageLimits,
  ): Promise<UsageMutationResult> {
    const current = this.getBucket(userId, dayKey) ?? {
      userId,
      dayKey,
      messages: 0,
      images: 0,
      voiceSeconds: 0,
      agentSessions: 0,
      updatedAt: new Date().toISOString(),
    };
    const requested = Math.max(1, Math.ceil(amount));
    const next = { ...current };
    if (capability === "chat" || capability === "tool") next.messages += requested;
    if (capability === "image") next.images += requested;
    if (capability === "voice") next.voiceSeconds += requested;
    if (capability === "agent") next.agentSessions += requested;
    const allowed =
      next.messages <= limits.dailyMessages &&
      next.images <= limits.dailyImages &&
      next.voiceSeconds <= limits.dailyVoiceSeconds &&
      next.agentSessions <= limits.maxAgentSessions;
    if (allowed) {
      next.updatedAt = new Date().toISOString();
      this.saveBucket(next);
    }
    return { allowed, usage: allowed ? next : current };
  }
}

let activeStore: SubscriptionStore | null = null;

export function getSubscriptionStore(): SubscriptionStore {
  if (activeStore) return activeStore;
  if (productionLike()) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("subscription_store_unavailable: DATABASE_URL required");
    activeStore = new PostgresSubscriptionStore(databaseUrl);
    return activeStore;
  }
  if (process.env.ISABELLA_PERSISTENCE === "memory") {
    activeStore = new InMemorySubscriptionStore();
    return activeStore;
  }
  try {
    activeStore = new SqliteSubscriptionStore();
  } catch {
    activeStore = new InMemorySubscriptionStore();
  }
  return activeStore;
}

export async function getSubscriptionBucket(
  userId: string,
  dayKey: string,
): Promise<UsageBucket | null> {
  const store = getSubscriptionStore();
  if (store.mode === "postgres")
    return (store as PostgresSubscriptionStore).getBucketAsync(userId, dayKey);
  return store.getBucket(userId, dayKey);
}

export async function getSubscriptionPlan(userId: string): Promise<IsabellaPlanId | null> {
  const store = getSubscriptionStore();
  if (store.mode === "postgres") return (store as PostgresSubscriptionStore).getPlanAsync(userId);
  return store.getPlan(userId);
}

export async function saveSubscriptionPlan(userId: string, planId: IsabellaPlanId): Promise<void> {
  const store = getSubscriptionStore();
  if (store.mode === "postgres")
    return (store as PostgresSubscriptionStore).savePlanAsync(userId, planId);
  store.savePlan(userId, planId);
}

export function resetSubscriptionStore(): void {
  activeStore = null;
}
