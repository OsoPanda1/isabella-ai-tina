import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../../src/lib/repositories/bookpi-postgres-repository", () => ({
  createBookpiPostgresRepository: () => ({
    append: async () => ({ success: true, block: { index: 42 } }),
  }),
}));
import {
  detectSkillInvocation,
  executeChatSkillBridge,
  streamChatSkillAsSse,
  bindChatSkillStream,
} from "../../src/lib/skills/chat-bridge";
import * as runSkillModule from "../../src/lib/skills/run-skill";

describe("Chat-to-Skill Stream Bridge Utility", () => {
  describe("detectSkillInvocation", () => {
    it("detecta `@skill:<nombre>` con argumentos de texto", () => {
      const inv = detectSkillInvocation("@skill:hepta consulta territorial nodo cero");
      expect(inv).not.toBeNull();
      expect(inv?.canonicalName).toBe("HEPTA");
      expect(inv?.parsedInput).toMatchObject({
        query: "consulta territorial nodo cero",
      });
    });

    it("detecta `@skill <nombre>` con JSON embebido", () => {
      const inv = detectSkillInvocation('@skill gaia {"query": "clima", "region": "hidalgo"}');
      expect(inv).not.toBeNull();
      expect(inv?.canonicalName).toBe("GAIA");
      expect(inv?.parsedInput).toMatchObject({
        query: "clima",
        region: "hidalgo",
      });
    });

    it("detecta `@<nombre>` para skills registradas", () => {
      const inv = detectSkillInvocation("@sophia investigar historia territorial");
      expect(inv).not.toBeNull();
      expect(inv?.canonicalName).toBe("SOPHIA");
    });

    it("ignora texto conversacional ordinario o menciones no registradas", () => {
      expect(detectSkillInvocation("Hola Isabella, ¿cómo estás hoy?")).toBeNull();
      expect(detectSkillInvocation("@personaAleatoria hola")).toBeNull();
      expect(detectSkillInvocation("")).toBeNull();
    });
  });

  describe("executeChatSkillBridge", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      if (!process.env.DATABASE_URL)
        process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?sslmode=disable";
    });

    it("ejecuta a través de runIsabellaSkill con auth, CROWN y BookPI evidence logging", async () => {
      const runSpy = vi.spyOn(runSkillModule, "runIsabellaSkill").mockResolvedValue({
        status: "success",
        data: { summary: "Análisis completado", status: "completed" },
        meta: {
          decision_id: "crown_dec_123",
          trace_id: "trace_abc",
          timestamp: new Date().toISOString(),
        },
      } as any);

      const inv = detectSkillInvocation("@hepta balance territorial")!;
      const result = await executeChatSkillBridge(inv, {
        correlationId: "req-test-1",
        traceId: "trace-test-1",
        userId: "user-alice",
        tenantId: "tenant-rdm",
        role: "Operator",
        ip: "10.0.0.1",
      });

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith(
        inv.skillId,
        inv.parsedInput,
        expect.objectContaining({
          requestId: "req-test-1",
          actorId: "user-alice",
          tenantId: "tenant-rdm",
          role: "Operator",
          authenticated: true,
          ipAddress: "10.0.0.1",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.bookpiLogged).toBe(true);
      expect(result.decisionId).toBeDefined();
      expect(result.traceId).toBeDefined();
      expect(result.content).toContain("⚡ **Habilidad Soberana Ejecutada: `HEPTA`**");
      expect(result.content).toContain("Gobernanza CROWN");
      expect(result.content).toContain("Evidencia BookPI");
    });

    it("captura denegaciones de política CROWN estructuradas", async () => {
      const error: any = new Error("Acceso denegado por política centralizada.");
      error.code = "CROWN_POLICY_DENY";
      vi.spyOn(runSkillModule, "runIsabellaSkill").mockRejectedValue(error);

      const inv = detectSkillInvocation("@hepta ejecutar sin permisos")!;
      const result = await executeChatSkillBridge(inv, {
        correlationId: "req-denied",
        traceId: "trace-denied",
        userId: "guest",
        tenantId: "tenant-rdm",
        role: "Guest",
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("CROWN_POLICY_DENY");
      expect(result.bookpiLogged).toBe(false);
      expect(result.content).toContain("Ejecución Bloqueada");
    });
  });

  describe("streamChatSkillAsSse & bindChatSkillStream", () => {
    it("produce una respuesta SSE legible con marco metadata, delta y [DONE]", async () => {
      const mockResult = {
        success: true,
        content: "Salida del skill",
        skillId: "HEPTA",
        decisionId: "dec_1",
        traceId: "tr_1",
        bookpiLogged: true,
      };

      const headers = new Headers({ "content-type": "text/event-stream" });
      const response = streamChatSkillAsSse(mockResult, headers);
      expect(response.status).toBe(200);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }

      expect(text).toContain("isabella-skill-runtime");
      expect(text).toContain("Salida del skill");
      expect(text).toContain("data: [DONE]");
    });

    it("bindChatSkillStream retorna handled: false para mensajes ordinarios", async () => {
      const bind = await bindChatSkillStream(
        "Mensaje normal",
        {
          correlationId: "c1",
          traceId: "t1",
          userId: "u1",
          tenantId: "t1",
          role: "User",
        },
        () => new Headers(),
      );

      expect(bind.handled).toBe(false);
      expect(bind.response).toBeUndefined();
    });
  });
});
