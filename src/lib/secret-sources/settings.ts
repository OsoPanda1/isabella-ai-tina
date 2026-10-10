/**
 * Settings for the secret sources, read exclusively through `config()` —
 * `src/lib/config.ts` remains the only module allowed to touch `process.env`
 * (AGENTS.md §18, enforced by `test/unit/env-contract.test.ts`).
 */
import { config, type Env } from "../config";
import type { SecretSourceSettings } from "./types";

function orNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readSecretSourceSettings(env: Env = config()): SecretSourceSettings {
  return {
    kind: env.ISABELLA_SECRET_SOURCE,
    command: orNull(env.ISABELLA_SECRET_COMMAND),
    bitwarden: {
      accessToken: orNull(env.BWS_ACCESS_TOKEN),
      projectId: orNull(env.BWS_PROJECT_ID),
      serverUrl: orNull(env.BWS_SERVER_URL),
    },
  };
}
