import { describe, expect, it } from "vitest";
import { createOrionEngine } from "@/lib/orion-engine";
import { createToolRegistry } from "@/lib/tool-registry";
import { createRedactor } from "@/lib/secret-redactor";
import {
  authorizeMcpToolCall,
  buildMcpToolContract,
  deriveMcpSideEffects,
  executeMcpToolCall,
  mcpApprovalThreshold,
  sanitizeMcpToolOutput,
  type McpCallerContext,
} from "@/lib/mcp-server/policy";
import { OUTPUT_GATE_REFUSAL } from "@/lib/output-security-gate";

/**
 * CADENA DE AUTORIZACIÓN MCP (test/unit/mcp-server/policy.test.ts)
 * identidad → whitelist → permisos RBAC → política ARGUS → salida.
 */

const registry = createToolRegistry();
const engine = createOrionEngine(registry);

function context(overrides: Partial<McpCallerContext> = {}): McpCallerContext {
  return {
    actorId: "actor_1",
    tenantId: "tenant_1",
    role: "Operator",
    authenticated: true,
    ...overrides,
  };
}

const STRIPE_KEY = `sk_live_${"a1b2c3d4e5f6g7h8i9j0k1l2"}`;
const GITHUB_TOKEN = `ghp_${"abcdefghij0123456789abcdefghij"}`;

describe("derivación de efectos y contrato", () => {
  it("clasifica permisos en none/read/write/financial", () => {
    expect(deriveMcpSideEffects([])).toBe("none");
    expect(deriveMcpSideEffects(["memory:read"])).toBe("read");
    expect(deriveMcpSideEffects(["storage:read"])).toBe("read");
    expect(deriveMcpSideEffects(["memory:write"])).toBe("write");
    expect(deriveMcpSideEffects(["compute:execute"])).toBe("write");
    expect(deriveMcpSideEffects(["ledger:write"])).toBe("financial");
  });

  it("elige umbral de aprobación según efectos", () => {
    expect(mcpApprovalThreshold(buildMcpToolContract(registry.lookup("storage.read")!))).toBe(
      "medium",
    );
    expect(mcpApprovalThreshold(buildMcpToolContract(registry.lookup("memory.record")!))).toBe(
      "low",
    );
  });

  it("refleja el registro en el contrato (AGENTS.md §6.3)", () => {
    const ledger = buildMcpToolContract(registry.lookup("ledger.record")!);
    expect(ledger).toEqual({
      toolName: "ledger.record",
      riskLevel: "high",
      requiredScopes: ["ledger:write"],
      timeoutMs: 1500,
      maxRetries: 0,
      sideEffects: "financial",
      requiresHumanApproval: false,
    });
    expect(buildMcpToolContract(registry.lookup("compute.sandbox")!)).toMatchObject({
      requiresHumanApproval: true,
      sideEffects: "write",
      riskLevel: "critical",
    });
  });
});

describe("authorizeMcpToolCall", () => {
  it("deniega por identidad cuando no está autenticado", () => {
    const result = authorizeMcpToolCall({
      context: context({ authenticated: false }),
      toolName: "memory.retrieve",
      registry,
      engine,
    });
    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.stage).toBe("identity");
  });

  it("deniega por identidad sin tenant o con rol desconocido", () => {
    const noTenant = authorizeMcpToolCall({
      context: context({ tenantId: "" }),
      toolName: "memory.retrieve",
      registry,
      engine,
    });
    expect(noTenant.allowed === false && noTenant.stage).toBe("identity");
    const badRole = authorizeMcpToolCall({
      context: context({ role: "SuperAdmin" as McpCallerContext["role"] }),
      toolName: "memory.retrieve",
      registry,
      engine,
    });
    expect(badRole.allowed === false && badRole.stage).toBe("identity");
  });

  it("deniega herramienta no registrada (unknown-tool)", () => {
    const result = authorizeMcpToolCall({
      context: context(),
      toolName: "shell.exec",
      registry,
      engine,
    });
    expect(result.allowed === false && result.stage).toBe("unknown-tool");
  });

  it("deniega permisos RBAC insuficientes (Guest intenta ledger)", () => {
    const result = authorizeMcpToolCall({
      context: context({ role: "Guest" }),
      toolName: "ledger.record",
      registry,
      engine,
    });
    expect(result.allowed === false && result.stage).toBe("permissions");
    if (result.allowed) return;
    expect(result.reason).toContain("ledger:write");
  });

  it("deniega política cuando el riesgo exige aprobación no otorgada", () => {
    const result = authorizeMcpToolCall({
      context: context(),
      toolName: "ledger.record",
      registry,
      engine,
    });
    expect(result.allowed === false && result.stage).toBe("policy");
    if (result.allowed) return;
    expect(result.reason).toContain("aprobación");
  });

  it("permite con aprobación humana otorgada y emite capability token", () => {
    const result = authorizeMcpToolCall({
      context: context(),
      toolName: "ledger.record",
      registry,
      engine,
      approvals: new Set(["ledger.record"]),
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.capabilityToken).toContain(".");
    expect(result.contract.sideEffects).toBe("financial");
  });

  it("aplica la frontera territorial (fail-closed) a tools de frontera", () => {
    const enforced = authorizeMcpToolCall({
      context: context({ role: "SovereignOwner" }),
      toolName: "compute.sandbox",
      registry,
      engine,
    });
    expect(enforced.allowed === false && enforced.stage).toBe("policy");
    if (!enforced.allowed) expect(enforced.reason).toContain("Frontera territorial");

    const relaxed = authorizeMcpToolCall({
      context: context({ role: "SovereignOwner" }),
      toolName: "compute.sandbox",
      registry,
      engine,
      territorialBoundaryEnforced: false,
    });
    expect(relaxed.allowed === false && relaxed.stage).toBe("policy");
    if (!relaxed.allowed) expect(relaxed.reason).toContain("aprobación");
  });

  it("permite lectura autenticada de Guest con token de uso único", () => {
    const result = authorizeMcpToolCall({
      context: context({ role: "Guest" }),
      toolName: "memory.retrieve",
      registry,
      engine,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.contract.sideEffects).toBe("read");
  });
});

describe("sanitizeMcpToolOutput", () => {
  it("redacta claves Stripe sin bloquear la salida", () => {
    const result = sanitizeMcpToolOutput(`valor: ${STRIPE_KEY}`);
    expect(result.allowed).toBe(true);
    expect(result.text).not.toContain(STRIPE_KEY);
    expect(result.text).toContain("[REDACTED_STRIPE_KEY]");
  });

  it("bloquea credenciales de alto valor con la negativa canónica", () => {
    const result = sanitizeMcpToolOutput(`token ${GITHUB_TOKEN} visible`);
    expect(result.allowed).toBe(false);
    expect(result.text).toBe(OUTPUT_GATE_REFUSAL);
    expect(result.text).not.toContain(GITHUB_TOKEN);
  });

  it("deja pasar contenido ordinario", () => {
    const result = sanitizeMcpToolOutput("Contexto de memoria recuperado para el tenant.");
    expect(result.allowed).toBe(true);
    expect(result.text).toBe("Contexto de memoria recuperado para el tenant.");
  });
});

describe("executeMcpToolCall (motor inyectado)", () => {
  const authorization = (() => {
    const result = authorizeMcpToolCall({
      context: context(),
      toolName: "storage.read",
      registry,
      engine,
    });
    if (!result.allowed) throw new Error("autorización inesperada");
    return result;
  })();

  it("convierte un fallo de ORION en denegación de ejecución", async () => {
    const outcome = await executeMcpToolCall({
      authorization,
      args: { tenantId: "t1" },
      engine: {
        execute: async () => ({
          status: "denied" as const,
          toolName: "storage.read",
          output: "",
          exitCode: 403,
          executionTimeMs: 1,
          verificationHash: "h",
          traceId: "tr",
          error: "capability_token_replayed",
        }),
      },
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.stage).toBe("execution");
    expect(outcome.text).toBe("capability_token_replayed");
  });

  it("nunca propaga excepciones: fallo interno vuelve fail-closed", async () => {
    const outcome = await executeMcpToolCall({
      authorization,
      args: {},
      engine: {
        execute: async () => {
          throw new Error("boom con api_key=ABCDEFGH12345678");
        },
      },
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.stage).toBe("execution");
    expect(outcome.text).toContain("fallo interno");
  });

  it("deniega en la compuerta de salida cuando ORION devuelve secretos", async () => {
    const outcome = await executeMcpToolCall({
      authorization,
      args: {},
      engine: {
        execute: async () => ({
          status: "executed" as const,
          toolName: "storage.read",
          output: `dato ${GITHUB_TOKEN}`,
          exitCode: 0,
          executionTimeMs: 1,
          verificationHash: "h",
          traceId: "tr",
        }),
      },
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.stage).toBe("output");
    expect(outcome.text).toBe(OUTPUT_GATE_REFUSAL);
  });

  it("devuelve texto saneado cuando la salida es segura", async () => {
    const outcome = await executeMcpToolCall({
      authorization,
      args: {},
      engine: {
        execute: async () => ({
          status: "executed" as const,
          toolName: "storage.read",
          output: `lectura con ${STRIPE_KEY}`,
          exitCode: 0,
          executionTimeMs: 1,
          verificationHash: "h",
          traceId: "tr",
        }),
      },
    });
    expect(outcome.isError).toBe(false);
    expect(outcome.text).not.toContain(STRIPE_KEY);
    expect(outcome.text).toContain("[REDACTED_STRIPE_KEY]");
  });
});

describe("redactor del sistema en mensajes de denegación", () => {
  it("redacta api_key=... en motivos antes de salir del proceso", () => {
    const { redact } = createRedactor();
    const line = redact(JSON.stringify({ reason: "fallo api_key=ABCDEFGH1234567890" }));
    expect(line).not.toContain("ABCDEFGH1234567890");
    expect(line).toContain("api_key=[REDACTED]");
  });
});
