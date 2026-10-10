import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Crown,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { authFetch } from "../../lib/auth-client";

const PLAN_IDS = ["free", "plus", "premium", "vip", "enterprise"] as const;
type PlanId = (typeof PLAN_IDS)[number];

type Usage = {
  messages: number;
  images: number;
  voiceSeconds: number;
  agentSessions: number;
};

type QuotaMap = Usage;

interface PlanDto {
  id: string;
  name: string;
  monthlyUsd: number | null;
  dailyMessages: number;
  dailyImages: number;
  dailyVoiceSeconds: number;
  maxAgentSessions: number;
  features: string[];
  checkoutUrl: string | null;
}

interface BillingDto {
  ok: boolean;
  positioning: string;
  plans: PlanDto[];
  current: {
    plan: PlanDto;
    usage: Usage;
    remaining: QuotaMap;
    resetAt: string;
  };
}

type LoadState =
  | { status: "idle" | "loading"; data: BillingDto | null; error: null }
  | { status: "success"; data: BillingDto; error: null }
  | { status: "error"; data: BillingDto | null; error: string };

interface SubscriptionPlansProps {
  locale?: string;
  currency?: string;
  allowedCheckoutOrigins?: readonly string[];
}

const PLAN_PRIORITY: Record<PlanId, number> = {
  free: 0,
  plus: 1,
  premium: 2,
  vip: 3,
  enterprise: 4,
};

const DEFAULT_ALLOWED_ORIGINS = (import.meta.env.VITE_CHECKOUT_ORIGINS?.split(",") ?? [])
  .map((origin: string) => origin.trim())
  .filter(Boolean);

const integerFormatter = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 0,
});

const safeInteger = (value: unknown, fallback = 0): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
};

const safeText = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.trim().slice(0, 500) : fallback;

const normalizePlan = (input: unknown): PlanDto | null => {
  if (!input || typeof input !== "object") return null;
  const plan = input as Partial<PlanDto>;
  const id = safeText(plan.id);
  if (!PLAN_IDS.includes(id as PlanId)) return null;

  const monthlyUsd =
    plan.monthlyUsd === null
      ? null
      : typeof plan.monthlyUsd === "number" &&
          Number.isFinite(plan.monthlyUsd) &&
          plan.monthlyUsd >= 0 &&
          plan.monthlyUsd <= 1_000_000
        ? plan.monthlyUsd
        : null;

  return {
    id,
    name: safeText(plan.name, id),
    monthlyUsd,
    dailyMessages: safeInteger(plan.dailyMessages),
    dailyImages: safeInteger(plan.dailyImages),
    dailyVoiceSeconds: safeInteger(plan.dailyVoiceSeconds),
    maxAgentSessions: safeInteger(plan.maxAgentSessions),
    features: Array.isArray(plan.features)
      ? plan.features
          .filter((feature): feature is string => typeof feature === "string")
          .map((feature) => feature.trim().slice(0, 160))
          .filter(Boolean)
          .slice(0, 12)
      : [],
    checkoutUrl: normalizeCheckoutUrl(plan.checkoutUrl),
  };
};

const normalizeCheckoutUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
};

const parseBilling = (input: unknown): BillingDto | null => {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<BillingDto>;
  if (raw.ok !== true || !Array.isArray(raw.plans) || !raw.current) return null;

  const plans = raw.plans.map(normalizePlan).filter((plan): plan is PlanDto => Boolean(plan));
  const currentPlan = normalizePlan(raw.current.plan);
  if (!currentPlan) return null;

  const normalizeUsage = (usage: unknown): Usage => {
    const value = (usage ?? {}) as Partial<Usage>;
    return {
      messages: safeInteger(value.messages),
      images: safeInteger(value.images),
      voiceSeconds: safeInteger(value.voiceSeconds),
      agentSessions: safeInteger(value.agentSessions),
    };
  };

  return {
    ok: true,
    positioning: safeText(
      raw.positioning,
      "Elige el nivel operativo que mejor se adapte a tu flujo.",
    ),
    plans,
    current: {
      plan: currentPlan,
      usage: normalizeUsage(raw.current.usage),
      remaining: normalizeUsage(raw.current.remaining),
      resetAt: safeText(raw.current.resetAt),
    },
  };
};

const formatCurrency = (amount: number | null, locale: string, currency: string) => {
  if (amount === null) return "Personalizado";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
};

const formatResetDate = (value: string, locale: string) => {
  if (!value) return "reinicio no informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "reinicio no informado";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const isAllowedCheckoutUrl = (value: string | null, allowedOrigins: readonly string[]) => {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return allowedOrigins.length === 0 || allowedOrigins.includes(url.origin);
  } catch {
    return false;
  }
};

const getPlanTone = (id: string) => {
  if (id === "plus") return "border-amber-400/60 bg-amber-400/10";
  if (id === "premium") return "border-sky-400/40 bg-sky-400/5";
  if (id === "enterprise") return "border-emerald-400/50 bg-emerald-400/5";
  return "border-slate-800 bg-slate-950/55";
};

const Metric = ({ label, value, tone }: { label: string; value: string; tone: string }) => (
  <div className="rounded-xl border border-slate-800/90 bg-slate-950/75 px-3 py-2">
    <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className={`mt-0.5 font-mono text-sm font-bold ${tone}`}>{value}</dd>
  </div>
);

export const SubscriptionPlans: React.FC<SubscriptionPlansProps> = ({
  locale = "es-MX",
  currency = "USD",
  allowedCheckoutOrigins = DEFAULT_ALLOWED_ORIGINS,
}) => {
  const [load, setLoad] = useState<LoadState>({ status: "idle", data: null, error: null });
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    setLoad((previous) => ({ status: "loading", data: previous.data, error: null }));

    const loadPlans = async () => {
      try {
        const response = await authFetch("/api/v1/billing/plans", {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`billing_http_${response.status}`);

        const payload: unknown = await response.json();
        const parsed = parseBilling(payload);
        if (!parsed) throw new Error("billing_invalid_payload");
        if (!mounted) return;
        setLoad({ status: "success", data: parsed, error: null });
      } catch (error) {
        if (!mounted || controller.signal.aborted) return;
        setLoad({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : "billing_unknown_error",
        });
      }
    };

    void loadPlans();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [retryNonce]);

  const billing = load.data;
  const visiblePlans = useMemo(() => {
    if (!billing) return [];
    return billing.plans
      .filter((plan): plan is PlanDto => PLAN_IDS.includes(plan.id as PlanId))
      .sort((a, b) => PLAN_PRIORITY[a.id as PlanId] - PLAN_PRIORITY[b.id as PlanId]);
  }, [billing]);

  if (load.status === "loading" && !billing) {
    return (
      <section
        className="mb-4 rounded-3xl border border-slate-800 bg-slate-950/80 p-6"
        aria-busy="true"
      >
        <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Cargando configuración de planes…
        </div>
      </section>
    );
  }

  if (load.status === "error" && !billing) {
    return (
      <section
        className="mb-4 rounded-3xl border border-rose-500/30 bg-rose-950/20 p-5"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-rose-100">No se pudieron cargar los planes</h2>
            <p className="mt-1 text-xs text-rose-200/70">
              La información no está disponible en este momento.
            </p>
            <button
              type="button"
              onClick={() => setRetryNonce((value) => value + 1)}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs font-bold text-rose-100 transition hover:bg-rose-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Reintentar
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!billing) return null;

  const remaining = billing.current.remaining;
  const resetLabel = formatResetDate(billing.current.resetAt, locale);

  return (
    <section
      className="mb-4 rounded-3xl border border-slate-800/80 bg-gradient-to-br from-[#081324]/95 via-[#06101E]/95 to-[#030712]/95 p-4 shadow-2xl shadow-black/30"
      aria-labelledby="subscription-plans-title"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Crown className="h-4 w-4 text-amber-300" aria-hidden="true" />
            <h2 id="subscription-plans-title" className="text-sm font-bold text-slate-100">
              Planes operativos Isabella AI
            </h2>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
              Cuota diaria activa
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
            {billing.positioning}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">Reinicio estimado: {resetLabel}</p>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:min-w-[540px]">
          <Metric
            label="Mensajes"
            value={integerFormatter.format(remaining.messages)}
            tone="text-sky-300"
          />
          <Metric
            label="Imágenes"
            value={integerFormatter.format(remaining.images)}
            tone="text-amber-300"
          />
          <Metric
            label="Voz · segundos"
            value={integerFormatter.format(remaining.voiceSeconds)}
            tone="text-pink-300"
          />
          <Metric label="Plan actual" value={billing.current.plan.name} tone="text-emerald-300" />
        </dl>
      </div>

      {load.status === "error" && billing && (
        <div
          className="mt-3 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200"
          role="status"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Mostrando la última información válida.
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {visiblePlans.map((plan) => {
          const isCurrent = plan.id === billing.current.plan.id;
          const isHighlighted = plan.id === "plus";
          const checkoutAllowed = isAllowedCheckoutUrl(plan.checkoutUrl, allowedCheckoutOrigins);

          return (
            <article
              key={plan.id}
              className={`relative flex min-h-[250px] flex-col rounded-2xl border p-3 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/20 ${getPlanTone(plan.id)} ${isCurrent ? "ring-1 ring-emerald-400/50" : ""}`}
            >
              {isCurrent && (
                <span className="absolute right-3 top-3 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                  Actual
                </span>
              )}

              <div className="flex items-center justify-between gap-2 pr-12">
                <h3 className="truncate text-sm font-bold text-slate-100">{plan.name}</h3>
                {isHighlighted && (
                  <Sparkles
                    className="h-4 w-4 shrink-0 text-amber-300"
                    aria-label="Plan destacado"
                  />
                )}
                {plan.id === "enterprise" && (
                  <ShieldCheck
                    className="h-4 w-4 shrink-0 text-emerald-300"
                    aria-label="Plan empresarial"
                  />
                )}
              </div>

              <p className="mt-2 text-2xl font-black text-white">
                {formatCurrency(plan.monthlyUsd, locale, currency)}
                {plan.monthlyUsd !== null && (
                  <span className="text-xs font-medium text-slate-400">/mes</span>
                )}
              </p>

              <p className="mt-1 text-[11px] font-mono leading-relaxed text-slate-400">
                {integerFormatter.format(plan.dailyMessages)} mensajes ·{" "}
                {integerFormatter.format(plan.dailyImages)} imágenes/día
              </p>

              <ul
                className="mt-3 flex-1 space-y-1.5 text-[11px] text-slate-300"
                aria-label={`Características de ${plan.name}`}
              >
                {plan.features.slice(0, 5).map((feature, index) => (
                  <li
                    key={`${plan.id}-${index}-${feature}`}
                    className="flex gap-1.5 leading-relaxed"
                  >
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-sky-300" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {checkoutAllowed ? (
                <a
                  href={plan.checkoutUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="mt-3 block rounded-xl border border-amber-400/40 bg-amber-400 px-3 py-2 text-center text-xs font-black text-slate-950 transition hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
                >
                  Activar plan
                </a>
              ) : (
                <span className="mt-3 block rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-center text-[11px] text-slate-500">
                  Activación no disponible
                </span>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};
