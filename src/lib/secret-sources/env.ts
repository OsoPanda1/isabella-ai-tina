/**
 * `env` source — the default and the pre-existing behaviour: read the secret
 * from Isabella's validated runtime configuration.
 *
 * Values are trimmed the same way `secrets.getSecret` did; a blank value is
 * "no value" (`null`), never an empty credential.
 */
import { config, type Env } from "../config";
import { isEnvKey, SecretSourceError, type SecretSource, type SecretSourceKind } from "./types";

export class EnvSecretSource implements SecretSource {
  readonly kind: SecretSourceKind = "env";
  private readonly readEnv: () => Env;

  constructor(readEnv: () => Env = config) {
    this.readEnv = readEnv;
  }

  async resolve(key: string): Promise<string | null> {
    if (!isEnvKey(key)) {
      throw new SecretSourceError(
        "invalid_key",
        this.kind,
        "Secret key names must match [A-Za-z_][A-Za-z0-9_]*.",
      );
    }
    const raw: unknown = this.readEnv()[key];
    if (typeof raw === "string") {
      const value = raw.trim();
      return value.length > 0 ? value : null;
    }
    if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
    return null;
  }
}
