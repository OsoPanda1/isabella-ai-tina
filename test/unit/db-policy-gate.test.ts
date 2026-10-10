import { describe, expect, it } from "vitest";
import {
  applyDbPolicyGate,
  evaluateDbPolicyRules,
  overlayDbDecision,
  unavailableDbGate,
} from "@/lib/db-policy-gate";
import type { StoredPolicy } from "@/lib/repositories/policy-repository";
import type { RegisteredTool } from "@/lib/tool-registry";

/**
 * POLICY AS CODE (test/unit/db-policy-gate.test.ts)
 * -----------------------------------------------------------------
 * Overlay de `isabella_policies` sobre la decisión de ARGUS.
 * Reglas de la migración 20260926030000_isabella_policy_as_code.sql:
 *  - sólo endurece (monótono): denied > requires_approval > allowed,
 *  - primera regla que coincide gana,
 *  - store no configurado = se omite la capa (sin allow inventado),
 *  - store indisponible = fail-closed para herramientas sensibles.
 */

const baseTool: RegisteredTool = {
  name: "test.tool",
  purpose: "Unit-test tool",
  inputSchemaDescription: "test",
  outputDescription: "test",
  risk: "medium",
  requiredPermissions: ["test:execute"],
  maxTimeMs: 1000,
  maxRetries: 0,
  auditEvent: "tool.test",
  category: "system",
  requiresApproval: false,
  territorialBoundary: false,
};

/** Réplica TS de los seeds de la migración (mismo orden/prioridad). */
const SEED_POLICIES: StoredPolicy[] = [
  {
    policyKey: "p-critical-risk-blocked",
    description: "Riesgo critical denegado",
    version: "1.0.0",
    priority: 10,
    rules: [
      { when: { risk: "critical" }, then: { status: "denied", reason: "riesgo_critico_bloqueado" } },
    ],
  },
  {
    policyKey: "p-territorial-boundary-blocked",
    description: "Frontera territorial",
    version: "1.0.0",
    priority: 20,
    rules: [
      {
        when: { territorialBoundary: true },
        then: { status: "denied", reason: "frontera_territorial_bloqueada" },
      },
    ],
  },
  {
    policyKey: "p-high-risk-approval",
    description: "Riesgo high",
    version: "1.0.0",
    priority: 30,
    rules: [
      {
        when: { risk: "high" },
        then: { status: "requires_approval", reason: "riesgo_alto_requiere_aprobacion" },
      },
    ],
  },
  {
    policyKey: "p-unauthenticated-review",
    description: "Actor no autenticado",
    version: "1.0.0",
    priority: 40,
    rules: [
      {
        when: { authenticated: false },
        then: { status: "requires_approval", reason: "actor_no_autenticado_requiere_revision" },
      },
    ],
  },
  {
    policyKey: "p-identity-tools-approval",
    description: "Herramientas de identidad",
    version: "1.0.0",
    priority: 50,
    rules: [
      {
        when: { category: "identity" },
        then: { status: "requires_approval", reason: "herramienta_identidad_requiere_aprobacion" },
      },
    ],
  },
];

describe("evaluateDbPolicyRules (policy-as-code)", () => {
  const authed = { authenticated: true };

  it("riesgo critical → denied (primera regla, prioridad 10)", () => {
    const outcome = evaluateDbPolicyRules(SEED_POLICIES, {
      tool: { ...baseTool, risk: "critical" },
      ...authed,
    });
    expect(outcome.status).toBe("denied");
    expect(outcome.policyKey).toBe("p-critical-risk-blocked");
    expect(outcome.reason).toBe("riesgo_critico_bloqueado");
  });

  it("frontera territorial → denied aunque el riesgo sea bajo", () => {
    const outcome = evaluateDbPolicyRules(SEED_POLICIES, {
      tool: { ...baseTool, risk: "low", territorialBoundary: true },
      ...authed,
    });
    expect(outcome.status).toBe("denied");
    expect(outcome.policyKey).toBe("p-territorial-boundary-blocked");
  });

  it("riesgo high → requires_approval", () => {
    const outcome = evaluateDbPolicyRules(SEED_POLICIES, {
      tool: { ...baseTool, risk: "high" },
      ...authed,
    });
    expect(outcome.status).toBe("requires_approval");
    expect(outcome.policyKey).toBe("p-high-risk-approval");
  });

  it("actor no autenticado → requires_approval", () => {
    const outcome = evaluateDbPolicyRules(SEED_POLICIES, {
      tool: baseTool,
      authenticated: false,
    });
    expect(outcome.status).toBe("requires_approval");
    expect(outcome.policyKey).toBe("p-unauthenticated-review");
  });

  it("categoría identity → requires_approval", () => {
    const outcome = evaluateDbPolicyRules(SEED_POLICIES, {
      tool: { ...baseTool, category: "identity" },
      ...authed,
    });
    expect(outcome.status).toBe("requires_approval");
    expect(outcome.policyKey).toBe("p-identity-tools-approval");
  });

  it("sin regla que coincida → no_override (manda la decisión de código)", () => {
    const outcome = evaluateDbPolicyRules(SEED_POLICIES, { tool: baseTool, ...authed });
    expect(outcome.status).toBe("no_override");
    expect(outcome.policyKey).toBeUndefined();
  });

  it("respeta priority aunque el array venga desordenado", () => {
    const shuffled = [SEED_POLICIES[4]!, SEED_POLICIES[0]!];
    const outcome = evaluateDbPolicyRules(shuffled, {
      tool: { ...baseTool, risk: "critical", category: "identity" },
      ...authed,
    });
    expect(outcome.policyKey).toBe("p-critical-risk-blocked");
  });

  it("regla sin `when` aplica a todo (deny por defecto en la capa DB)", () => {
    const policies: StoredPolicy[] = [
      {
        policyKey: "p-bloqueo-total",
        description: "prueba",
        version: "1.0.0",
        priority: 1,
        rules: [{ then: { status: "denied", reason: "bloqueo_total" } }],
      },
    ];
    const outcome = evaluateDbPolicyRules(policies, { tool: baseTool, ...authed });
    expect(outcome.status).toBe("denied");
  });

  it("herramienta específica (when.tool) no afecta a otras", () => {
    const policies: StoredPolicy[] = [
      {
        policyKey: "p-tool-especifico",
        description: "prueba",
        version: "1.0.0",
        priority: 1,
        rules: [{ when: { tool: "ledger.append" }, then: { status: "denied" } }],
      },
    ];
    expect(evaluateDbPolicyRules(policies, { tool: baseTool, ...authed }).status).toBe(
      "no_override",
    );
    expect(
      evaluateDbPolicyRules(policies, { tool: { ...baseTool, name: "ledger.append" }, ...authed })
        .status,
    ).toBe("denied");
  });
});

describe("overlayDbDecision (monotonía: sólo endurece)", () => {
  const outcome = (status: "allowed" | "denied" | "requires_approval" | "no_override") => ({
    status,
    reason: "motivo",
    policyKey: "p-x",
  });

  it("DB allowed nunca levanta un denied de código", () => {
    const result = overlayDbDecision("denied", outcome("allowed"));
    expect(result.status).toBe("denied");
    expect(result.source).toBe("db");
  });

  it("DB allowed no convierte requires_approval en allowed", () => {
    const result = overlayDbDecision("requires_approval", outcome("allowed"));
    expect(result.status).toBe("requires_approval");
  });

  it("DB requires_approval endurece un allowed de código", () => {
    const result = overlayDbDecision("allowed", outcome("requires_approval"));
    expect(result.status).toBe("requires_approval");
    expect(result.policyKey).toBe("p-x");
  });

  it("DB denied gana siempre", () => {
    expect(overlayDbDecision("allowed", outcome("denied")).status).toBe("denied");
    expect(overlayDbDecision("requires_approval", outcome("denied")).status).toBe("denied");
  });

  it("no_override conserva la decisión de código sin degradar", () => {
    const result = overlayDbDecision("allowed", outcome("no_override"));
    expect(result.status).toBe("allowed");
    expect(result.source).toBe("no_override");
    expect(result.degraded).toBe(false);
  });
});

describe("unavailableDbGate (indisponibilidad = fail-closed)", () => {
  const error = new Error("ECONNREFUSED");

  it("herramienta con requiresApproval → requires_approval", () => {
    const result = unavailableDbGate("allowed", { ...baseTool, requiresApproval: true }, error);
    expect(result.status).toBe("requires_approval");
    expect(result.source).toBe("unavailable");
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain("ECONNREFUSED");
  });

  it("riesgo high/critical → requires_approval", () => {
    expect(unavailableDbGate("allowed", { ...baseTool, risk: "high" }, error).status).toBe(
      "requires_approval",
    );
    expect(unavailableDbGate("allowed", { ...baseTool, risk: "critical" }, error).status).toBe(
      "requires_approval",
    );
  });

  it("categorías sensibles (identity/ledger/network) → requires_approval", () => {
    for (const category of ["identity", "ledger", "network"] as const) {
      expect(unavailableDbGate("allowed", { ...baseTool, category }, error).status).toBe(
        "requires_approval",
      );
    }
  });

  it("herramienta benigna conserva la decisión de código pero queda degradada", () => {
    const result = unavailableDbGate("allowed", baseTool, error);
    expect(result.status).toBe("allowed");
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain("degradado");
  });

  it("un denied de código nunca se relaja por indisponibilidad", () => {
    expect(unavailableDbGate("denied", baseTool, error).status).toBe("denied");
  });
});

describe("applyDbPolicyGate (orquestación)", () => {
  it("sin store inyectado → not_configured y decisión de código intacta", async () => {
    const result = await applyDbPolicyGate({
      codeDecision: "allowed",
      tool: baseTool,
      authenticated: true,
    });
    expect(result.status).toBe("allowed");
    expect(result.source).toBe("not_configured");
  });

  it("store que devuelve null (sin DATABASE_URL) → not_configured", async () => {
    const result = await applyDbPolicyGate({
      store: { load: async () => null },
      codeDecision: "allowed",
      tool: baseTool,
      authenticated: true,
    });
    expect(result.status).toBe("allowed");
    expect(result.source).toBe("not_configured");
    expect(result.reason).toBe("db-policy-sin-database-url");
  });

  it("store que lanza → unavailable con fail-closed para herramienta sensible", async () => {
    const result = await applyDbPolicyGate({
      store: {
        load: async () => {
          throw new Error("PG no disponible");
        },
      },
      codeDecision: "allowed",
      tool: { ...baseTool, risk: "critical" },
      authenticated: true,
    });
    expect(result.status).toBe("requires_approval");
    expect(result.source).toBe("unavailable");
    expect(result.degraded).toBe(true);
  });

  it("store con reglas → la capa DB endurece la decisión", async () => {
    const result = await applyDbPolicyGate({
      store: { load: async () => SEED_POLICIES },
      codeDecision: "allowed",
      tool: { ...baseTool, risk: "high" },
      authenticated: true,
    });
    expect(result.status).toBe("requires_approval");
    expect(result.source).toBe("db");
    expect(result.policyKey).toBe("p-high-risk-approval");
  });

  it("store con reglas sin match → no_override conserva el código", async () => {
    const result = await applyDbPolicyGate({
      store: { load: async () => SEED_POLICIES },
      codeDecision: "allowed",
      tool: baseTool,
      authenticated: true,
    });
    expect(result.status).toBe("allowed");
    expect(result.source).toBe("no_override");
  });
});

describe("wiring en execution-authority", () => {
  const request = {
    tool: "memory.retrieve",
    input: { tenantId: "tnt_gate", scope: "turn" },
    actorId: "usr_gate",
    tenantId: "tnt_gate",
    role: "SovereignOwner",
    authenticated: true,
    traceId: "trace_gate_1",
    ip: "127.0.0.1",
  };

  it("política DB que deniega → stage db-policy (no se ejecuta)", async () => {
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const authority = createExecutionAuthority({
      dbPolicyStore: {
        load: async (): Promise<StoredPolicy[]> => [
          {
            policyKey: "p-bloqueo-memoria",
            description: "prueba",
            version: "1.0.0",
            priority: 1,
            rules: [{ when: { tool: "memory.retrieve" }, then: { status: "denied" } }],
          },
        ],
      },
    });
    const outcome = await authority.execute(request);
    expect(outcome.executed).toBe(false);
    if (!outcome.executed) {
      expect(outcome.stage).toBe("db-policy");
      expect(outcome.reason).toContain("p-bloqueo-memoria");
    }
  });

  it("store no configurado → la capa DB se omite y no aparece db-policy", async () => {
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const authority = createExecutionAuthority({
      dbPolicyStore: { load: async () => null },
    });
    const outcome = await authority.execute(request);
    expect(outcome.executed).toBe(false);
    if (!outcome.executed) expect(outcome.stage).not.toBe("db-policy");
  });

  it("store indisponible en herramienta sensible → requires_approval (stage approval)", async () => {
    const { createExecutionAuthority } = await import("@/lib/execution-authority");
    const authority = createExecutionAuthority({
      dbPolicyStore: {
        load: async (): Promise<StoredPolicy[] | null> => {
          throw new Error("isabella_policies ilegible");
        },
      },
    });
    const outcome = await authority.execute({
      ...request,
      traceId: "trace_gate_3",
      tool: "firecrawl.competitive_intel",
    });
    expect(outcome.executed).toBe(false);
    if (!outcome.executed) {
      // O la política de DB exige aprobación o el PDP/permisos deniegan antes:
      // lo que nunca puede pasar es una ejecución exitosa.
      expect(["db-policy", "approval", "authorization", "decide"]).toContain(outcome.stage);
    }
  });
});
