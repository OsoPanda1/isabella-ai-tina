/**
 * Secret sources for Isabella (`src/lib/secret-sources/`).
 *
 * A `SecretSource` resolves one secret by name; the configured source is
 * selected by `ISABELLA_SECRET_SOURCE` (`env` | `command` | `bitwarden`,
 * default `env`) and read through `config()`.
 *
 * There is deliberately no fallback chain: a source either resolves, returns
 * `null` ("healthy but no value"), or throws a typed `SecretSourceError`.
 * A broken vault or helper never silently degrades into a plaintext value
 * (fail-closed, AGENTS.md §4.2).
 *
 * `src/lib/secrets.ts` stays the synchronous legacy API; this module is the
 * async, pluggable successor for new call sites.
 */
import { cacheClear } from "./cache";
import { BitwardenSecretSource } from "./bitwarden";
import { CommandSecretSource } from "./command";
import { EnvSecretSource } from "./env";
import { readSecretSourceSettings } from "./settings";
import {
  ENV_KEY_PATTERN,
  SecretSourceError,
  type SecretSource,
  type SecretSourceKind,
} from "./types";
import { MissingSecretError } from "../secrets";

export interface ResolveSecretOptions {
  /** Explicit source override; never inferred and never a silent fallback. */
  source?: SecretSourceKind;
}

export function getSecretSource(kind: SecretSourceKind): SecretSource {
  switch (kind) {
    case "command":
      return new CommandSecretSource();
    case "bitwarden":
      return new BitwardenSecretSource();
    default:
      return new EnvSecretSource();
  }
}

/**
 * Resolves one secret through the configured (or explicitly requested) source.
 *
 * @returns the value, or `null` when the source is healthy and has no value.
 * @throws {SecretSourceError} for an invalid key name or a broken source.
 */
export async function resolveSecret(
  key: string,
  options: ResolveSecretOptions = {},
): Promise<string | null> {
  const kind = options.source ?? readSecretSourceSettings().kind;
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new SecretSourceError(
      "invalid_key",
      kind,
      "Secret key names must match [A-Za-z_][A-Za-z0-9_]*.",
    );
  }
  return getSecretSource(kind).resolve(key);
}

/**
 * Like {@link resolveSecret} but fail-closed: a missing value raises
 * `MissingSecretError` instead of returning `null`. Unlike
 * `secrets.getSecret` it never invents a dev placeholder value.
 */
export async function requireSecret(
  key: string,
  options: ResolveSecretOptions = {},
): Promise<string> {
  const value = await resolveSecret(key, options);
  if (value === null) throw new MissingSecretError(key);
  return value;
}

/** Drops every cached secret — call after a credential rotation. */
export function clearSecretCache(): void {
  cacheClear();
}

export { cacheClear, cacheGet, cacheSet, cacheSize, SECRET_CACHE_TTL_MS } from "./cache";
export {
  BitwardenSecretSource,
  executableName,
  findExecutableInPath,
  parseBwsSecretList,
  BWS_MAX_OUTPUT_BYTES,
  BWS_TIMEOUT_MS,
} from "./bitwarden";
export {
  CommandSecretSource,
  parseSecretOutput,
  unquoteDotenvValue,
  COMMAND_MAX_OUTPUT_BYTES,
  COMMAND_TIMEOUT_MS,
  SECRET_KEY_ENV_VAR,
} from "./command";
export { EnvSecretSource } from "./env";
export { readSecretSourceSettings } from "./settings";
export { runProcess, boundedLimit } from "./runner";
export { isEnvKey, SecretSourceError, ENV_KEY_PATTERN } from "./types";
export type {
  BitwardenSettings,
  SecretSource,
  SecretSourceErrorCode,
  SecretSourceKind,
  SecretSourceSettings,
  SecretSourceSettingsReader,
} from "./types";
export type { RunOutcome, RunProcessRequest, RunProcessResult } from "./runner";
export type { CommandSourceOptions } from "./command";
export type { BitwardenSourceOptions } from "./bitwarden";
