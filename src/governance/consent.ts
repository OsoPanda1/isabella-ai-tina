/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — CONSENT MANAGEMENT (Module 9)
 * Explicit consent for data, money, identity, and file operations.
 * No implicit learning or persistence without user authorization.
 * ================================================================
 */

export type ConsentScope =
  "data" | "money" | "identity" | "files" | "memory" | "automation" | "all";

export interface ConsentRecord {
  readonly consentId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly scope: ConsentScope;
  readonly purpose: string;
  readonly granted: boolean;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
  readonly createdAt: string;
}

export interface ConsentDecision {
  readonly granted: boolean;
  readonly requiresExplicitConsent: boolean;
  readonly reason?: string;
  readonly scope?: ConsentScope;
}

/* =========================================================================
   CONSENT STORE
   ========================================================================= */

const consents = new Map<string, ConsentRecord[]>();

function consentKey(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

export function grantConsent(params: {
  tenantId: string;
  userId: string;
  scope: ConsentScope;
  purpose: string;
  expiresAt?: string;
}): ConsentRecord {
  const record: ConsentRecord = {
    consentId: `consent-${crypto.randomUUID()}`,
    tenantId: params.tenantId,
    userId: params.userId,
    scope: params.scope,
    purpose: params.purpose,
    granted: true,
    expiresAt: params.expiresAt,
    createdAt: new Date().toISOString(),
  };

  const key = consentKey(params.tenantId, params.userId);
  const existing = consents.get(key) || [];
  existing.push(record);
  consents.set(key, existing);
  return record;
}

export function revokeConsent(tenantId: string, userId: string, consentId: string): boolean {
  const key = consentKey(tenantId, userId);
  const records = consents.get(key);
  if (!records) return false;
  const record = records.find((r) => r.consentId === consentId);
  if (!record || !record.granted) return false;
  (record as { granted: boolean }).granted = false;
  (record as { revokedAt: string }).revokedAt = new Date().toISOString();
  return true;
}

export function hasActiveConsent(tenantId: string, userId: string, scope: ConsentScope): boolean {
  const key = consentKey(tenantId, userId);
  const records = consents.get(key) || [];
  const now = new Date().toISOString();
  return records.some(
    (r) =>
      r.granted &&
      (r.scope === scope || r.scope === "all") &&
      (!r.expiresAt || r.expiresAt > now) &&
      !r.revokedAt,
  );
}

export function listConsents(tenantId: string, userId: string): ConsentRecord[] {
  return consents.get(consentKey(tenantId, userId)) || [];
}

/* =========================================================================
   CONSENT CHECK (called by orchestrator)
   ========================================================================= */

const SCOPE_REQUIRED_FOR_RISK: Record<string, ConsentScope | null> = {
  low: null,
  medium: "data",
  high: "all",
};

new Set(["cli"]);

export function checkConsent(
  _input: string,
  classification: { level: string; scopes: ConsentScope[] },
  _capabilities: string[],
): ConsentDecision {
  const requiredScope = SCOPE_REQUIRED_FOR_RISK[classification.level];

  if (!requiredScope) {
    return { granted: true, requiresExplicitConsent: false };
  }

  if (classification.level === "high") {
    return {
      granted: false,
      requiresExplicitConsent: true,
      reason: "Esta acción requiere consentimiento explícito del usuario (riesgo alto).",
      scope: "all",
    };
  }

  return {
    granted: false,
    requiresExplicitConsent: true,
    reason: `Acción requiere consentimiento para el ámbito: ${requiredScope}.`,
    scope: requiredScope,
  };
}
