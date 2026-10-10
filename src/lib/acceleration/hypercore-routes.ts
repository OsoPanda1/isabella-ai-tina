import { Router } from "express";
import { authenticate } from "../auth.server";
import { rateLimit, quotaGate } from "../../middleware/rateLimit";
import { HypercoreTTLCache, decideHypercore, executeHypercore, type Risk } from "./hypercore";
import { createProductionHypercoreAdapters } from "./hypercore-adapters";

/**
 * Superficie HTTP de Hypercore (Express).
 * ------------------------------------------------------------------
 * Expone el plano de decisión adaptativo (3 turbos / 6 nitros) y el pipeline de
 * ejecución gobernado. La autoridad final (CROWN + rails obligatorios) se conserva
 * SIEMPRE: Hypercore acelera, no autoriza.
 *
 * `/run` requiere adaptadores reales; en producción sin adaptadores cableados
 * responde 503 (fail-closed) en lugar de simular inferencia.
 */
export const hypercoreRouter = Router();

const sharedCache = new HypercoreTTLCache();

const RISK_VALUES: readonly Risk[] = ["low", "medium", "high", "critical"];

function parseSignals(body: unknown): {
  latencyBudgetMs: number;
  complexityScore: number;
  risk: Risk;
  policyFingerprint: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const latencyBudgetMs = typeof b.latencyBudgetMs === "number" ? b.latencyBudgetMs : 5000;
  const complexityScore = typeof b.complexityScore === "number" ? b.complexityScore : 0;
  const risk = (typeof b.risk === "string" ? b.risk : "low") as Risk;
  const policyFingerprint =
    typeof b.policyFingerprint === "string" ? b.policyFingerprint : "policy-v1";
  if (!RISK_VALUES.includes(risk)) return null;
  if (!Number.isFinite(latencyBudgetMs) || !Number.isFinite(complexityScore)) return null;
  return { latencyBudgetMs, complexityScore, risk, policyFingerprint };
}

hypercoreRouter.get("/api/v1/isabella/hypercore", (_req, res) => {
  res.json({
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
    endpoints: {
      decide: "POST /api/v1/isabella/hypercore/decide",
      run: "POST /api/v1/isabella/hypercore/run",
    },
    timestamp: new Date().toISOString(),
  });
});

hypercoreRouter.post(
  "/api/v1/isabella/hypercore/decide",
  rateLimit,
  authenticate,
  quotaGate("chat"),
  (req, res) => {
    const signals = parseSignals(req.body);
    if (!signals) {
      return res.status(400).json({ ok: false, error: "invalid_signals" });
    }
    const decision = decideHypercore(signals);
    return res.status(200).json({
      ok: true,
      schema: decision.schema,
      decision: {
        mode: decision.mode,
        activatedNitro: decision.activatedNitro,
        turbos: decision.turbos,
        earlyExitAllowed: decision.earlyExitAllowed,
        governanceInvariant: decision.governanceInvariant,
        mandatoryGateRequired: decision.mandatoryGateRequired,
        reason: decision.reason,
      },
    });
  },
);

hypercoreRouter.post(
  "/api/v1/isabella/hypercore/run",
  rateLimit,
  authenticate,
  quotaGate("chat"),
  async (req, res) => {
    // Vinculación de identidad: el tenant/usuario SIEMPRE proviene del principal autenticado,
    // nunca del cuerpo de la petición (aislamiento multi-tenant, AGENTS.md §5).
    const principal = req.principal;
    if (!principal?.tenantId) {
      return res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
    }
    const incoming = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const payload = { ...incoming, tenantId: principal.tenantId, userId: principal.sub };
    const result = await executeHypercore(
      payload,
      createProductionHypercoreAdapters({
        tenantId: principal.tenantId,
        userId: principal.sub,
        roles: principal.roles,
        scopes: principal.scopes,
      }),
      { cache: sharedCache },
    );
    const status = result.ok
      ? 200
      : result.reason === "deadline_during_verification" || result.reason === "deadline_exceeded"
        ? 504
        : result.reason?.startsWith("invalid_") || result.reason === "body_must_be_object"
          ? 400
          : 422;
    return res.status(status).json(result);
  },
);
