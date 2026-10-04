import { Keyring, generateKeyMaterial, type KeyMaterial } from "./keyring";
import { secrets } from "./secrets";

/**
 * ROTACIÓN DE CLAVES (src/lib/key-rotation.ts)
 * -----------------------------------------------------------------
 * Gestiona la rotación de claves de firma JWT con `kid`. Al rotar:
 *   1. Se genera una clave nueva (se vuelve activa).
 *   2. La anterior se mantiene como histórica (verificación sigue
 *      funcionando para tokens en vuelo).
 *   3. Las históricas expiran tras un periodo de gracia.
 *
 * El estado persistente se puede guardar (keyring-state) para
 * sobrevivir reinicios; si no hay estado, se reconstruye desde el
 * secreto maestro.
 */

export interface KeyringState {
  activeKid: string;
  keys: KeyMaterial[];
}

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

export class KeyRotationService {
  private keyring: Keyring;
  private readonly label: string;

  constructor(masterSecret: string, label = "jwt", initialState?: KeyringState) {
    this.label = label;
    this.keyring = initialState
      ? new Keyring(initialState.keys)
      : new Keyring([generateKeyMaterial(masterSecret, label)]);
  }

  active(): KeyMaterial {
    return this.keyring.active();
  }

  get(kid: string): KeyMaterial | undefined {
    return this.keyring.get(kid);
  }

  has(kid: string): boolean {
    return this.keyring.has(kid);
  }

  rotate(now = Date.now()): KeyMaterial {
    const newKey = generateKeyMaterial(secrets.jwtSecret(), this.label);
    // La activa pasa a histórica.
    const current = this.keyring.active();
    this.keyring.add({ ...current, isActive: false });
    this.keyring.add({ ...newKey, isActive: true });
    this.prune(now);
    return newKey;
  }

  /** Elimina claves históricas más allá del periodo de gracia. */
  prune(now = Date.now()): void {
    const activeKid = this.keyring.active().kid;
    for (const kid of this.keyring.kids()) {
      const k = this.keyring.get(kid);
      if (!k) continue;
      if (kid === activeKid) continue;
      if (now - k.activeAt > GRACE_PERIOD_MS) {
        (this.keyring as unknown as { keys: Map<string, KeyMaterial> }).keys.delete(kid);
      }
    }
  }

  snapshot(): KeyringState {
    return {
      activeKid: this.keyring.active().kid,
      keys: this.keyring
        .kids()
        .map((k) => this.keyring.get(k)!)
        .sort((a, b) => a.activeAt - b.activeAt),
    };
  }

  kid(): string {
    return this.keyring.active().kid;
  }
}

export function createKeyRotation(state?: KeyringState): KeyRotationService {
  return new KeyRotationService(secrets.jwtSecret(), "jwt", state);
}
