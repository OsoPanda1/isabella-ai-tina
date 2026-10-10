/**
 * Secret sources — no-leak contract (test/security/secret-sources-no-leak.test.ts).
 *
 * Guarantees under test: neither log output nor `SecretSourceError` messages
 * ever carry a resolved value, a helper's stdout/stderr, or the configured
 * helper command (AGENTS.md §16, §21). Only structured fields (source, key
 * name, outcome, exit code) may be logged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BitwardenSecretSource,
  CommandSecretSource,
  clearSecretCache,
  type RunProcessResult,
} from "@/lib/secret-sources";
import {
  bitwardenSettings,
  captureSecretSourceError,
  commandSettings,
  failedRun,
  okRun,
} from "../unit/secret-sources-fixtures";

let consoleCalls: string[];

beforeEach(() => {
  clearSecretCache();
  consoleCalls = [];
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      for (const arg of args) {
        consoleCalls.push(typeof arg === "string" ? arg : JSON.stringify(arg));
      }
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  clearSecretCache();
});

describe("secret sources never leak values", () => {
  it("logs only structured fields when a helper fails", async () => {
    const source = new CommandSecretSource({
      settings: () => commandSettings("helper-with-sensitive-output"),
      run: async (): Promise<RunProcessResult> =>
        failedRun("exit_error", { stderr: "stderr-marker" }),
    });

    await expect(source.resolve("MY_API_KEY")).resolves.toBeNull();

    const logged = consoleCalls.join("\n");
    expect(logged).toContain("secret_command_failed");
    expect(logged).toContain("MY_API_KEY");
    expect(logged).not.toContain("stderr-marker");
    expect(logged).not.toContain("helper-with-sensitive-output");
  });

  it("keeps helper stdout out of every console level on success", async () => {
    const source = new CommandSecretSource({
      settings: () => commandSettings("helper"),
      run: async (): Promise<RunProcessResult> => okRun("MY_API_KEY=value-fixture"),
    });

    await expect(source.resolve("MY_API_KEY")).resolves.toBe("value-fixture");
    expect(consoleCalls.join("\n")).not.toContain("value-fixture");
  });

  it("keeps bws diagnostics out of errors and logs", async () => {
    const source = new BitwardenSecretSource({
      settings: () => bitwardenSettings(),
      findBinary: () => "bws-bin",
      run: async (): Promise<RunProcessResult> =>
        failedRun("exit_error", { stderr: "[401] unauthorized-marker" }),
    });

    const error = await captureSecretSourceError(() => source.resolve("API_KEY"));
    expect(error.code).toBe("auth_failed");

    const surface = [error.message, ...consoleCalls].join("\n");
    expect(surface).not.toContain("unauthorized-marker");
    expect(consoleCalls.join("\n")).toContain("secret_bitwarden_failed");
    expect(consoleCalls.join("\n")).toContain("auth_failed");
  });

  it("never embeds non-JSON bws output in an error message", async () => {
    const source = new BitwardenSecretSource({
      settings: () => bitwardenSettings(),
      findBinary: () => "bws-bin",
      run: async (): Promise<RunProcessResult> => okRun("<html>session-expired-marker</html>"),
    });

    const error = await captureSecretSourceError(() => source.resolve("API_KEY"));
    expect(error.code).toBe("invalid_output");
    expect(error.message).not.toContain("session-expired-marker");
    expect(consoleCalls.join("\n")).not.toContain("session-expired-marker");
  });
});
