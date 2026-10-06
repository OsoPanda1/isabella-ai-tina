/**
 * Secret sources — unit coverage for src/lib/secret-sources/ (port of the
 * Hermes Bitwarden `bws` module and the `command` secret source).
 *
 * Conventions: no real credentials, no network, no binary installation; the
 * `command` tests use platform built-ins only, and the `bitwarden` tests
 * inject the process runner.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { passthroughChildEnv, resetConfigCache } from "@/lib/config";
import { envSchema } from "@/lib/env-schema";
import { MissingSecretError } from "@/lib/secrets";
import {
  BitwardenSecretSource,
  COMMAND_MAX_OUTPUT_BYTES,
  COMMAND_TIMEOUT_MS,
  CommandSecretSource,
  EnvSecretSource,
  SECRET_KEY_ENV_VAR,
  SecretSourceError,
  boundedLimit,
  cacheClear,
  cacheGet,
  cacheSet,
  clearSecretCache,
  executableName,
  findExecutableInPath,
  getSecretSource,
  parseBwsSecretList,
  parseSecretOutput,
  readSecretSourceSettings,
  requireSecret,
  resolveSecret,
  runProcess,
  unquoteDotenvValue,
  type RunProcessRequest,
  type RunProcessResult,
} from "@/lib/secret-sources";
import {
  bitwardenSettings,
  captureSecretSourceError,
  captureThrown,
  commandSettings,
  failedRun,
  okRun,
} from "./secret-sources-fixtures";

const IS_WINDOWS = process.platform === "win32";
const ECHO_KEY_COMMAND = IS_WINDOWS
  ? `echo %${SECRET_KEY_ENV_VAR}%`
  : `echo $${SECRET_KEY_ENV_VAR}`;
const SLEEPER_COMMAND = IS_WINDOWS ? "ping -n 5 127.0.0.1" : "sleep 5";

function newTempDir(): string {
  return mkdtempSync(join(tmpdir(), "isabella-secret-sources-"));
}

beforeEach(() => {
  clearSecretCache();
});

afterEach(() => {
  resetConfigCache();
});

describe("readSecretSourceSettings", () => {
  it("defaults to the env source with no credentials", () => {
    expect(readSecretSourceSettings(envSchema.parse({}))).toEqual({
      kind: "env",
      command: null,
      bitwarden: { accessToken: null, projectId: null, serverUrl: null },
    });
  });

  it("maps the validated configuration for the bitwarden source", () => {
    const settings = readSecretSourceSettings(
      envSchema.parse({
        ISABELLA_SECRET_SOURCE: "bitwarden",
        ISABELLA_SECRET_COMMAND: "  secret-helper  ",
        BWS_ACCESS_TOKEN: "  token-fixture  ",
        BWS_PROJECT_ID: "project-1",
        BWS_SERVER_URL: "https://vault.example.test",
      }),
    );
    expect(settings).toEqual({
      kind: "bitwarden",
      command: "secret-helper",
      bitwarden: {
        accessToken: "token-fixture",
        projectId: "project-1",
        serverUrl: "https://vault.example.test",
      },
    });
  });

  it("rejects an unknown source selector (fail-closed)", () => {
    expect(envSchema.safeParse({ ISABELLA_SECRET_SOURCE: "vault" }).success).toBe(false);
  });
});

describe("env source", () => {
  it("resolves and trims a configured value", async () => {
    const source = new EnvSecretSource(() =>
      envSchema.parse({ GEMINI_API_KEY: "  value-fixture  " }),
    );
    await expect(source.resolve("GEMINI_API_KEY")).resolves.toBe("value-fixture");
  });

  it("returns null for missing or blank values", async () => {
    const blank = new EnvSecretSource(() => envSchema.parse({ GEMINI_API_KEY: "   " }));
    await expect(blank.resolve("GEMINI_API_KEY")).resolves.toBeNull();
    const missing = new EnvSecretSource(() => envSchema.parse({}));
    await expect(missing.resolve("GEMINI_API_KEY")).resolves.toBeNull();
  });

  it("exposes numeric settings as strings", async () => {
    const source = new EnvSecretSource(() => envSchema.parse({}));
    await expect(source.resolve("AUTH_ACCESS_TOKEN_TTL")).resolves.toBe("3600");
  });

  it("rejects a key name that is not env-shaped", async () => {
    const source = new EnvSecretSource(() => envSchema.parse({}));
    const error = await captureSecretSourceError(() => source.resolve("not a key"));
    expect(error.code).toBe("invalid_key");
    expect(error.source).toBe("env");
  });
});

describe("command output parsing", () => {
  it("reads the wanted key from a dotenv blob", () => {
    expect(parseSecretOutput("# comentario\nAPI_KEY=value-fixture\nOTRO=x\n", "API_KEY")).toBe(
      "value-fixture",
    );
    expect(parseSecretOutput('API_KEY="quoted-value"\n', "API_KEY")).toBe("quoted-value");
    expect(parseSecretOutput("API_KEY=value-fixture\r\n", "API_KEY")).toBe("value-fixture");
  });

  it("never returns another key's value (misroute guard)", () => {
    expect(parseSecretOutput("OTRO_KEY=value-fixture", "API_KEY")).toBeNull();
    expect(parseSecretOutput("A=1\nB=2\n", "API_KEY")).toBeNull();
  });

  it("keeps a bare base64 value that only looks like KEY=VALUE", () => {
    expect(parseSecretOutput("dGVzdA==", "API_KEY")).toBe("dGVzdA==");
    expect(parseSecretOutput("value-fixture", "API_KEY")).toBe("value-fixture");
  });

  it("treats empty and whitespace-only output as no value", () => {
    expect(parseSecretOutput("", "API_KEY")).toBeNull();
    expect(parseSecretOutput("   \n", "API_KEY")).toBeNull();
    expect(parseSecretOutput("API_KEY=   ", "API_KEY")).toBeNull();
    expect(parseSecretOutput('API_KEY="   "', "API_KEY")).toBeNull();
  });

  it("strips exactly one pair of surrounding quotes", () => {
    expect(unquoteDotenvValue('  "quoted"  ')).toBe("quoted");
    expect(unquoteDotenvValue('"inner"')).toBe("inner");
    expect(unquoteDotenvValue("'inner'")).toBe("inner");
    expect(unquoteDotenvValue('"inner"')).toBe("inner");
    expect(unquoteDotenvValue(`'${"inner"}'`)).toBe("inner");
    expect(unquoteDotenvValue('"unbalanced')).toBe('"unbalanced');
    expect(unquoteDotenvValue("   ")).toBe("");
  });
});

describe("runProcess", () => {
  it("settles a hung helper at the deadline", async () => {
    const startedAt = Date.now();
    const result = await runProcess({
      command: SLEEPER_COMMAND,
      shell: true,
      env: passthroughChildEnv(),
      timeoutMs: 300,
      maxOutputBytes: 1024,
    });
    expect(result.outcome).toBe("timeout");
    expect(result.stdout).toBe("");
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("caps helper output instead of buffering it", async () => {
    const result = await runProcess({
      command: "echo value-that-exceeds-the-cap",
      shell: true,
      env: passthroughChildEnv(),
      timeoutMs: 5_000,
      maxOutputBytes: 8,
    });
    expect(result.outcome).toBe("output_too_large");
    expect(result.stdout).toBe("");
  });

  it("classifies a missing executable", async () => {
    const result = await runProcess({
      command: "isabella-missing-helper",
      shell: false,
      env: {},
      timeoutMs: 1_000,
      maxOutputBytes: 1024,
    });
    expect(result.outcome).toBe("spawn_error");
    expect(result.spawnErrorCode).toBe("ENOENT");
  });

  it("runs non-interactively and returns stdout only on success", async () => {
    const ok = await runProcess({
      command: "echo helper-output",
      shell: true,
      env: passthroughChildEnv(),
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(ok.outcome).toBe("ok");
    expect(ok.stdout.trim()).toBe("helper-output");

    const failed = await runProcess({
      command: "exit 7",
      shell: true,
      env: passthroughChildEnv(),
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(failed.outcome).toBe("exit_error");
    expect(failed.exitCode).toBe(7);
    expect(failed.stdout).toBe("");
  });

  it("never lets a caller widen the hard limits", () => {
    expect(boundedLimit(COMMAND_TIMEOUT_MS, 999_999)).toBe(COMMAND_TIMEOUT_MS);
    expect(boundedLimit(COMMAND_TIMEOUT_MS, undefined)).toBe(COMMAND_TIMEOUT_MS);
    expect(boundedLimit(COMMAND_TIMEOUT_MS, 0)).toBe(1);
    expect(boundedLimit(COMMAND_MAX_OUTPUT_BYTES, 8)).toBe(8);
  });
});

describe("command source", () => {
  it("fails closed when no helper command is configured", async () => {
    const run = vi.fn(async (): Promise<RunProcessResult> => okRun("ignored"));
    const source = new CommandSecretSource({ settings: () => commandSettings(null), run });
    const error = await captureSecretSourceError(() => source.resolve("API_KEY"));
    expect(error.code).toBe("not_configured");
    expect(error.source).toBe("command");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a hostile key name before spawning anything", async () => {
    const run = vi.fn(async (): Promise<RunProcessResult> => okRun("ignored"));
    const source = new CommandSecretSource({ settings: () => commandSettings("helper"), run });
    const error = await captureSecretSourceError(() => source.resolve("A&rm -rf"));
    expect(error.code).toBe("invalid_key");
    expect(run).not.toHaveBeenCalled();
  });

  it("passes the requested key to the helper as data", async () => {
    const source = new CommandSecretSource({
      settings: () => commandSettings(ECHO_KEY_COMMAND),
    });
    await expect(source.resolve("MY_SECRET_KEY")).resolves.toBe("MY_SECRET_KEY");
  });

  it("resolves a KEY=VALUE helper output", async () => {
    const source = new CommandSecretSource({
      settings: () => commandSettings("echo NESTED=value-fixture"),
    });
    await expect(source.resolve("NESTED")).resolves.toBe("value-fixture");
  });

  it("returns null when the helper exits non-zero", async () => {
    const source = new CommandSecretSource({ settings: () => commandSettings("exit 7") });
    await expect(source.resolve("ANY_KEY")).resolves.toBeNull();
  });

  it("returns null when helper output exceeds the cap", async () => {
    const source = new CommandSecretSource({
      settings: () => commandSettings("echo value-that-exceeds-the-cap"),
      maxOutputBytes: 8,
    });
    await expect(source.resolve("ANY_KEY")).resolves.toBeNull();
  });

  it("gives up at the hard timeout", async () => {
    const source = new CommandSecretSource({
      settings: () => commandSettings(SLEEPER_COMMAND),
      timeoutMs: 300,
    });
    const startedAt = Date.now();
    await expect(source.resolve("ANY_KEY")).resolves.toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("caches one helper result per command and key", async () => {
    const run = vi.fn(async (): Promise<RunProcessResult> => okRun("API_KEY=value-fixture"));
    const source = new CommandSecretSource({ settings: () => commandSettings("helper-a"), run });
    await expect(source.resolve("API_KEY")).resolves.toBe("value-fixture");
    await expect(source.resolve("API_KEY")).resolves.toBe("value-fixture");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("bitwarden source", () => {
  it("fails closed without an access token", async () => {
    const run = vi.fn(async (): Promise<RunProcessResult> => okRun("[]"));
    const source = new BitwardenSecretSource({
      settings: () => bitwardenSettings({ accessToken: null }),
      findBinary: () => "bws-bin",
      run,
    });
    const error = await captureSecretSourceError(() => source.resolve("API_KEY"));
    expect(error.code).toBe("not_configured");
    expect(error.source).toBe("bitwarden");
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed without a project id", async () => {
    const run = vi.fn(async (): Promise<RunProcessResult> => okRun("[]"));
    const source = new BitwardenSecretSource({
      settings: () => bitwardenSettings({ projectId: null }),
      findBinary: () => "bws-bin",
      run,
    });
    const error = await captureSecretSourceError(() => source.resolve("API_KEY"));
    expect(error.code).toBe("not_configured");
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed when bws is not installed (never installs it)", async () => {
    const run = vi.fn(async (): Promise<RunProcessResult> => okRun("[]"));
    const source = new BitwardenSecretSource({
      settings: () => bitwardenSettings(),
      findBinary: () => null,
      run,
    });
    const error = await captureSecretSourceError(() => source.resolve("API_KEY"));
    expect(error.code).toBe("binary_missing");
    expect(error.message).toContain("never downloads");
    expect(run).not.toHaveBeenCalled();
  });

  it("asks bws for the project list and passes only the token to the child", async () => {
    const run = vi.fn(async (request: RunProcessRequest): Promise<RunProcessResult> => {
      expect(request.shell).toBe(false);
      expect(request.command).toBe("bws-bin");
      expect(request.args).toEqual(["secret", "list", "project-1", "--output", "json"]);
      expect(request.env.BWS_ACCESS_TOKEN).toBe("token-fixture");
      expect(request.env.BWS_SERVER_URL).toBeUndefined();
      expect(request.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
      return okRun(JSON.stringify([{ key: "API_KEY", value: "value-fixture" }]));
    });
    const source = new BitwardenSecretSource({
      settings: () => bitwardenSettings(),
      findBinary: () => "bws-bin",
      run,
    });
    await expect(source.resolve("API_KEY")).resolves.toBe("value-fixture");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("serves every project key from one bulk fetch", async () => {
    const run = vi.fn(async (): Promise<RunProcessResult> =>
      okRun(
        JSON.stringify([
          { key: "API_KEY", value: "value-fixture" },
          { key: "OTHER_KEY", value: "other-fixture" },
        ]),
      ),
    );
    const source = new BitwardenSecretSource({
      settings: () => bitwardenSettings(),
      findBinary: () => "bws-bin",
      run,
    });
    await expect(source.resolve("API_KEY")).resolves.toBe("value-fixture");
    await expect(source.resolve("OTHER_KEY")).resolves.toBe("other-fixture");
    expect(run).toHaveBeenCalledTimes(1);
    await expect(source.resolve("MISSING_KEY")).resolves.toBeNull();
  });

  it("maps process failures to typed errors without leaking output", async () => {
    const cases: Array<{
      outcome: Exclude<RunProcessResult["outcome"], "ok">;
      stderr?: string;
      spawnErrorCode?: string;
      expected: string;
    }> = [
      { outcome: "timeout", expected: "timeout" },
      { outcome: "output_too_large", expected: "output_too_large" },
      { outcome: "exit_error", stderr: "[401] unauthorized-marker", expected: "auth_failed" },
      { outcome: "exit_error", stderr: "permission denied-marker", expected: "command_failed" },
      { outcome: "spawn_error", spawnErrorCode: "ENOENT", expected: "binary_missing" },
      { outcome: "spawn_error", spawnErrorCode: "EACCES", expected: "command_failed" },
    ];
    for (const testCase of cases) {
      const source = new BitwardenSecretSource({
        settings: () => bitwardenSettings(),
        findBinary: () => "bws-bin",
        run: async () =>
          failedRun(testCase.outcome, {
            ...(testCase.stderr === undefined ? {} : { stderr: testCase.stderr }),
            ...(testCase.spawnErrorCode === undefined
              ? {}
              : { spawnErrorCode: testCase.spawnErrorCode }),
          }),
      });
      const error = await captureSecretSourceError(() => source.resolve("API_KEY"));
      expect(error.code, testCase.outcome).toBe(testCase.expected);
      expect(error.message).not.toContain("marker");
    }
  });

  it("rejects output that is not a secret list", async () => {
    const source = new BitwardenSecretSource({
      settings: () => bitwardenSettings(),
      findBinary: () => "bws-bin",
      run: async () => okRun("<html>login required</html>"),
    });
    const error = await captureSecretSourceError(() => source.resolve("API_KEY"));
    expect(error.code).toBe("invalid_output");
    expect(error.message).not.toContain("login required");
  });

  it("keeps only env-shaped vault keys", () => {
    const secrets = parseBwsSecretList(
      JSON.stringify([
        { key: "API_KEY", value: "value-fixture" },
        { key: "not a key", value: "ignored" },
        { key: "NO_VALUE" },
        { key: 7, value: "ignored" },
        "junk",
        null,
      ]),
    );
    expect(secrets).toEqual({ API_KEY: "value-fixture" });

    const nonJson = captureThrown(() => parseBwsSecretList("not json"));
    expect(nonJson.code).toBe("invalid_output");
    const notAnArray = captureThrown(() => parseBwsSecretList('{"key":"API_KEY"}'));
    expect(notAnArray.code).toBe("invalid_output");
  });

  it("finds the binary in an explicit PATH only", () => {
    const dir = newTempDir();
    const binary = join(dir, executableName("bws"));
    writeFileSync(binary, "");
    try {
      expect(findExecutableInPath("bws", dir)).toBe(binary);
      expect(findExecutableInPath("bws", [dir, dir].join(delimiter))).toBe(binary);
      expect(findExecutableInPath("bws", "")).toBeNull();
      expect(findExecutableInPath("bws", null)).toBeNull();
      expect(findExecutableInPath("isabella-missing-helper", dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("in-process secret cache", () => {
  it("expires entries after the TTL and ignores non-positive TTLs", async () => {
    cacheSet("namespace", "API_KEY", "value-fixture", 40);
    expect(cacheGet("namespace", "API_KEY")).toBe("value-fixture");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cacheGet("namespace", "API_KEY")).toBeNull();

    cacheSet("namespace", "API_KEY", "value-fixture", 0);
    expect(cacheGet("namespace", "API_KEY")).toBeNull();
  });

  it("clears one namespace at a time (post-rotation)", () => {
    cacheSet("a", "API_KEY", "one", 1_000);
    cacheSet("b", "API_KEY", "two", 1_000);
    cacheClear("a");
    expect(cacheGet("a", "API_KEY")).toBeNull();
    expect(cacheGet("b", "API_KEY")).toBe("two");
    cacheClear();
    expect(cacheGet("b", "API_KEY")).toBeNull();
  });
});

describe("facade", () => {
  it("builds the source selected by the configuration", () => {
    expect(getSecretSource("env")).toBeInstanceOf(EnvSecretSource);
    expect(getSecretSource("command")).toBeInstanceOf(CommandSecretSource);
    expect(getSecretSource("bitwarden")).toBeInstanceOf(BitwardenSecretSource);
  });

  it("rejects a key name that is not env-shaped", async () => {
    const error = await captureSecretSourceError(() => resolveSecret("not a key"));
    expect(error.code).toBe("invalid_key");
  });
});

describe("fail-closed facade against the real environment", () => {
  const touched = [
    "GEMINI_API_KEY",
    "ISABELLA_SECRET_SOURCE",
    "ISABELLA_SECRET_COMMAND",
    "BWS_ACCESS_TOKEN",
    "BWS_PROJECT_ID",
    "BWS_SERVER_URL",
  ];
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of touched) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
    resetConfigCache();
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
    resetConfigCache();
  });

  it("resolves a configured value through the default env source", async () => {
    process.env.GEMINI_API_KEY = " plaintext-fixture ";
    resetConfigCache();
    await expect(resolveSecret("GEMINI_API_KEY")).resolves.toBe("plaintext-fixture");
  });

  it("requireSecret raises MissingSecretError instead of inventing a value", async () => {
    await expect(requireSecret("GEMINI_API_KEY")).rejects.toBeInstanceOf(MissingSecretError);
  });

  it("never falls back from bitwarden to a plaintext env value", async () => {
    process.env.GEMINI_API_KEY = "plaintext-fixture";
    resetConfigCache();
    const error = await captureSecretSourceError(() =>
      resolveSecret("GEMINI_API_KEY", { source: "bitwarden" }),
    );
    expect(error.code).toBe("not_configured");
    expect(error.message).not.toContain("plaintext-fixture");
  });

  it("rejects an unconfigured command source instead of returning a value", async () => {
    await expect(resolveSecret("API_KEY", { source: "command" })).rejects.toBeInstanceOf(
      SecretSourceError,
    );
  });
});
