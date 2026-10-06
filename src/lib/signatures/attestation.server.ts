/**
 * Atestaciones Isabella — verificación de firmas RSA-2048 (src/lib/signatures/attestation.server.ts)
 * ----------------------------------------------------------------------------------------
 * Contrato criptográfico:
 *   algoritmo : RSA-2048
 *   hash      : SHA-256
 *   padding   : PKCS#1 v1.5
 *   encoding  : firma en base64, payload en UTF-8 sin transformar
 *
 * Por qué existe este módulo:
 *   Una firma por sí sola no prueba nada. Verificar requiere TRES piezas:
 *     1) la firma (base64, en el entorno),
 *     2) la clave pública (PEM SPKI, en disco local),
 *     3) los bytes exactos que fueron firmados (payload, en disco local).
 *   Sin (2) o (3) la ranura queda NO VERIFICADA. La ausencia de evidencia nunca
 *   se convierte en PASS (AGENTS.md §19).
 *
 * Seguridad:
 *   - Fail-closed: cualquier ranura no verificada hace `verified = false`.
 *   - La clave privada jamás se lee aquí; solo se usa para firmar desde
 *     `scripts/attestation-keygen.mjs`.
 *   - Los valores del entorno se leen únicamente vía `config()`.
 *   - Los reportes solo exponen huellas SHA-256, nunca la firma ni el payload.
 */
import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { config } from "../config";

export type AttestationStatus =
  | "VERIFIED"
  | "NOT_CONFIGURED"
  | "MISSING_SIGNATURE"
  | "MISSING_PUBLIC_KEY"
  | "MISSING_PAYLOAD"
  | "INVALID_PUBLIC_KEY"
  | "SIGNATURE_MISMATCH";

export interface AttestationSlotReport {
  slot: number;
  status: AttestationStatus;
  detail: string;
  signatureFingerprint: string | null;
  publicKeyFingerprint: string | null;
}

export interface AttestationReport {
  /** true solo cuando TODAS las ranuras configuradas están VERIFIED. */
  verified: boolean;
  /** Ranuras con evidencia presente (firma y/o material en disco). */
  configured: number;
  total: number;
  verifiedCount: number;
  slots: AttestationSlotReport[];
}

export const ATTESTATION_SLOTS = [1, 2, 3] as const;
export type AttestationSlot = (typeof ATTESTATION_SLOTS)[number];

export const ATTESTATION_ALGORITHM = {
  keyType: "RSA",
  modulusBits: 2048,
  hash: "sha256",
  scheme: "PKCS1-v1_5",
} as const;

function sha256Fingerprint(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function resolveAttestationDir(dir: string | undefined): string {
  const raw = dir?.trim() || "secrets/attestations";
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function readPayloadBytes(path: string): Buffer | null {
  if (!existsSync(path)) return null;
  // Se leen los bytes crudos: BOM, EOL o trailing newline alterarían el digest.
  return readFileSync(path);
}

function loadPublicKey(path: string): { key: KeyObject } | { error: string } {
  if (!existsSync(path)) return { error: "MISSING_PUBLIC_KEY" };
  try {
    const pem = readFileSync(path, "utf8");
    return { key: createPublicKey(pem) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `INVALID_PUBLIC_KEY: ${message}` };
  }
}

function decodeSignature(raw: string): { ok: true; value: Buffer } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "MISSING_SIGNATURE" };
  const normalized = trimmed.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return { ok: false, error: "MISSING_SIGNATURE: no es base64 válido" };
  }
  const padding = (4 - (normalized.length % 4)) % 4;
  try {
    return { ok: true, value: Buffer.from(normalized + "=".repeat(padding), "base64") };
  } catch {
    return { ok: false, error: "MISSING_SIGNATURE: decodificación base64 fallida" };
  }
}

function signatureForSlot(slot: number): string | undefined {
  const cfg = config();
  const key = `ISABELLA_ATTESTATION_${slot}_SIGNATURE` as keyof typeof cfg;
  const value = cfg[key];
  return typeof value === "string" ? value : undefined;
}

function verifySignatureSafely(payload: Buffer, key: KeyObject, signature: Buffer): boolean {
  try {
    return cryptoVerify("sha256", payload, key, signature);
  } catch {
    // Formato de clave/firma incompatible: se trata como no verificado.
    return false;
  }
}

/**
 * Verifica una ranura de atestación. Nunca lanza: siempre devuelve un estado.
 */
export function verifyAttestationSlot(
  slot: number,
  options: { dir?: string; signature?: string } = {},
): AttestationSlotReport {
  const dir = resolveAttestationDir(options.dir ?? config().ISABELLA_ATTESTATION_DIR);
  const signatureRaw = options.signature ?? signatureForSlot(slot);

  const publicKeyPath = join(dir, `${slot}.pub.pem`);
  const payloadPath = join(dir, `${slot}.payload.txt`);
  const payload = readPayloadBytes(payloadPath);

  if (!signatureRaw?.trim() && !existsSync(publicKeyPath) && payload === null) {
    return {
      slot,
      status: "NOT_CONFIGURED",
      detail: `Ranura ${slot} sin firma, sin clave pública ni payload.`,
      signatureFingerprint: null,
      publicKeyFingerprint: null,
    };
  }

  const publicKey = loadPublicKey(publicKeyPath);
  const signature = decodeSignature(signatureRaw ?? "");

  const signatureFingerprint = signature.ok ? sha256Fingerprint(signature.value) : null;
  const publicKeyFingerprint =
    "key" in publicKey
      ? sha256Fingerprint(Buffer.from(publicKey.key.export({ type: "spki", format: "der" })))
      : null;

  const base = { slot, signatureFingerprint, publicKeyFingerprint };

  if (!signature.ok) {
    return { ...base, status: "MISSING_SIGNATURE", detail: `Ranura ${slot}: ${signature.error}.` };
  }
  if ("error" in publicKey) {
    const status: AttestationStatus = publicKey.error.startsWith("MISSING_PUBLIC_KEY")
      ? "MISSING_PUBLIC_KEY"
      : "INVALID_PUBLIC_KEY";
    return { ...base, status, detail: `Ranura ${slot}: ${publicKey.error}.` };
  }
  if (payload === null) {
    return {
      ...base,
      status: "MISSING_PAYLOAD",
      detail: `Ranura ${slot}: falta ${slot}.payload.txt (los bytes firmados son irrecuperables sin él).`,
    };
  }

  if (!verifySignatureSafely(payload, publicKey.key, signature.value)) {
    return {
      ...base,
      status: "SIGNATURE_MISMATCH",
      detail: `Ranura ${slot}: la firma RSA-2048/SHA-256/PKCS#1 no corresponde a los bytes firmados o la clave pública es otra.`,
    };
  }

  return {
    ...base,
    status: "VERIFIED",
    detail: `Ranura ${slot}: firma RSA-2048/SHA-256/PKCS#1 v1.5 verificada.`,
  };
}

export interface AttestationVerificationOptions {
  /** Directorio con `<slot>.pub.pem` y `<slot>.payload.txt`. Por defecto el de config(). */
  dir?: string;
  /** Sustituye la firma de una ranura (las omitidas se leen de config()). */
  signatures?: Partial<Record<number, string>>;
}

/**
 * Reporte completo de las tres ranuras. Fail-closed.
 */
export function verifyIsabellaAttestations(
  options: AttestationVerificationOptions = {},
): AttestationReport {
  const slots = ATTESTATION_SLOTS.map((slot) =>
    verifyAttestationSlot(slot, { dir: options.dir, signature: options.signatures?.[slot] }),
  );
  const configured = slots.filter((s) => s.status !== "NOT_CONFIGURED").length;
  const verifiedCount = slots.filter((s) => s.status === "VERIFIED").length;
  return {
    // Sin al menos una ranura configurada no hay evidencia que contar.
    verified: configured > 0 && verifiedCount === configured,
    configured,
    total: slots.length,
    verifiedCount,
    slots,
  };
}

/**
 * Falla de forma explícita si las atestaciones no están todas verificadas.
 * Pensado para gates: no existe ruta de "allow local" (AGENTS.md §4.2).
 */
export function assertIsabellaAttestationsVerified(): AttestationReport {
  const report = verifyIsabellaAttestations();
  if (!report.verified) {
    const pending = report.slots
      .filter((s) => s.status !== "VERIFIED")
      .map((s) => `ranura ${s.slot}=${s.status}`)
      .join(", ");
    throw new Error(
      `ATTESTATION_NOT_VERIFIED: ${report.verifiedCount}/${report.configured} verificadas (${pending || "sin evidencia"}).`,
    );
  }
  return report;
}

/** Render plano, apto para logs y evidencia (sin secretos). */
export function describeAttestationReport(report: AttestationReport): string {
  const head = `attestations ${report.verifiedCount}/${report.configured} verified (slots=${report.total})`;
  return [head, ...report.slots.map((s) => `  ranura ${s.slot}: ${s.status} — ${s.detail}`)].join(
    "\n",
  );
}
