/**
 * Isabella — Cryptographic Security Module
 *
 * Autenticación criptográfica de 512 bytes, HMAC-SHA512,
 * generación de API keys, y utilidades de seguridad.
 *
 * Autoría: Edwin Oswaldo Castillo Trejo (Anubis Villaseñor)
 * ORCID: 0009-0008-5050-1539
 * Licencia: CC BY 4.0
 */

import crypto, { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

// ============================================================================
// CONSTANTS
// ============================================================================

const KEY_LENGTH = 512; // bytes
const SALT_LENGTH = 64; // bytes
const IV_LENGTH = 16; // bytes
const TAG_LENGTH = 16; // bytes
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const API_KEY_PREFIX = "isa_";
const API_KEY_LENGTH = 48; // bytes before encoding

// ============================================================================
// RANDOM GENERATION
// ============================================================================

/**
 * Generate cryptographically secure random bytes.
 * Uses crypto.randomBytes which is cryptographically strong.
 */
export function generateSecureRandom(length: number): Buffer {
  return randomBytes(length);
}

/**
 * Generate a random hex string.
 */
export function generateRandomHex(length: number): string {
  return randomBytes(length).toString("hex");
}

/**
 * Generate a random UUID v4 (cryptographically secure).
 */
export function generateSecureUUID(): string {
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 1
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ============================================================================
// 512-BYTE KEY GENERATION
// ============================================================================

/**
 * Generate a 512-byte (4096-bit) cryptographic key.
 * Uses scrypt for key derivation with a random salt.
 */
export function generate512ByteKey(
  passphrase: string,
  salt?: Buffer,
): { key: Buffer; salt: Buffer } {
  const usedSalt = salt ?? randomBytes(SALT_LENGTH);
  const key = scryptSync(passphrase, usedSalt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return { key, salt: usedSalt };
}

/**
 * Derive a 512-byte key from a passphrase with a specific salt.
 */
export function derive512ByteKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
}

/**
 * Create a 512-byte key from raw entropy.
 * Mixes entropy with HKDF-like expansion using HMAC-SHA512.
 */
export function create512ByteKeyFromEntropy(entropy: Buffer): Buffer {
  const key = Buffer.alloc(KEY_LENGTH);
  const blockCount = Math.ceil(KEY_LENGTH / 64); // SHA-512 produces 64 bytes

  for (let i = 0; i < blockCount; i++) {
    const hmac = createHmac("sha512", entropy);
    hmac.update(Buffer.from([i]));
    const block = hmac.digest();
    block.copy(key, i * 64, 0, Math.min(64, KEY_LENGTH - i * 64));
  }

  return key;
}

// ============================================================================
// HMAC & SIGNING
// ============================================================================

/**
 * Create an HMAC-SHA512 signature.
 */
export function createHMAC512(key: Buffer | string, data: string): string {
  return createHmac("sha512", key).update(data, "utf8").digest("hex");
}

/**
 * Verify an HMAC-SHA512 signature using timing-safe comparison.
 */
export function verifyHMAC512(key: Buffer | string, data: string, signature: string): boolean {
  const expected = createHMAC512(key, data);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * Create a SHA-512 hash.
 */
export function sha512(data: string | Buffer): string {
  return createHash("sha512").update(data).digest("hex");
}

/**
 * Create a SHA-256 hash.
 */
export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Create a HMAC-SHA256 signature.
 */
export function createHMAC256(key: Buffer | string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

/**
 * Verify an HMAC-SHA256 signature.
 */
export function verifyHMAC256(key: Buffer | string, data: string, signature: string): boolean {
  const expected = createHMAC256(key, data);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

// ============================================================================
// ENCRYPTION
// ============================================================================

/**
 * AES-256-GCM encryption result.
 */
export interface EncryptionResult {
  ciphertext: string;
  iv: string;
  tag: string;
  salt: string;
}

/**
 * Encrypt data using AES-256-GCM with a 512-byte key.
 * The key is derived using scrypt from a passphrase.
 */
export function encrypt512(passphrase: string, plaintext: string): EncryptionResult {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = derive512ByteKey(passphrase, salt);

  // Use first 32 bytes of the 512-byte key for AES-256
  const aesKey = key.subarray(0, 32);

  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const tag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    salt: salt.toString("hex"),
  };
}

/**
 * Decrypt data using AES-256-GCM with a 512-byte key.
 */
export function decrypt512(passphrase: string, encrypted: EncryptionResult): string {
  const salt = Buffer.from(encrypted.salt, "hex");
  const iv = Buffer.from(encrypted.iv, "hex");
  const tag = Buffer.from(encrypted.tag, "hex");
  const key = derive512ByteKey(passphrase, salt);

  const aesKey = key.subarray(0, 32);

  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(tag);

  let plaintext = decipher.update(encrypted.ciphertext, "hex", "utf8");
  plaintext += decipher.final("utf8");

  return plaintext;
}

// ============================================================================
// PASSWORD HASHING
// ============================================================================

/**
 * Hash a password using scrypt with a random salt.
 */
export function hashPassword(password: string): {
  hash: string;
  salt: string;
} {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(password, salt, 64, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return {
    hash: hash.toString("hex"),
    salt: salt.toString("hex"),
  };
}

/**
 * Verify a password against a stored hash.
 */
export function verifyPassword(password: string, storedHash: string, storedSalt: string): boolean {
  const salt = Buffer.from(storedSalt, "hex");
  const hash = scryptSync(password, salt, 64, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return timingSafeEqual(Buffer.from(storedHash, "hex"), hash);
}

// ============================================================================
// TOKEN GENERATION
// ============================================================================

/**
 * Generate a secure session token.
 */
export function generateSessionToken(): string {
  return randomBytes(48).toString("base64url");
}

/**
 * Generate a secure CSRF token.
 */
export function generateCSRFToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Generate a JWT-like signed token (HMAC-SHA512).
 * NOT a full JWT implementation — simplified for internal use.
 */
export function generateSignedToken(
  payload: Record<string, unknown>,
  secret: Buffer,
  expiresInMs: number = 3600000,
): string {
  const header = { alg: "HS512", typ: "ISABELLA" };
  const now = Date.now();
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInMs,
    jti: generateSecureUUID(),
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signature = createHMAC512(secret, `${headerB64}.${payloadB64}`);

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify and decode a signed token.
 */
export function verifySignedToken(
  token: string,
  secret: Buffer,
): { valid: boolean; payload?: Record<string, unknown> } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false };
  }

  const [headerB64, payloadB64, signature] = parts as [string, string, string];

  if (!verifyHMAC512(secret, `${headerB64}.${payloadB64}`, signature)) {
    return { valid: false };
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

    if (payload.exp && Date.now() > payload.exp) {
      return { valid: false };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const CRYPTO_CONSTANTS = {
  KEY_LENGTH,
  SALT_LENGTH,
  IV_LENGTH,
  TAG_LENGTH,
  SCRYPT_COST,
  SCRYPT_BLOCK_SIZE,
  SCRYPT_PARALLELIZATION,
  API_KEY_PREFIX,
  API_KEY_LENGTH,
} as const;
