import { createFileRoute } from "@tanstack/react-router";
import { withSovereignAuth } from "@/lib/principal-context";
import {
  HypercoreTTLCache,
  decideHypercore,
  executeHypercore,
} from "@/lib/acceleration/hypercore";
import { createProductionHypercoreAdapters } from "@/lib/acceleration/hypercore-adapters";

/**
 * Superficie TanStack/Nitro de Hypercore.
 * Comparte el mismo motor que la superficie Express (`src/lib/acceleration/hypercore.ts`).
 * La autoridad final se conserva: Hypercore acelera, no autoriza.
 */

const cache = new HypercoreTTLCache();

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function parseSignals(body: unknown): {
  latencyBudgetMs: number;
  complexityScore: number;
  risk: "low" | "medium" | "high" | "critical";
  policyFingerprint: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const latencyBudgetMs = typeof b.latencyBudgetMs === "number" ? b.latencyBudgetMs : 5000;
  const complexityScore = typeof b.complexityScore === "number" ? b.complexityScore : 0;
  const risk = (typeof b.risk === "string" ? b.risk : "low") as
    "low" | "medium" | "high" | "critical";
  const policyFingerprint =
    typeof b.policyFingerprint === "string" ? b.policyFingerprint : "policy-v1";
  if (!["low", "medium", "high", "critical"].includes(risk)) return null;
  if (!Number.isFinite(latencyBudgetMs) || !Number.isFinite(complexityScore)) return null;
  return { latencyBudgetMs, complexityScore, risk, policyFingerprint };
}

export const Route = createFileRoute("/api/v1/isabella-hypercore")({
  server: {
    handlers: {
      GET: withSovereignAuth("chat", "execute", async () =>
        json({
          ok: true,
          subsystem: "Isabella Hypercore — aceleración adaptativa gobernada",
          schema: "isabella.hypercore.decision.v1",
          turbos: {
            VECTOR: ["PREFIX_CACHE", "SEMANTIC_CACHE"],
            SPECULATIVE: ["DRAFT_MODEL", "PARALLEL_BRANCHES"],
            VERITAS: ["VERIFIER_FANOUT", "EARLY_EXIT"],
          },
          modes: ["CRUISE", "BOOST", "HYPERBOOST"],
          invariant:
            "Ningún turbo concede autoridad. El mandatoryGate (policy + evidence + safety) siempre se ejecuta.",
          timestamp: new Date().toISOString(),
        }),
      ),
      POST: withSovereignAuth("chat", "execute", async (context, _request, body) => {
        const incoming = (body ?? {}) as Record<string, unknown>;
        if (incoming.op === "decide") {
          const signals = parseSignals(incoming);
          if (!signals) return json({ ok: false, error: "invalid_signals" }, 400);
          const decision = decideHypercore(signals);
          return json({ ok: true, schema: decision.schema, decision });
        }

        // Vinculación de identidad: el tenant/usuario proviene del principal autenticado,
        // nunca del cuerpo de la petición (aislamiento multi-tenant, AGENTS.md §5).
        if (!context.tenantId) {
          return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
        }
        const payload = { ...incoming, tenantId: context.tenantId, userId: context.userId };

        const result = await executeHypercore(
          payload,
          createProductionHypercoreAdapters({
            tenantId: context.tenantId,
            userId: context.userId,
            roles: context.role ? [context.role] : [],
            scopes: context.scope ? context.scope.split(" ") : [],
          }),
          { cache },
        );
        const status = result.ok
          ? 200
          : result.reason === "deadline_during_verification" || result.reason === "deadline_exceeded"
            ? 504
            : typeof result.reason === "string" && result.reason.startsWith("invalid_")
              ? 400
              : 422;
        return json(result, status);
      }),
    },
  },
});
