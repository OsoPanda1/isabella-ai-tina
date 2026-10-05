/**
 * CAPABILITY TOKENS (src/lib/capability-tokens.ts)
 * -----------------------------------------------------------------
 * Acciones firmadas: un token de capacidad es una aprobación firmada
 * (HMAC-SHA256 con el secreto JWT server-side) ligada a
 * (actor, tenant, tool, traceId) con TTL corto. No es reutilizable
 * entre trazas ni herramientas: el binding se verifica siempre.
 *
 * Uso: la Execution Authority acepta un token válido como prueba de
 * aprobación para la traza indicada (con auditoría del jti).
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { secrets } from "./secrets";

export const CAPABILITY_TTL_MS = 5 * 60 * 1000;
const PREFIX = "isa_cap";

export interface CapabilityClaims {
  jti: string;
  actorId: string;
  tenantId: string;
  tool: string;
  traceId: string;
  issuedAt: number;
  expiresAt: number;
}

function b64urlEncode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function b64urlDecode(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

function macFor(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

/** Emite un token de capacidad firmado. Falla sin secreto configurado. */
export function issueCapabilityToken(input: {
  actorId: string;
  tenantId: string;
  tool: string;
  traceId: string;
  ttlMs?: number;
}): string {
  if (!input.actorId || !input.tenantId || !input.tool || !input.traceId) {
    throw new Error("Capability incompleta: actor, tenant, tool y traceId son obligatorios.");
  }
  const now = Date.now();
  const claims: CapabilityClaims = {
    jti: `cap_${randomUUID().replace(/-/g, "")}`,
    actorId: input.actorId,
    tenantId: input.tenantId,
    tool: input.tool,
    traceId: input.traceId,
    issuedAt: now,
    expiresAt: now + (input.ttlMs ?? CAPABILITY_TTL_MS),
  };
  const payload = b64urlEncode(JSON.stringify(claims));
  const mac = macFor(payload, secrets.get("AUTH_JWT_SECRET")).toString("base64url");
  return `${PREFIX}.${payload}.${mac}`;
}

export interface CapabilityVerification {
  valid: boolean;
  reason: string;
  claims?: CapabilityClaims;
}

/** Verifica firma, binding, expiración y forma. Nunca lanza. */
export function verifyCapabilityToken(
  token: string,
  expected: {
    actorId: string;
    tenantId: string;
    tool: string;
    traceId: string;
  },
  now: number = Date.now(),
): CapabilityVerification {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { valid: false, reason: "Formato inválido." };
  }
  const [, payload, mac] = parts;
  let secret: string;
  try {
    secret = secrets.get("AUTH_JWT_SECRET");
  } catch {
    return { valid: false, reason: "Sin secreto de verificación." };
  }
  let claims: CapabilityClaims;
  try {
    claims = JSON.parse(b64urlDecode(payload)) as CapabilityClaims;
  } catch {
    return { valid: false, reason: "Payload ilegible." };
  }
  const expectedMac = macFor(payload, secret);
  const presented = Buffer.from(mac, "base64url");
  if (presented.length !== expectedMac.length || !timingSafeEqual(presented, expectedMac)) {
    return { valid: false, reason: "Firma inválida." };
  }
  if (
    claims.actorId !== expected.actorId ||
    claims.tenantId !== expected.tenantId ||
    claims.tool !== expected.tool ||
    claims.traceId !== expected.traceId
  ) {
    return {
      valid: false,
      reason: "Binding (actor/tenant/tool/trace) no coincide.",
    };
  }
  if (typeof claims.expiresAt !== "number" || claims.expiresAt <= now) {
    return { valid: false, reason: "Token expirado." };
  }
  if (typeof claims.issuedAt !== "number" || claims.issuedAt > now + 60_000) {
    return { valid: false, reason: "Emisión futura inválida." };
  }
  return { valid: true, reason: "Capability válida.", claims };
}

export const CAPABILITY_TOKENS = {
  issue: issueCapabilityToken,
  verify: verifyCapabilityToken,
  ttlMs: CAPABILITY_TTL_MS,
};
