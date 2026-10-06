import { describe, expect, it } from "vitest";
import { executeConversationalSkill } from "@/lib/isabella-skill-executor";

const baseContext = {
  requestId: "req-test",
  traceId: "trace-test",
  actorId: "actor-test",
  tenantId: "tenant-test",
  scope: "isabella:chat",
  locale: "es-MX",
};

describe("governed conversational skill bridge", () => {
  it("rejects an unregistered skill without invoking a runtime", async () => {
    const result = await executeConversationalSkill("@does-not-exist consulta", baseContext);

    expect(result.matched).toBe(true);
    expect(result).toMatchObject({
      blocked: true,
      code: "SKILL_NOT_FOUND",
    });
  });

  it("enforces declared scopes before execution", async () => {
    const result = await executeConversationalSkill("@voice-synthesis prueba", baseContext);

    expect(result.matched).toBe(true);
    expect(result).toMatchObject({
      blocked: true,
      code: "SKILL_SCOPE_DENIED",
    });
  });

  it("ignores ordinary conversational input", async () => {
    const result = await executeConversationalSkill("hola Isabella", baseContext);

    expect(result).toEqual({ matched: false, result: null });
  });
});
