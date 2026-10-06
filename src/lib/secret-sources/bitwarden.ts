/**
 * `bitwarden` source — resolve secrets through the Bitwarden Secrets Manager
 * CLI (`bws`), configured with `BWS_ACCESS_TOKEN` + `BWS_PROJECT_ID`
 * (+ optional `BWS_SERVER_URL` for EU Cloud / self-hosted).
 *
 * Fail-closed by construction:
 * - missing access token or project id → `not_configured`;
 * - `bws` absent from PATH → `binary_missing`. Isabella NEVER downloads or
 *   installs binaries at runtime (Hermes' auto-install from GitHub Releases
 *   is deliberately not ported: supply-chain risk, and Vercel serverless has
 *   no writable place to install to);
 * - failures throw `SecretSourceError`; this source never falls back to a
 *   plaintext env value, so a broken vault cannot silently degrade into
 *   "whatever happens to be in the environment".
 *
 * Only safety + caching were ported: per-key in-process TTL cache, minimal
 * child environment (the access token is passed to the child explicitly and
 * never logged), bounded timeout/output, and stderr used solely to classify
 * failures.
 */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { passthroughChildEnv, passthroughEnv } from "../config";
import { createLogger } from "../logger";
import { cacheGet, cacheSet, SECRET_CACHE_TTL_MS } from "./cache";
import { boundedLimit, runProcess, type RunProcessRequest, type RunProcessResult } from "./runner";
import { readSecretSourceSettings } from "./settings";
import {
  isEnvKey,
  SecretSourceError,
  type SecretSource,
  type SecretSourceErrorCode,
  type SecretSourceKind,
  type SecretSourceSettingsReader,
} from "./types";

/** Hard budget for one `bws` invocation (serverless-friendly, never exceeded). */
export const BWS_TIMEOUT_MS = 10_000;
/** Hard cap on `bws` output (1 MiB). */
export const BWS_MAX_OUTPUT_BYTES = 1024 * 1024;

const BWS_BINARY_NAME = "bws";
const BWS_FAILURE_TOKENS = [
  "unauthorized",
  "invalid token",
  "access token",
  "invalid_client",
  "invalid_grant",
  "400 bad request",
  "401",
  "403",
] as const;

const log = createLogger("secret-sources");

export interface BitwardenSourceOptions {
  /** Settings reader; defaults to the validated runtime configuration. */
  settings?: SecretSourceSettingsReader;
  /** Process runner; injectable for hermetic tests. */
  run?: (request: RunProcessRequest) => Promise<RunProcessResult>;
  /** Binary resolver; injectable for hermetic tests. */
  findBinary?: (name: string) => string | null;
  /** Timeout override — clamped to `BWS_TIMEOUT_MS`, never above it. */
  timeoutMs?: number;
  /** Output cap override — clamped to `BWS_MAX_OUTPUT_BYTES`, never above it. */
  maxOutputBytes?: number;
}

/** Platform binary name (`bws.exe` on Windows, `bws` elsewhere). */
export function executableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

/**
 * Searches an explicit PATH value for an executable file.
 *
 * Exported so the lookup is testable without depending on the host's PATH;
 * the live source feeds it `config()`'s passthrough PATH (the only legal way
 * to read `process.env` in this repository).
 */
export function findExecutableInPath(name: string, pathValue: string | null): string | null {
  if (!pathValue) return null;
  const fileName = executableName(name);
  for (const rawDir of pathValue.split(delimiter)) {
    const dir = rawDir.trim();
    if (dir.length === 0) continue;
    const candidate = join(dir, fileName);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not present in this PATH entry — keep looking.
    }
  }
  return null;
}

function defaultFindBinary(name: string): string | null {
  return findExecutableInPath(name, passthroughEnv("PATH") ?? null);
}

/** Cache-key component: a SHA-256 prefix of the token, never the token itself. */
function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
}

/**
 * Parses `bws secret list --output json` into a key → value map.
 *
 * Entries that are not env-shaped are skipped: injecting an arbitrary vault
 * key name into the environment would be an injection vector of its own.
 * Only names and values are read; nothing is logged here.
 */
export function parseBwsSecretList(stdout: string): Record<string, string> {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new SecretSourceError("invalid_output", "bitwarden", "bws returned non-JSON output.", {
      cause: error,
    });
  }
  if (!Array.isArray(payload)) {
    throw new SecretSourceError(
      "invalid_output",
      "bitwarden",
      "bws returned an unexpected payload shape.",
    );
  }
  const secrets: Record<string, string> = {};
  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) continue;
    if (!("key" in entry) || !("value" in entry)) continue;
    const { key, value } = entry;
    if (typeof key !== "string" || typeof value !== "string") continue;
    if (!isEnvKey(key)) continue;
    secrets[key] = value;
  }
  return secrets;
}

function classifyFailure(result: RunProcessResult): SecretSourceErrorCode {
  if (result.outcome === "timeout") return "timeout";
  if (result.outcome === "output_too_large") return "output_too_large";
  if (result.outcome === "spawn_error") {
    return result.spawnErrorCode === "ENOENT" ? "binary_missing" : "command_failed";
  }
  const failureText = result.stderr.toLowerCase();
  for (const token of BWS_FAILURE_TOKENS) {
    if (failureText.includes(token)) return "auth_failed";
  }
  return "command_failed";
}

function messageFor(code: SecretSourceErrorCode, exitCode: number | null): string {
  switch (code) {
    case "not_configured":
      return "Bitwarden Secrets Manager is not configured (BWS_ACCESS_TOKEN / BWS_PROJECT_ID).";
    case "binary_missing":
      return "The bws binary is not on PATH. Install it out-of-band; Isabella never downloads binaries at runtime.";
    case "auth_failed":
      return "Bitwarden rejected the machine-account access token (revoked, expired, or wrong region).";
    case "timeout":
      return `bws timed out after ${BWS_TIMEOUT_MS}ms.`;
    case "output_too_large":
      return `bws output exceeded the ${BWS_MAX_OUTPUT_BYTES}-byte cap.`;
    case "invalid_output":
      return "bws returned output that is not a secret list.";
    case "invalid_key":
      return "Secret key names must match [A-Za-z_][A-Za-z0-9_]*.";
    default:
      return `bws exited with status ${exitCode === null ? "unknown" : exitCode}.`;
  }
}

export class BitwardenSecretSource implements SecretSource {
  readonly kind: SecretSourceKind = "bitwarden";
  private readonly settings: SecretSourceSettingsReader;
  private readonly run: (request: RunProcessRequest) => Promise<RunProcessResult>;
  private readonly findBinary: (name: string) => string | null;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: BitwardenSourceOptions = {}) {
    this.settings = options.settings ?? readSecretSourceSettings;
    this.run = options.run ?? runProcess;
    this.findBinary = options.findBinary ?? defaultFindBinary;
    this.timeoutMs = boundedLimit(BWS_TIMEOUT_MS, options.timeoutMs);
    this.maxOutputBytes = boundedLimit(BWS_MAX_OUTPUT_BYTES, options.maxOutputBytes);
  }

  async resolve(key: string): Promise<string | null> {
    if (!isEnvKey(key)) {
      throw new SecretSourceError(
        "invalid_key",
        this.kind,
        "Secret key names must match [A-Za-z_][A-Za-z0-9_]*.",
      );
    }
    const settings = this.settings();
    const { accessToken, projectId, serverUrl } = settings.bitwarden;
    if (accessToken === null || projectId === null) {
      throw new SecretSourceError("not_configured", this.kind, messageFor("not_configured", null));
    }

    const namespace = `bitwarden|${tokenFingerprint(accessToken)}|${projectId}|${serverUrl ?? ""}`;
    const cached = cacheGet(namespace, key);
    if (cached !== null) return cached;

    const binary = this.findBinary(BWS_BINARY_NAME);
    if (binary === null) {
      throw new SecretSourceError("binary_missing", this.kind, messageFor("binary_missing", null));
    }

    const env: NodeJS.ProcessEnv = {
      ...passthroughChildEnv(),
      BWS_ACCESS_TOKEN: accessToken,
      NO_COLOR: "1",
    };
    if (serverUrl !== null) env.BWS_SERVER_URL = serverUrl;

    const result = await this.run({
      command: binary,
      args: ["secret", "list", projectId, "--output", "json"],
      shell: false,
      env,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
    });

    if (result.outcome !== "ok") {
      const code = classifyFailure(result);
      // Structured fields only — stderr/stdout stay out of the message and log.
      log.warn("secret_bitwarden_failed", {
        source: this.kind,
        key,
        outcome: result.outcome,
        code,
        exitCode: result.exitCode,
      });
      throw new SecretSourceError(code, this.kind, messageFor(code, result.exitCode));
    }

    // One bulk fetch serves every key in the project for the cache TTL.
    const secrets = parseBwsSecretList(result.stdout);
    for (const [secretKey, secretValue] of Object.entries(secrets)) {
      cacheSet(namespace, secretKey, secretValue, SECRET_CACHE_TTL_MS);
    }
    const value = secrets[key] ?? null;
    log.debug("secret_resolved", { source: this.kind, key, present: value !== null });
    return value;
  }
}
