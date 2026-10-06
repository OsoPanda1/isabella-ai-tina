/**
 * Fixtures for the secret-source tests (not a test file itself).
 *
 * Every credential-looking value here is a synthetic placeholder for a fake
 * vault: no real token, key, or helper output ever enters the repository
 * (AGENTS.md §2.3).
 */
import {
  SecretSourceError,
  type RunOutcome,
  type RunProcessResult,
  type SecretSourceSettings,
} from "@/lib/secret-sources";

export function envSettings(): SecretSourceSettings {
  return {
    kind: "env",
    command: null,
    bitwarden: { accessToken: null, projectId: null, serverUrl: null },
  };
}

export function commandSettings(command: string | null): SecretSourceSettings {
  return { ...envSettings(), kind: "command", command };
}

export function bitwardenSettings(
  overrides: {
    accessToken?: string | null;
    projectId?: string | null;
    serverUrl?: string | null;
  } = {},
): SecretSourceSettings {
  return {
    kind: "bitwarden",
    command: null,
    bitwarden: {
      // Configured-by-default fixture; pass `accessToken: null` explicitly to
      // exercise the not_configured path.
      accessToken: overrides.accessToken === undefined ? "token-fixture" : overrides.accessToken,
      projectId: overrides.projectId === undefined ? "project-1" : overrides.projectId,
      serverUrl: overrides.serverUrl === undefined ? null : overrides.serverUrl,
    },
  };
}

export function okRun(stdout: string): RunProcessResult {
  return { outcome: "ok", exitCode: 0, stdout, stderr: "" };
}

export function failedRun(
  outcome: Exclude<RunOutcome, "ok">,
  options: { stderr?: string; exitCode?: number | null; spawnErrorCode?: string } = {},
): RunProcessResult {
  return {
    outcome,
    exitCode: options.exitCode === undefined ? 1 : options.exitCode,
    stdout: "",
    stderr: options.stderr ?? "",
    ...(options.spawnErrorCode === undefined ? {} : { spawnErrorCode: options.spawnErrorCode }),
  };
}

/** Captures a synchronously thrown `SecretSourceError` (or rethrows). */
export function captureThrown(fn: () => unknown): SecretSourceError {
  try {
    fn();
  } catch (error) {
    if (error instanceof SecretSourceError) return error;
    throw error;
  }
  throw new Error("expected the call to throw a SecretSourceError");
}

/** Captures a rejected `SecretSourceError` (or rethrows). */
export async function captureSecretSourceError(
  run: () => Promise<unknown>,
): Promise<SecretSourceError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SecretSourceError) return error;
    throw error;
  }
  throw new Error("expected the call to reject with a SecretSourceError");
}
