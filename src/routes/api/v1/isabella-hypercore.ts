import { createFileRoute } from "@tanstack/react-router";
import { withSovereignAuth } from "@/lib/principal-context";
import { isProductionLike } from "@/lib/runtime-mode";
import {
  HypercoreTTLCache,
  decideHypercore,
  deterministicHypercoreAdapter,
  executeHypercore,
} from "@/lib/acceleration/hypercore";

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
      POST: withSovereignAuth("chat", "execute", async (_context, _request, body) => {
        const payload = (body ?? {}) as Record<string, unknown>;
        if (payload.op === "decide") {
          const signals = parseSignals(payload);
          if (!signals) return json({ ok: false, error: "invalid_signals" }, 400);
          const decision = decideHypercore(signals);
          return json({ ok: true, schema: decision.schema, decision });
        }

        if (isProductionLike()) {
          return json(
            {
              ok: false,
              error: "HYPERCORE_ADAPTERS_UNAVAILABLE",
              message:
                "Hypercore requiere adaptadores productivos (modelo, memoria, política, evidencia, output-security).",
              status: "fail_closed",
            },
            503,
          );
        }

        const result = await executeHypercore(body, deterministicHypercoreAdapter(), { cache });
        const status = result.ok
          ? 200
          : result.reason === "deadline_during_verification" ||
              result.reason === "deadline_exceeded"
            ? 504
            : typeof result.reason === "string" && result.reason.startsWith("invalid_")
              ? 400
              : 422;
        return json(result, status);
      }),
    },
  },
});
