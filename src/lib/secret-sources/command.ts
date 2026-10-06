/**
 * `command` source — resolve a secret through a user-configured helper
 * command (keepassxc-cli, secret-tool, pass, a script that cats a tmpfs env
 * file, …), configured as `ISABELLA_SECRET_COMMAND`.
 *
 * Security model, ported from Hermes' `agent/secret_sources/command.py`:
 * - the command string is the operator's own configuration (same trust level
 *   as the `.env` file they control) and is run through a shell;
 * - the requested key reaches the child ONLY as data in `ISABELLA_SECRET_KEY`
 *   — it is never interpolated into the command string, so a hostile key name
 *   is inert (and is rejected up-front by `isEnvKey`);
 * - hard 3s timeout, 1 MiB output cap, non-interactive stdin, `windowsHide`;
 * - helper stderr is captured and discarded: diagnostics can carry secret
 *   material, so only structured fields (outcome, exit code) are logged;
 * - failures degrade to `null` ("no value") after a structured log; they
 *   never throw a partial value and never log the value.
 */
import { passthroughChildEnv } from "../config";
import { createLogger } from "../logger";
import { cacheGet, cacheSet, SECRET_CACHE_TTL_MS } from "./cache";
import { boundedLimit, runProcess, type RunProcessRequest, type RunProcessResult } from "./runner";
import { readSecretSourceSettings } from "./settings";
import {
  isEnvKey,
  SecretSourceError,
  type SecretSource,
  type SecretSourceKind,
  type SecretSourceSettings,
  type SecretSourceSettingsReader,
} from "./types";

/** Hard timeout for one helper run. Configured values can only lower it. */
export const COMMAND_TIMEOUT_MS = 3_000;
/** Hard cap on helper output (1 MiB) so a misbehaving helper cannot OOM us. */
export const COMMAND_MAX_OUTPUT_BYTES = 1024 * 1024;
/** Channel through which the requested key name reaches the helper. */
export const SECRET_KEY_ENV_VAR = "ISABELLA_SECRET_KEY";

/**
 * A line is a KEY=VALUE pair only when an env-key shape precedes the `=`.
 * Anchored, and `.` does not cross newlines, so a multi-line blob can never
 * match as a single "env-shaped" value.
 */
const ENV_LINE_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

const log = createLogger("secret-sources");

export interface CommandSourceOptions {
  /** Settings reader; defaults to the validated runtime configuration. */
  settings?: SecretSourceSettingsReader;
  /** Process runner; injectable for hermetic tests. */
  run?: (request: RunProcessRequest) => Promise<RunProcessResult>;
  /** Timeout override — clamped to `COMMAND_TIMEOUT_MS`, never above it. */
  timeoutMs?: number;
  /** Output cap override — clamped to `COMMAND_MAX_OUTPUT_BYTES`, never above it. */
  maxOutputBytes?: number;
}

/** Strips one layer of matching surrounding quotes from a dotenv value. */
export function unquoteDotenvValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parses a helper's stdout. Supports both shapes: a bare value (single-key
 * helper) and a dotenv blob (`KEY=VALUE` lines).
 *
 * The cross-key misroute guard matters: a sloppy helper emitting
 * `OTHER_KEY=value` must never be returned as the wanted secret — that would
 * send one provider's credential to another provider's endpoint. Base64
 * padding (`dGVzdA==`) is disambiguated because it only ever produces an
 * env-shaped line whose value part is empty or all `=`.
 */
export function parseSecretOutput(stdout: string, wantedKey: string): string | null {
  const text = stdout.replace(/\r\n/g, "\n");
  const dotenvLines: Array<{ key: string; value: string }> = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = ENV_LINE_PATTERN.exec(line);
    if (match !== null) dotenvLines.push({ key: match[1], value: match[2] });
  }

  for (const entry of dotenvLines) {
    if (entry.key !== wantedKey) continue;
    const value = unquoteDotenvValue(entry.value);
    // Whitespace-only is "no value": it would otherwise flow into an
    // Authorization header and guarantee a 401.
    return value.trim().length > 0 ? value : null;
  }

  // A multi-key dump without the wanted key is a miss, not a bare value.
  // One non-matching env-shaped line still falls through: a bare secret can
  // itself look like KEY=VALUE (base64 with `=` padding).
  if (dotenvLines.length > 1) return null;

  const value = text.trim();
  if (value.length === 0) return null;
  const envShaped = ENV_LINE_PATTERN.exec(value);
  if (envShaped !== null && envShaped[1] !== wantedKey && !/^=*$/.test(envShaped[2].trim())) {
    return null;
  }
  return value;
}

export class CommandSecretSource implements SecretSource {
  readonly kind: SecretSourceKind = "command";
  private readonly settings: SecretSourceSettingsReader;
  private readonly run: (request: RunProcessRequest) => Promise<RunProcessResult>;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: CommandSourceOptions = {}) {
    this.settings = options.settings ?? readSecretSourceSettings;
    this.run = options.run ?? runProcess;
    this.timeoutMs = boundedLimit(COMMAND_TIMEOUT_MS, options.timeoutMs);
    this.maxOutputBytes = boundedLimit(COMMAND_MAX_OUTPUT_BYTES, options.maxOutputBytes);
  }

  async resolve(key: string): Promise<string | null> {
    if (!isEnvKey(key)) {
      throw new SecretSourceError(
        "invalid_key",
        this.kind,
        "Secret key names must match [A-Za-z_][A-Za-z0-9_]*.",
      );
    }
    const settings: SecretSourceSettings = this.settings();
    const command = settings.command;
    if (command === null) {
      throw new SecretSourceError(
        "not_configured",
        this.kind,
        'The "command" secret source is selected but ISABELLA_SECRET_COMMAND is empty.',
      );
    }

    const namespace = `command|${command}`;
    const cached = cacheGet(namespace, key);
    if (cached !== null) return cached;

    const result = await this.run({
      command,
      shell: true,
      env: { ...passthroughChildEnv(), [SECRET_KEY_ENV_VAR]: key },
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
    });

    if (result.outcome !== "ok") {
      // Structured fields only: never the command string, never helper output.
      log.warn("secret_command_failed", {
        source: this.kind,
        key,
        outcome: result.outcome,
        exitCode: result.exitCode,
      });
      return null;
    }

    const value = parseSecretOutput(result.stdout, key);
    if (value === null) {
      log.debug("secret_resolved", { source: this.kind, key, present: false });
      return null;
    }
    cacheSet(namespace, key, value, SECRET_CACHE_TTL_MS);
    log.debug("secret_resolved", { source: this.kind, key, present: true });
    return value;
  }
}
