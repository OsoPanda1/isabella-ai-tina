/**
 * Shared contract for Isabella secret sources (`src/lib/secret-sources/`).
 *
 * Ported from the Hermes `agent.secret_sources` taxonomy and adapted to
 * Isabella's runtime: configuration comes from `config()` (the only legal
 * reader of `process.env`), sources never install binaries, never persist
 * secret values to disk, and never fall back to another source silently
 * (fail-closed, AGENTS.md §4.2 / §2.3).
 */

/** Which backend resolves a secret. `env` is the default and the legacy behaviour. */
export type SecretSourceKind = "env" | "command" | "bitwarden";

/**
 * Stable failure taxonomy. Codes are safe to log: they never carry a secret
 * value, a helper's output, or the configured command string.
 */
export type SecretSourceErrorCode =
  | "not_configured"
  | "invalid_key"
  | "binary_missing"
  | "auth_failed"
  | "timeout"
  | "output_too_large"
  | "invalid_output"
  | "command_failed";

export interface SecretSourceErrorOptions {
  cause?: unknown;
}

/**
 * Typed, fail-closed failure of a secret source.
 *
 * Thrown when a source cannot resolve at all (missing configuration, missing
 * `bws` binary, rejected access token, timeout). A key that simply does not
 * exist resolves to `null` instead — `null` never means "source broken".
 */
export class SecretSourceError extends Error {
  constructor(
    public readonly code: SecretSourceErrorCode,
    public readonly source: SecretSourceKind,
    message: string,
    options: SecretSourceErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SecretSourceError";
  }
}

export interface SecretSource {
  readonly kind: SecretSourceKind;
  /**
   * Resolves one secret by name.
   *
   * @returns the secret value, or `null` when the source is healthy but has no
   * value for `key`. Never logs or stores the returned value.
   * @throws {SecretSourceError} when the source itself is unusable.
   */
  resolve(key: string): Promise<string | null>;
}

export interface BitwardenSettings {
  accessToken: string | null;
  projectId: string | null;
  serverUrl: string | null;
}

/** Snapshot of the validated configuration a source needs (see `settings.ts`). */
export interface SecretSourceSettings {
  kind: SecretSourceKind;
  command: string | null;
  bitwarden: BitwardenSettings;
}

export type SecretSourceSettingsReader = () => SecretSourceSettings;

/** Env-var key shape. Also the only key shape ever passed to a helper or `bws`. */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isEnvKey(value: string): boolean {
  return ENV_KEY_PATTERN.test(value);
}
