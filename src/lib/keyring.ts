import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * KEYRING (src/lib/keyring.ts)
 * -----------------------------------------------------------------
 * Abstracción de claves activas e históricas indexadas por `kid`.
 * Permite firmar con la clave activa y verificar con cualquiera de la
 * lista histórica (necesario tras rotación para no invalidar tokens
 * en vuelo). Las claves derivan de un secreto maestro nunca expuesto.
 */

export interface KeyMaterial {
  kid: string;
  /** clave HMAC derivada (hex) */
  secret: string;
  /** timestamp de activación; más viejo = histórico */
  activeAt: number;
  /** true si es la clave activa actual */
  isActive: boolean;
}

export class Keyring {
  private keys = new Map<string, KeyMaterial>();

  constructor(initialKeys: KeyMaterial[] = []) {
    for (const k of initialKeys) this.keys.set(k.kid, k);
  }

  static deriveKeyId(label: string, secret: string): string {
    return createHash("sha256").update(`${label}:${secret}`).digest("hex").slice(0, 8);
  }

  static deriveHmacSecret(master: string, kid: string): string {
    return createHash("sha512").update(`${master}::${kid}`).digest("hex");
  }

  add(key: KeyMaterial): void {
    this.keys.set(key.kid, key);
  }

  get(kid: string): KeyMaterial | undefined {
    return this.keys.get(kid);
  }

  active(): KeyMaterial {
    let active: KeyMaterial | undefined;
    for (const k of this.keys.values()) {
      if (k.isActive && (!active || k.activeAt >= active.activeAt)) active = k;
    }
    if (!active) throw new Error("Keyring: no hay clave activa configurada");
    return active;
  }

  /** Verifica que la firma fue producida por una clave conocida. */
  has(kid: string): boolean {
    return this.keys.has(kid);
  }

  kids(): string[] {
    return [...this.keys.keys()];
  }

  size(): number {
    return this.keys.size;
  }

  static matches(sigA: Buffer, sigB: Buffer): boolean {
    if (sigA.length !== sigB.length) return false;
    return timingSafeEqual(sigA, sigB);
  }
}

/** Genera material de clave nueva con secret aleatorio (para rotación). */
export function generateKeyMaterial(master: string, label: string): KeyMaterial {
  const nonce = randomBytes(6).toString("hex");
  const kid = Keyring.deriveKeyId(`${label}:${nonce}`, master);
  return {
    kid,
    secret: Keyring.deriveHmacSecret(master, kid),
    activeAt: Date.now(),
    isActive: true,
  };
}
