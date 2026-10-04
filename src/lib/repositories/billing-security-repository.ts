import { Pool } from "pg";
import { createHash } from "node:crypto";
import { config } from "../config";

let pool: Pool | null = null;
let poolUrl = "";

function getPool(): Pool {
  const url = config().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for billing security persistence.");
  if (!pool || poolUrl !== url) {
    if (pool) void pool.end().catch(() => undefined);
    pool = new Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
    });
    poolUrl = url;
  }
  return pool;
}

export function hashCapability(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function registerPaymentIntentBinding(input: {
  stripePaymentIntentId: string;
  tenantId: string;
  userId: string;
  amountMinor: number;
  currency: string;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO billing_payment_intents
      (stripe_payment_intent_id, tenant_id, user_id, purpose, currency, amount_minor)
     VALUES ($1,$2,$3,'quota_topup',$4,$5)
     ON CONFLICT (stripe_payment_intent_id) DO UPDATE
       SET tenant_id = EXCLUDED.tenant_id,
           user_id = EXCLUDED.user_id,
           currency = EXCLUDED.currency,
           amount_minor = EXCLUDED.amount_minor
     WHERE billing_payment_intents.consumed_at IS NULL`,
    [
      input.stripePaymentIntentId,
      input.tenantId,
      input.userId,
      input.currency.toLowerCase(),
      input.amountMinor,
    ],
  );
}

export async function getPaymentIntentBinding(stripePaymentIntentId: string) {
  const { rows } = await getPool().query(
    `SELECT stripe_payment_intent_id, tenant_id, user_id, purpose, currency, amount_minor, consumed_at
       FROM billing_payment_intents WHERE stripe_payment_intent_id = $1 LIMIT 1`,
    [stripePaymentIntentId],
  );
  return rows[0] ?? null;
}

export async function consumePaymentIntentBinding(
  stripePaymentIntentId: string,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE billing_payment_intents
        SET consumed_at = NOW()
      WHERE stripe_payment_intent_id = $1
        AND tenant_id = $2
        AND user_id = $3
        AND consumed_at IS NULL`,
    [stripePaymentIntentId, tenantId, userId],
  );
  return rowCount === 1;
}

export async function reserveCheckoutIdempotency(input: {
  tenantId: string;
  userId: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
}): Promise<{ created: boolean; sessionId: string | null; checkoutUrl: string | null }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO billing_checkout_idempotency
        (tenant_id,user_id,operation,idempotency_key,request_hash)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id,operation,idempotency_key) DO NOTHING
       RETURNING stripe_session_id, checkout_url`,
      [input.tenantId, input.userId, input.operation, input.idempotencyKey, input.requestHash],
    );
    if (inserted.rows[0]) {
      await client.query("COMMIT");
      return { created: true, sessionId: null, checkoutUrl: null };
    }
    const existing = await client.query(
      `SELECT stripe_session_id, checkout_url, request_hash
         FROM billing_checkout_idempotency
        WHERE tenant_id=$1 AND operation=$2 AND idempotency_key=$3
        FOR UPDATE`,
      [input.tenantId, input.operation, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.request_hash !== input.requestHash) {
      await client.query("ROLLBACK");
      throw new Error("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");
    }
    await client.query("COMMIT");
    return {
      created: false,
      sessionId: row.stripe_session_id ?? null,
      checkoutUrl: row.checkout_url ?? null,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function completeCheckoutIdempotency(input: {
  tenantId: string;
  operation: string;
  idempotencyKey: string;
  sessionId: string;
  checkoutUrl: string;
}): Promise<void> {
  await getPool().query(
    `UPDATE billing_checkout_idempotency
        SET stripe_session_id=$1, checkout_url=$2
      WHERE tenant_id=$3 AND operation=$4 AND idempotency_key=$5`,
    [input.sessionId, input.checkoutUrl, input.tenantId, input.operation, input.idempotencyKey],
  );
}

/**
 * Libera una reserva de checkout que nunca llegó a completarse (fallo de
 * Stripe, timeout). Solo elimina la fila si aún no tiene sesión asociada,
 * para no borrar una creación exitosa que un reintento debe recibir.
 */
export async function releaseCheckoutIdempotency(input: {
  tenantId: string;
  operation: string;
  idempotencyKey: string;
}): Promise<void> {
  await getPool().query(
    `DELETE FROM billing_checkout_idempotency
      WHERE tenant_id=$1 AND operation=$2 AND idempotency_key=$3
        AND stripe_session_id IS NULL`,
    [input.tenantId, input.operation, input.idempotencyKey],
  );
}

export async function issueRunAuthorization(input: {
  tenantId: string;
  userId: string;
  skillId: string;
  estimatedCostMinor: number;
  ttlSeconds: number;
  tokenHash: string;
}): Promise<{ authorizationId: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
  const { rows } = await getPool().query(
    `INSERT INTO billing_run_authorizations
      (capability_hash,tenant_id,user_id,skill_id,estimated_cost_minor,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, expires_at`,
    [
      input.tokenHash,
      input.tenantId,
      input.userId,
      input.skillId,
      input.estimatedCostMinor,
      expiresAt,
    ],
  );
  return {
    authorizationId: String(rows[0].id),
    expiresAt: new Date(rows[0].expires_at).toISOString(),
  };
}

export async function consumeRunAuthorization(input: {
  tokenHash: string;
  tenantId: string;
  userId: string;
  skillId: string;
  estimatedCostMinor: number;
}): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE billing_run_authorizations
        SET consumed_at=NOW()
      WHERE capability_hash=$1 AND tenant_id=$2 AND user_id=$3 AND skill_id=$4
        AND estimated_cost_minor >= $5 AND expires_at > NOW() AND consumed_at IS NULL`,
    [input.tokenHash, input.tenantId, input.userId, input.skillId, input.estimatedCostMinor],
  );
  return rowCount === 1;
}
