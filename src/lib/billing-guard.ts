/**
 * BILLING GUARD (src/lib/billing-guard.ts)
 * -----------------------------------------------------------------
 * Punto único de autorización de operaciones económicas para los
 * handlers de `/api/billing`.
 *
 * Cierra el blocker de release "wire dedicated billing scopes and
 * step-up authentication into the legacy billing handlers":
 *   - Deriva los scopes efectivos del principal (los roles soberanos
 *     reciben los scopes de billing por diseño de mínimo privilegio
 *     explícito, nunca por confiar en el cliente).
 *   - Exige step-up firmado (HMAC-SHA256, ligado a tenant/usuario/
 *     operación, TTL corto y no reutilizable fuera de su binding)
 *     para operaciones privilegiadas: refund y topup.
 *
 * El token de step-up se emite con `issueBillingStepUp` y se valida
 * con `verifyBillingStepUp`; ambas funciones son puras respecto a la
 * red y por tanto verificables por pruebas unitarias.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "./rbac";
import {
  hasBillingAuthorization,
  requiredBillingScope,
  type BillingOperation,
} from "./billing-authorization";
import { secrets } from "./secrets";

const PRIVILEGED_ROLES: ReadonlySet<Role> = new Set<Role>(["SovereignOwner", "governance_admin"]);

const ALL_BILLING_SCOPES: readonly string[] = [
  "billing:checkout",
  "billing:topup",
  "billing:refund",
  "billing:authorize-run",
  "marketplace:publish",
  "marketplace:purchase",
];

export const BILLING_STEP_UP_HEADER = "x-billing-step-up";
const STEP_UP_PREFIX = "bst1";
const STEP_UP_DEFAULT_TTL_MS = 300_000;
const STEP_UP_MAX_TTL_MS = 900_000;
const STEP_UP_FUTURE_SKEW_MS = 30_000;

type AuthorizationResult = { ok: true } | { ok: false; reason: string };

function stepUpMac(payload: string): string {
  return createHmac("sha256", secrets.get("AUTH_JWT_SECRET"))
    .update(payload, "utf8")
    .digest("base64url");
}

function stepUpPayload(input: {
  tenantId: string;
  userId: string;
  operation: BillingOperation;
  expiresAt: number;
}): string {
  return `${input.tenantId}:${input.userId}:${input.operation}:${input.expiresAt}`;
}

/**
 * Scopes efectivos: los roles soberanos reciben los scopes de billing
 * explícitos; cualquier otro rol solo dispone de los scopes firmados en
 * su token. Nunca se concede nada por inferencia del cliente.
 */
export function deriveBillingScopes(role: Role, scope: string): string[] {
  const scopes = scope.split(/\s+/).filter(Boolean);
  if (!PRIVILEGED_ROLES.has(role)) return scopes;
  for (const required of ALL_BILLING_SCOPES) {
    if (!scopes.includes(required)) scopes.push(required);
  }
  return scopes;
}

/** Emite un token de step-up firmado y ligado a la operación concreta. */
export function issueBillingStepUp(input: {
  tenantId: string;
  userId: string;
  operation: BillingOperation;
  now?: number;
  ttlMs?: number;
}): string {
  const now = input.now ?? Date.now();
  const ttl = Math.min(Math.max(input.ttlMs ?? STEP_UP_DEFAULT_TTL_MS, 1_000), STEP_UP_MAX_TTL_MS);
  const expiresAt = now + ttl;
  const payload = stepUpPayload({
    tenantId: input.tenantId,
    userId: input.userId,
    operation: input.operation,
    expiresAt,
  });
  return `${STEP_UP_PREFIX}.${expiresAt}.${stepUpMac(payload)}`;
}

/** Verifica firma, binding y ventana temporal. Nunca lanza. */
export function verifyBillingStepUp(
  token: string | null | undefined,
  expected: { tenantId: string; userId: string; operation: BillingOperation },
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== STEP_UP_PREFIX) return false;
  const expiresAt = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt <= now || expiresAt > now + STEP_UP_MAX_TTL_MS + STEP_UP_FUTURE_SKEW_MS)
    return false;
  const payload = stepUpPayload({ ...expected, expiresAt });
  const presented = Buffer.from(parts[2], "base64url");
  const computed = Buffer.from(stepUpMac(payload), "base64url");
  return presented.length === computed.length && timingSafeEqual(presented, computed);
}

/**
 * Decide si el principal puede ejecutar la operación económica.
 * Devuelve un motivo estable (no filtra detalles sensibles) cuando deniega.
 */
export function authorizeBillingOperation(input: {
  operation: BillingOperation;
  tenantId: string;
  userId: string;
  role: Role;
  scope: string;
  stepUpToken?: string | null;
  now?: number;
}): AuthorizationResult {
  const scopes = deriveBillingScopes(input.role, input.scope);
  const needsStepUp = input.operation === "refund" || input.operation === "topup";
  const stepUpVerified = needsStepUp
    ? verifyBillingStepUp(
        input.stepUpToken,
        { tenantId: input.tenantId, userId: input.userId, operation: input.operation },
        input.now,
      )
    : undefined;

  const allowed = hasBillingAuthorization({
    operation: input.operation,
    role: input.role,
    scopes,
    stepUpVerified,
  });

  if (allowed) return { ok: true };
  if (!scopes.includes(requiredBillingScope(input.operation))) {
    return { ok: false, reason: "BILLING_SCOPE_REQUIRED" };
  }
  if (needsStepUp && !stepUpVerified) return { ok: false, reason: "STEP_UP_REQUIRED" };
  return { ok: false, reason: "BILLING_FORBIDDEN" };
}

/** Hash estable del request para la idempotencia durable de checkout. */
export function billingRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
