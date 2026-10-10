import { createFileRoute } from "@tanstack/react-router";

const DEPENDENCY_TIMEOUT_MS = 3000;

type HealthCheck = { ok: boolean; latencyMs?: number; error?: string };

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }: IsabellaRouteContext) => {
        const url = new URL(request.url);
        const path = url.pathname;
        const stage = url.searchParams.get("stage");
        if (path.endsWith("/live") || stage === "live" || url.searchParams.get("health") === "live")
          return liveness();
        if (
          path.endsWith("/ready") ||
          stage === "ready" ||
          url.searchParams.get("health") === "ready"
        )
          return readiness();
        if (path.endsWith("/deep")) return deepReadiness();
        return readiness();
      },
    },
  },
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("dependency_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function liveness(): Promise<Response> {
  return json({
    status: "alive",
    service: "isabella-ai-genesis",
    timestamp: new Date().toISOString(),
  });
}

async function deepReadiness(): Promise<Response> {
  const base = await readiness();
  const body = (await base.json()) as {
    status: string;
    checks: Record<string, HealthCheck>;
    timestamp: string;
  };
  try {
    const [{ config }, { resolveRuntimeMode }] = await Promise.all([
      import("@/lib/config"),
      import("@/lib/runtime-mode"),
    ]);
    const cfg = config();
    body.checks.runtime = { ok: true };
    body.checks.runtimeMode = {
      ok: Boolean(resolveRuntimeMode(cfg.ISABELLA_RUNTIME_MODE)),
    };
    body.checks.bookpi = { ok: Boolean(cfg.BOOKPI_SIGNING_KEY) };
  } catch {
    body.checks.runtime = { ok: false, error: "configuration_unavailable" };
    body.checks.runtimeMode = { ok: false, error: "configuration_unavailable" };
    body.checks.bookpi = { ok: false, error: "configuration_unavailable" };
  }
  const ok =
    body.status === "ready" && body.checks.bookpi?.ok === true && body.checks.runtime?.ok === true;
  return json({ ...body, status: ok ? "ready" : "not_ready" }, ok ? 200 : 503);
}

async function checkRepositoryHealth(kind: "repository" | "audit"): Promise<HealthCheck> {
  const started = performance.now();
  try {
    const { repositoryFactory } = await withTimeout(
      import("@/lib/persistence/repository-factory"),
      DEPENDENCY_TIMEOUT_MS,
    );
    const repository =
      kind === "repository"
        ? repositoryFactory.getTenantRepository()
        : repositoryFactory.getAuditRepository();
    const result = await withTimeout(
      repository.health() as Promise<{ ok: boolean; latencyMs: number; error?: string }>,
      DEPENDENCY_TIMEOUT_MS,
    );
    return {
      ok: result.ok,
      latencyMs: Number((performance.now() - started).toFixed(2)),
      ...(result.ok
        ? {}
        : { error: (result as { error?: string }).error ?? "repository_unhealthy" }),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
    console.error(`[health:${kind}] check failed:`, msg);
    return {
      ok: false,
      latencyMs: Number((performance.now() - started).toFixed(2)),
      // Sin volcado de detalle interno en la respuesta pública (ISA-7).
      error:
        error instanceof Error && error.message === "dependency_timeout"
          ? "dependency_timeout"
          : `${kind}_unavailable`,
    };
  }
}

async function readiness(): Promise<Response> {
  const [repository, audit] = await Promise.all([
    checkRepositoryHealth("repository"),
    checkRepositoryHealth("audit"),
  ]);
  const checks: Record<string, HealthCheck> = { repository, audit };
  let overallOk = repository.ok && audit.ok;

  try {
    const [{ config }, { isProductionLike, resolveRuntimeMode }] = await Promise.all([
      import("@/lib/config"),
      import("@/lib/runtime-mode"),
    ]);
    const cfg = config();
    const mode = resolveRuntimeMode(cfg.ISABELLA_RUNTIME_MODE);
    const productionLike = isProductionLike(mode);
    const hasDurableAuthority = Boolean(cfg.DATABASE_URL);
    checks.config = { ok: hasDurableAuthority };
    if (!hasDurableAuthority && productionLike) overallOk = false;

    // Corrección total: génesis no exige solo GEMINI — acepta GROQ/XAI como alternativa soberana (paridad con config.ts:61)
    const hasInferenceProvider = Boolean(cfg.GEMINI_API_KEY || cfg.GROQ_API_KEY || cfg.XAI_API_KEY);
    const genesisConfigured = Boolean(hasInferenceProvider && cfg.CROWN_POLICY_SIGNING_KEY);
    checks.isabella_genesis = {
      ok: genesisConfigured,
      ...(genesisConfigured
        ? {}
        : {
            error: hasInferenceProvider
              ? "crown_policy_signing_key_unconfigured"
              : "genesis_service_unconfigured",
          }),
    };
    if (!genesisConfigured && productionLike) overallOk = false;
  } catch {
    checks.config = { ok: false, error: "configuration_unavailable" };
    checks.isabella_genesis = {
      ok: false,
      error: "genesis_service_unavailable",
    };
    overallOk = false;
  }

  return json(
    {
      status: overallOk ? "ready" : "not_ready",
      checks,
      timestamp: new Date().toISOString(),
    },
    overallOk ? 200 : 503,
  );
}
