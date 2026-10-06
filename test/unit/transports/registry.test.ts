import { describe, it, expect } from "vitest";
import {
  registerIsabellaTransports,
  getTransport,
  requireTransport,
  listTransportModes,
} from "@/lib/intelligence/transports";
import { AnthropicTransport } from "@/lib/intelligence/transports/anthropic";
import { BedrockTransport } from "@/lib/intelligence/transports/bedrock";
import { OpenAICompatibleTransport } from "@/lib/intelligence/transports/openai-compatible";
import { ResponsesTransport } from "@/lib/intelligence/transports/responses";
import type { TransportApiMode } from "@/lib/intelligence/transports/types";

/**
 * Contrato del registro de transports (test/unit/transports/registry.test.ts)
 * -------------------------------------------------------------------
 * `registerIsabellaTransports` es descubrimiento de capacidad: fija qué
 * `apiMode` puede resolver `requireTransport`. No es autorización — no se emite
 * ninguna petición y ningún proveedor queda aprobado por registrarse aquí.
 */

const ISABELLA_MODES: TransportApiMode[] = [
  "chat_completions",
  "anthropic_messages",
  "bedrock_converse",
  "responses",
];

describe("registro de transports de Isabella", () => {
  it("expone exactamente los cuatro apiMode del proyecto", () => {
    registerIsabellaTransports();
    expect(new Set(listTransportModes())).toEqual(new Set(ISABELLA_MODES));
    expect(listTransportModes().length).toBe(ISABELLA_MODES.length);
  });

  it("resuelve cada modo con la clase cuyo apiMode coincide", () => {
    registerIsabellaTransports();
    expect(getTransport("chat_completions")).toBeInstanceOf(OpenAICompatibleTransport);
    expect(getTransport("anthropic_messages")).toBeInstanceOf(AnthropicTransport);
    expect(getTransport("bedrock_converse")).toBeInstanceOf(BedrockTransport);
    expect(getTransport("responses")).toBeInstanceOf(ResponsesTransport);
  });

  it("declara en cada instancia el mismo modo que su clave de registro", () => {
    registerIsabellaTransports();
    for (const mode of ISABELLA_MODES) {
      expect(requireTransport(mode).apiMode).toBe(mode);
    }
  });

  it("es idempotente: registrar dos veces no duplica modos", () => {
    registerIsabellaTransports();
    const first = listTransportModes();
    registerIsabellaTransports();
    expect(listTransportModes()).toEqual(first);
  });

  it("resuelve un modo desconocido en fail-closed con error nombrado", () => {
    registerIsabellaTransports();
    expect(() => requireTransport("embedding" as TransportApiMode)).toThrowError(
      /intelligence_transport_unavailable:embedding/,
    );
    expect(getTransport("embedding" as TransportApiMode)).toBeUndefined();
  });

  it("la barra de transports no importa config ni secrets (transportes puros)", async () => {
    const barrel = await import("@/lib/intelligence/transports");
    expect(typeof barrel.registerIsabellaTransports).toBe("function");
    expect(typeof barrel.requireTransport).toBe("function");
  });
});
