import * as crypto from "node:crypto";
import { secrets } from "./secrets";

/**
 * SERVICIO CRIPTOGRÁFICO DE API KEYS Y HARDENING (7-Capas)
 * Arquitectura:
 * 1. Gateway Entropy (RandomBytes)
 * 2. Identity Prefixing (Prefix)
 * 3. Sovereign Salting (Per-key unique salt)
 * 4. High-Cost KDF (PBKDF2 simulado en crypto)
 * 5. Env-bound Master Key HMAC (Server-side constraint)
 * 6. Constant-Time Verification (Timing-attack resilience)
 * 7. Key Rotation Readiness (Format versioning)
 */
export class ApiKeyCrypto {
  private static readonly ITERATIONS = 100000;
  private static readonly KEYLEN = 64;
  private static readonly DIGEST = "sha512";
  private static readonly FORMAT_VERSION = "v7"; // 7-Layer Format

  /**
   * Genera un prefijo corto para búsquedas e identificación de llave.
   */
  public static generatePrefix(): string {
    return crypto.randomBytes(6).toString("hex");
  }

  /**
   * Genera un secreto aleatorio de alta entropía.
   */
  public static generateSecret(): string {
    return crypto.randomBytes(48).toString("base64url");
  }

  /**
   * Calcula un hash criptográfico de 7 capas sobre un secreto en claro.
   */
  public static hashSecret(secret: string): string {
    const salt = crypto.randomBytes(16).toString("hex");
    const masterKey = secrets.get("API_KEY_HASH_SECRET");
    const boundSecret = crypto.createHmac("sha512", masterKey).update(secret).digest("hex");
    const derivedKey = crypto
      .pbkdf2Sync(boundSecret, salt, this.ITERATIONS, this.KEYLEN, this.DIGEST)
      .toString("hex");
    return `${this.FORMAT_VERSION}.${salt}.${derivedKey}`;
  }

  /**
   * Verifica usando Constant-Time Verification reconstruyendo la pirámide criptográfica.
   */
  public static verifySecret(secret: string, storedHash: string): boolean {
    const parts = storedHash.split(".");
    if (parts.length !== 3) {
      return false; // Legacy o formato inválido
    }
    const [version, salt, storedDerivedKey] = parts;
    if (version !== this.FORMAT_VERSION) {
      return false;
    }
    const masterKey = secrets.get("API_KEY_HASH_SECRET");
    const boundSecret = crypto.createHmac("sha512", masterKey).update(secret).digest("hex");
    const computedDerivedKey = crypto
      .pbkdf2Sync(boundSecret, salt, this.ITERATIONS, this.KEYLEN, this.DIGEST)
      .toString("hex");

    const computedBuf = Buffer.from(computedDerivedKey, "hex");
    const storedBuf = Buffer.from(storedDerivedKey, "hex");
    if (computedBuf.length !== storedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(computedBuf, storedBuf);
  }
}
