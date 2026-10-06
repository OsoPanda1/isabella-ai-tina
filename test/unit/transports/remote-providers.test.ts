import { afterEach, describe, expect, it, vi } from "vitest";
import { selectRemoteProviders, type RemoteProviderEnv } from "@/lib/intelligence";
import { AnthropicProvider } from "@/lib/intelligence/anthropic-provider";
import { BedrockProvider } from "@/lib/intelligence/bedrock-provider";
import type { IntelligenceRequest, IntelligenceMessage } from "@/lib/intelligence/contracts";

/**
 * Contrato fail-closed de los proveedores remotos
 * (test/unit/transports/remote-providers.test.ts)
 * -------------------------------------------------------------------
 * Anthropic y Bedrock son capas nuevas del plano de inteligencia. Este test
 * fija la regla que los gobierna: sin credenciales Y modelo declarados no hay
 * registro, no hay `health` y no hay `invoke`. Ninguna petición sale de la red
 * en este archivo: solo se verifica que el corte ocurre ANTES del egress.
 */

const EMPTY: RemoteProviderEnv = {
  ANTHROPIC_API_KEY: undefined,
  ANTHROPIC_MODEL: undefined,
  BEDROCK_ENABLED: false,
  BEDROCK_MODEL: undefined,
  BEDROCK_REGION: undefined,
};

function request(): IntelligenceRequest {
  const messages: IntelligenceMessage[] = [{ role: "user", content: "hola" }];
  return {
    requestId: "req-remote-1",
    tenantId: "tenant-1",
    actorId: "actor-1",
    messages,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("selectRemoteProviders · fail-closed", () => {
  it("no registra nada con el entorno vacío", () => {
    expect(selectRemoteProviders(EMPTY)).toEqual([]);
  });

  it("con clave pero sin modelo declarado no construye el proveedor Anthropic", () => {
    expect(selectRemoteProviders({ ...EMPTY, ANTHROPIC_API_KEY: "sk-ant-test" })).toEqual([]);
  });

  it("con modelo pero sin clave no construye el proveedor Anthropic", () => {
    expect(selectRemoteProviders({ ...EMPTY, ANTHROPIC_MODEL: "claude-test" })).toEqual([]);
  });

  it("con clave Y modelo registra Anthropic con el modelo declarado", () => {
    const providers = selectRemoteProviders({
      ...EMPTY,
      ANTHROPIC_API_KEY: "sk-ant-test",
      ANTHROPIC_MODEL: "claude-test",
    });
    expect(providers).toHaveLength(1);
    expect(providers[0]?.providerId).toBe("anthropic-messages");
    expect(providers[0]?.modelId).toBe("claude-test");
  });

  it("Bedrock exige el flag además de modelo y región", () => {
    expect(
      selectRemoteProviders({
        ...EMPTY,
        BEDROCK_ENABLED: true,
        BEDROCK_MODEL: "anthropic.claude-test",
      }),
    ).toEqual([]);
    expect(
      selectRemoteProviders({
        ...EMPTY,
        BEDROCK_ENABLED: true,
        BEDROCK_REGION: "us-east-1",
      }),
    ).toEqual([]);
    const providers = selectRemoteProviders({
      ...EMPTY,
      BEDROCK_ENABLED: true,
      BEDROCK_MODEL: "anthropic.claude-test",
      BEDROCK_REGION: "us-east-1",
    });
    expect(providers).toHaveLength(1);
    expect(providers[0]?.providerId).toBe("bedrock-converse");
    expect(providers[0]?.modelId).toBe("anthropic.claude-test");
  });

  it("nunca devuelve proveedores production-authorized por sí solo", () => {
    // El selector es descubrimiento de capacidad: la aprobación vive en
    // production-model-gate, fuera de esta función.
    const providers = selectRemoteProviders({
      ANTHROPIC_API_KEY: "sk-ant-test",
      ANTHROPIC_MODEL: "claude-test",
      BEDROCK_ENABLED: true,
      BEDROCK_MODEL: "anthropic.claude-test",
      BEDROCK_REGION: "us-east-1",
    });
    expect(providers.map((provider) => provider.providerId)).toEqual([
      "anthropic-messages",
      "bedrock-converse",
    ]);
  });
});

describe("AnthropicProvider · credenciales ausentes", () => {
  it("health devuelve false sin ANTHROPIC_API_KEY", async () => {
    const provider = new AnthropicProvider("claude-test");
    await expect(provider.health()).resolves.toBe(false);
  });

  it("health devuelve true con ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const provider = new AnthropicProvider("claude-test");
    await expect(provider.health()).resolves.toBe(true);
  });

  it("invoke corta antes del egress cuando falta la clave", async () => {
    const provider = new AnthropicProvider("claude-test");
    await expect(provider.invoke(request())).rejects.toThrow(/Anthropic API key is not configured/);
  });
});

describe("BedrockProvider · credenciales y región", () => {
  it("health devuelve false sin credenciales AWS", async () => {
    const provider = new BedrockProvider("anthropic.claude-test", "us-east-1");
    await expect(provider.health()).resolves.toBe(false);
  });

  it("health devuelve false con credenciales pero región malformada", async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "SECRETKEYEXAMPLE");
    const provider = new BedrockProvider("anthropic.claude-test", "US EAST 1!!");
    await expect(provider.health()).resolves.toBe(false);
  });

  it("health devuelve true con credenciales y región bien formada", async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "SECRETKEYEXAMPLE");
    const provider = new BedrockProvider("anthropic.claude-test", "us-east-1");
    await expect(provider.health()).resolves.toBe(true);
  });

  it("invoke corta antes del egress cuando faltan credenciales", async () => {
    const provider = new BedrockProvider("anthropic.claude-test", "us-east-1");
    await expect(provider.invoke(request())).rejects.toThrow(/bedrock_credentials_missing/);
  });

  it("invoke corta antes del egress con región malformada", async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "SECRETKEYEXAMPLE");
    const provider = new BedrockProvider("anthropic.claude-test", "US EAST 1!!");
    await expect(provider.invoke(request())).rejects.toThrow(/bedrock_region_invalid/);
  });
});
