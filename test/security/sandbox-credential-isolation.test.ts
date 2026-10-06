import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AISLAMIENTO DE CREDENCIALES EN CONTEXTO NO CONFIABLE
 * (test/security/sandbox-credential-isolation.test.ts)
 * -----------------------------------------------------------------
 * El env de un sandbox de contenedor no puede recibir API keys, JWTs,
 * passwords ni URLs de base de datos: si algo califica, el ejecutor NUNCA
 * se invoca (fail-closed). ORION, ademas, nunca propaga args de tool
 * call como env.
 */

import { SovereignSandboxService, type IContainerExecutor } from "@/lib/sovereign-sandbox";
import { credentialEnvNames, isCredentialEnvName } from "@/lib/security/credential-env";
import { createOrionEngine } from "@/lib/orion-engine";
import { issueCapabilityToken } from "@/lib/capability-token";
import { resetConfigCache } from "@/lib/config";

function createExecutor(): {
  executor: IContainerExecutor;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(
    async (
      _command: string[],
      _envVars: Record<string, string>,
      _inputPayload: string,
    ): Promise<{ output: string; memoryConsumedBytes: number; gasTokensConsumed: number }> => ({
      output: "ok",
      memoryConsumedBytes: 1,
      gasTokensConsumed: 1,
    }),
  );
  const executor: IContainerExecutor = {
    provision: vi.fn(async () => {}),
    execute: execute as unknown as IContainerExecutor["execute"],
    deprovision: vi.fn(async () => {}),
  };
  return { executor, execute };
}

beforeEach(() => {
  process.env.ENCRYPTION_MASTER_KEY = "01234567890123456789012345678901";
  process.env.ISABELLA_RUNTIME_MODE = "development";
  resetConfigCache();
});

describe("credential-env: clasificacion de nombres", () => {
  it("vet API keys, JWTs, secretos, passwords y service-role keys", () => {
    for (const name of [
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "AUTH_JWT_SECRET",
      "STRIPE_SECRET_KEY",
      "DATABASE_URL",
      "DIRECT_URL",
      "REDIS_URL",
      "KV_URL",
      "TURSO_DATABASE_URL",
      "MY_POSTGRES_URL",
      "SUPABASE_DB_URL",
      "PASSWORD",
      "ENCRYPTION_MASTER_KEY",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "SESSION_TOKEN",
      "PRIVATE_KEY",
    ]) {
      expect(isCredentialEnvName(name), name).toBe(true);
    }
  });

  it("NO veta variables benignas de ejecucion", () => {
    for (const name of [
      "LANG",
      "TZ",
      "MODEL_NAME",
      "TIMEOUT_MS",
      "MAX_OUTPUT_LENGTH",
      "ANTHROPIC_BASE_URL",
      "VOICE_API_URL",
      "WEBHOOK_URL",
      "LOG_LEVEL",
      "NODE_ENV",
      "SANDBOX_CPU_QUOTA",
    ]) {
      expect(isCredentialEnvName(name), name).toBe(false);
    }
  });

  it("credentialEnvNames devuelve solo nombres, nunca valores", () => {
    const names = credentialEnvNames({
      ANTHROPIC_API_KEY: "sk-vivo",
      LANG: "en",
      DATABASE_URL: "postgres://user:pass@host/db",
    });
    expect(names.sort()).toEqual(["ANTHROPIC_API_KEY", "DATABASE_URL"]);
    expect(JSON.stringify(names)).not.toContain("sk-vivo");
    expect(JSON.stringify(names)).not.toContain("postgres://");
  });
});

describe("sovereign-sandbox: env de credencial vetado antes del ejecutor", () => {
  it("no invoca el ejecutor si envVars contiene una credencial", async () => {
    const { executor, execute } = createExecutor();
    const sandbox = new SovereignSandboxService("trc_credential_block", undefined, executor);
    await sandbox.provisionInstance("trc_credential_block");

    const result = await sandbox.executeTask(
      ["echo hola"],
      { LANG: "en", ANTHROPIC_API_KEY: "sk-vivo" },
      "payload",
    );

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(403);
    expect(result.output).toBe("");
    expect(execute).not.toHaveBeenCalled();
  });

  it("no invoca el ejecutor si envVars contiene una URL de base de datos", async () => {
    const { executor, execute } = createExecutor();
    const sandbox = new SovereignSandboxService("trc_credential_db", undefined, executor);
    await sandbox.provisionInstance("trc_credential_db");

    const result = await sandbox.executeTask(
      ["echo hola"],
      { DATABASE_URL: "postgres://user:pass@db.internal:5432/app" },
      "payload",
    );

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("permite env benigno y lo reenvia al ejecutor", async () => {
    const { executor, execute } = createExecutor();
    const sandbox = new SovereignSandboxService("trc_credential_benign", undefined, executor);
    await sandbox.provisionInstance("trc_credential_benign");

    const result = await sandbox.executeTask(
      ["echo hola"],
      { LANG: "es", MODEL_NAME: "gemini-3.1-flash" },
      "payload",
    );

    expect(result.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[1]).toEqual({ LANG: "es", MODEL_NAME: "gemini-3.1-flash" });
  });
});

describe("orion-engine: nunca propaga tool args como env del sandbox", () => {
  it("ejecuta compute.sandbox con env {} aunque los args traigan secretos", async () => {
    const { executor, execute } = createExecutor();
    const sandbox = new SovereignSandboxService("trc_orion_env", undefined, executor);
    await sandbox.provisionInstance("trc_orion_env");

    const engine = createOrionEngine();
    const result = await engine.execute(
      {
        toolName: "compute.sandbox",
        args: {
          command: "echo hola",
          ANTHROPIC_API_KEY: "sk-vivo",
          DATABASE_URL: "postgres://user:pass@db",
        },
        traceId: "trc_orion_env",
        correlationId: "cor_orion_env",
        actorIp: "127.0.0.1",
        actorId: "actor-test",
        tenantId: "tenant-test",
        capabilityToken: issueCapabilityToken({
          tool: "compute.sandbox",
          actorId: "actor-test",
          tenantId: "tenant-test",
        }),
      },
      sandbox,
    );

    expect(result.status).toBe("executed");
    expect(execute).toHaveBeenCalledTimes(1);
    // Env siempre vacio: los args viaan solo como inputPayload.
    expect(execute.mock.calls[0]?.[1]).toEqual({});
    expect(execute.mock.calls[0]?.[2]).toContain("sk-vivo");
  }, 15_000);
});
