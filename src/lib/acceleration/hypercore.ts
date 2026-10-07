import { createHash } from "node:crypto";

/**
 * Isabella Hypercore v1.0.0 — capa de aceleración adaptativa gobernada.
 * -------------------------------------------------------------------------
 * Analogía "Tsuru + turbos": el núcleo ordinario y resistente (CROWN / autorización /
 * policy-as-code / evidencia / output-security) permanece como autoridad final. Hypercore
 * añade TRES turbos de aceleración con DOS nitros cada uno (seis interruptores) que se
 * activan de forma adaptativa según presupuesto de latencia, complejidad y riesgo.
 *
 * INVARIANTE DE SEGURIDAD (no negociable): ningún turbo ni nitro concede autoridad.
 * La aceleración reduce trabajo redundante, solapa operaciones independientes y reserva
 * cómputo profundo; nunca elimina los rails obligatorios. Un timeout, un error o un
 * resultado malformado de un rail obligatorio equivale a DENY, jamás a ALLOW.
 *
 * Este módulo NO implementa un LLM: orquesta adaptadores reales (modelo, memoria, política,
 * evidencia y seguridad de salida) que deben inyectarse desde los servicios existentes.
 */

export type Risk = "low" | "medium" | "high" | "critical";
export type AccelerationMode = "CRUISE" | "BOOST" | "HYPERBOOST";
export type TurboId = "VECTOR" | "SPECULATIVE" | "VERITAS";
export type NitroId =
  | "PREFIX_CACHE"
  | "SEMANTIC_CACHE"
  | "DRAFT_MODEL"
  | "PARALLEL_BRANCHES"
  | "VERIFIER_FANOUT"
  | "EARLY_EXIT";
export type GovernanceInvariant = "PRESERVED" | "VIOLATED";
export type CacheState = "hit" | "miss" | "disabled";

export interface Verdict {
  ok: boolean;
  reason?: string;
  evidenceIds?: string[];
  latencyMs?: number;
}

export interface MemoryHit {
  text: string;
  sourceId: string;
  trust: number;
  updatedAt?: string;
}

export interface Candidate {
  text: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface HypercoreSignals {
  latencyBudgetMs: number;
  complexityScore: number;
  risk: Risk;
  policyFingerprint: string;
  systemFingerprint?: string;
}

export interface HypercoreDecision {
  schema: "isabella.hypercore.decision.v1";
  mode: AccelerationMode;
  turbos: TurboId[];
  activatedNitro: NitroId[];
  mandatoryGateRequired: true;
  earlyExitAllowed: boolean;
  governanceInvariant: GovernanceInvariant;
  reason: string;
}

export interface HypercoreRequest {
  requestId: string;
  tenantId: string;
  userId?: string;
  prompt: string;
  risk: Risk;
  deadlineMs?: number;
  maxOutputTokens?: number;
  allowSpeculativeDraft?: boolean;
  metadata?: Record<string, string>;
}

export interface HypercoreResult {
  ok: boolean;
  answer?: string;
  mode: AccelerationMode;
  elapsedMs: number;
  checks: Record<string, Verdict>;
  memoryHitCount: number;
  cache: CacheState;
  decision: HypercoreDecision;
  reason?: string;
  traceId: string;
}

export interface HypercoreTelemetryEvent {
  name: string;
  traceId: string;
  at: number;
  fields?: Record<string, string | number | boolean>;
}

export interface HypercoreAdapters {
  classify(
    request: HypercoreRequest,
    signal: AbortSignal,
  ): Promise<{ risk: Risk; complexity: number }>;
  inputPolicy(request: HypercoreRequest, signal: AbortSignal): Promise<Verdict>;
  retrieve(request: HypercoreRequest, signal: AbortSignal): Promise<MemoryHit[]>;
  generate(
    request: HypercoreRequest,
    memory: MemoryHit[],
    signal: AbortSignal,
    mode: AccelerationMode,
    decision: HypercoreDecision,
  ): Promise<Candidate>;
  policyCheck(
    request: HypercoreRequest,
    candidate: Candidate,
    signal: AbortSignal,
  ): Promise<Verdict>;
  evidenceCheck(
    request: HypercoreRequest,
    candidate: Candidate,
    memory: MemoryHit[],
    signal: AbortSignal,
  ): Promise<Verdict>;
  outputSafety(
    request: HypercoreRequest,
    candidate: Candidate,
    signal: AbortSignal,
  ): Promise<Verdict>;
}

export interface HypercoreRuntimeOptions {
  cache?: HypercoreCache;
  policyFingerprint?: string;
  systemFingerprint?: string;
  telemetry?: (event: HypercoreTelemetryEvent) => void;
  cacheTtlMs?: number;
}

export interface HypercoreCache {
  get(key: string): HypercoreResult | undefined;
  set(key: string, value: HypercoreResult, ttlMs?: number): void;
}

const RISK_RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const DEFAULT_DEADLINE_MS = 5000;
const MIN_DEADLINE_MS = 100;
const MAX_DEADLINE_MS = 30000;
const DEFAULT_CACHE_TTL_MS = 15000;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Decisión determinista del plano de aceleración. No tiene efectos secundarios y es
 * auditable. La autoridad (mandatoryGate) siempre se preserva.
 */
export function decideHypercore(signals: HypercoreSignals): HypercoreDecision {
  const riskHigh = RISK_RANK[signals.risk] >= 2;
  const remainingMs = Math.max(0, signals.latencyBudgetMs);
  const complexity = clamp01(signals.complexityScore);

  let mode: AccelerationMode;
  if (riskHigh) {
    mode = remainingMs < 900 ? "BOOST" : "CRUISE";
  } else if (remainingMs < 500 || complexity >= 0.8) {
    mode = "HYPERBOOST";
  } else if (remainingMs < 1400 || complexity >= 0.55) {
    mode = "BOOST";
  } else {
    mode = "CRUISE";
  }

  const activatedNitro: NitroId[] = [];

  // TURBO 1 — VECTOR: reutilización de trabajo ya validado.
  activatedNitro.push("PREFIX_CACHE");
  if (!riskHigh) activatedNitro.push("SEMANTIC_CACHE");

  // TURBO 2 — SPECULATIVE: candidatos verosímiles que NUNCA son verdad por sí mismos.
  if (mode !== "CRUISE" && !riskHigh) {
    activatedNitro.push("DRAFT_MODEL");
    if (mode === "HYPERBOOST" || complexity >= 0.7) activatedNitro.push("PARALLEL_BRANCHES");
  }

  // TURBO 3 — VERITAS: verificación paralela. El fan-out es obligatorio; EARLY_EXIT se
  // prohíbe en riesgo elevado porque podría suprimir un rail obligatorio por conveniencia.
  activatedNitro.push("VERIFIER_FANOUT");
  const earlyExitAllowed = !riskHigh && mode === "HYPERBOOST";
  if (earlyExitAllowed) activatedNitro.push("EARLY_EXIT");

  const turbos: TurboId[] = ["VECTOR", "SPECULATIVE", "VERITAS"];

  return {
    schema: "isabella.hypercore.decision.v1",
    mode,
    turbos,
    activatedNitro,
    mandatoryGateRequired: true,
    earlyExitAllowed,
    governanceInvariant: "PRESERVED",
    reason: `mode=${mode};risk=${signals.risk};complexity=${complexity.toFixed(2)};remainingMs=${Math.round(remainingMs)}`,
  };
}

export function turboForNitro(nitro: NitroId): TurboId {
  switch (nitro) {
    case "PREFIX_CACHE":
    case "SEMANTIC_CACHE":
      return "VECTOR";
    case "DRAFT_MODEL":
    case "PARALLEL_BRANCHES":
      return "SPECULATIVE";
    case "VERIFIER_FANOUT":
    case "EARLY_EXIT":
      return "VERITAS";
  }
}

/**
 * Caché TTL en memoria, aislada por tenant/riesgo/huella de política. No es durable:
 * para despliegues multi-instancia debe sustituirse por un backend compartido.
 */
export class HypercoreTTLCache implements HypercoreCache {
  private readonly items = new Map<string, { value: HypercoreResult; expiresAt: number }>();
  constructor(
    private readonly maxEntries: number = 500,
    private readonly ttlMs: number = DEFAULT_CACHE_TTL_MS,
  ) {}

  get(key: string): HypercoreResult | undefined {
    const item = this.items.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= Date.now()) {
      this.items.delete(key);
      return undefined;
    }
    return structuredClone(item.value);
  }

  set(key: string, value: HypercoreResult, ttlMs: number = this.ttlMs): void {
    if (this.items.size >= this.maxEntries && !this.items.has(key)) {
      const oldest = this.items.keys().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
    this.items.set(key, {
      value: structuredClone(value),
      expiresAt: Date.now() + Math.max(1, ttlMs),
    });
  }

  clear(): void {
    this.items.clear();
  }
}

/**
 * Clave de caché determinista. La huella de política forma parte de la clave: un cambio
 * de política invalida los resultados previos. Producción debe usar HMAC con secreto
 * server-side; nunca registrar esta clave en logs.
 */
export function hypercoreCacheKey(
  request: HypercoreRequest,
  policyFingerprint: string,
  systemFingerprint = "isabella-core-v1",
): string {
  const promptHash = createHash("sha256").update(request.prompt.trim(), "utf8").digest("hex");
  return `${request.tenantId}:${request.risk}:${policyFingerprint}:${systemFingerprint}:${promptHash}`;
}

export interface HypercoreValidation {
  ok: true;
  value: HypercoreRequest;
}

export type HypercoreValidationResult = HypercoreValidation | { ok: false; reason: string };

export function validateHypercoreRequest(input: unknown): HypercoreValidationResult {
  if (!input || typeof input !== "object") return { ok: false, reason: "body_must_be_object" };
  const r = input as Record<string, unknown>;
  for (const key of ["requestId", "tenantId", "prompt", "risk"] as const) {
    if (typeof r[key] !== "string" || !(r[key] as string).trim()) {
      return { ok: false, reason: `invalid_${key}` };
    }
  }
  const requestId = r.requestId as string;
  const tenantId = r.tenantId as string;
  const prompt = r.prompt as string;
  const risk = r.risk as Risk;
  if (requestId.length > 128 || tenantId.length > 128 || prompt.length > 20000) {
    return { ok: false, reason: "request_too_large" };
  }
  if (!(risk in RISK_RANK)) return { ok: false, reason: "invalid_risk" };
  const rawDeadline = r.deadlineMs;
  if (
    rawDeadline !== undefined &&
    (typeof rawDeadline !== "number" ||
      !Number.isInteger(rawDeadline) ||
      rawDeadline < MIN_DEADLINE_MS ||
      rawDeadline > MAX_DEADLINE_MS)
  ) {
    return { ok: false, reason: "deadlineMs_must_be_100_to_30000" };
  }
  return {
    ok: true,
    value: {
      requestId,
      tenantId,
      userId: typeof r.userId === "string" ? r.userId : undefined,
      prompt: prompt.trim(),
      risk,
      deadlineMs: (rawDeadline as number | undefined) ?? DEFAULT_DEADLINE_MS,
      maxOutputTokens: typeof r.maxOutputTokens === "number" ? r.maxOutputTokens : undefined,
      allowSpeculativeDraft: r.allowSpeculativeDraft === true,
      metadata:
        r.metadata && typeof r.metadata === "object"
          ? (r.metadata as Record<string, string>)
          : undefined,
    },
  };
}

/**
 * Gate obligatorio. Todas las comprobaciones de salida deben aprobar antes de publicar.
 * Cualquier fallo se interpreta como DENY (fail-closed).
 */
export function mandatoryGate(checks: Record<string, Verdict>): boolean {
  const required = ["policy", "evidence", "safety"] as const;
  return required.every((name) => checks[name]?.ok === true);
}

async function runVerificationRails(
  adapters: HypercoreAdapters,
  request: HypercoreRequest,
  candidate: Candidate,
  memory: MemoryHit[],
  signal: AbortSignal,
  earlyExitAllowed: boolean,
): Promise<Record<string, Verdict>> {
  if (!earlyExitAllowed) {
    const [policy, evidence, safety] = await Promise.all([
      adapters.policyCheck(request, candidate, signal),
      adapters.evidenceCheck(request, candidate, memory, signal),
      adapters.outputSafety(request, candidate, signal),
    ]);
    return { input: { ok: true }, policy, evidence, safety };
  }

  // EARLY_EXIT: si un rail obligatorio deniega, se puede dejar de esperar a los demás,
  // pero el gate obligatorio igualmente evalúa el veredicto final (fail-closed).
  const verdicts: Record<string, Verdict> = { input: { ok: true } };
  await new Promise<void>((resolve) => {
    let pending = 3;
    let settled = false;
    const done = (): void => {
      pending -= 1;
      if (pending === 0 || settled) resolve();
    };
    const record = (key: string) => (verdict: Verdict) => {
      if (settled) return;
      verdicts[key] = verdict;
      if (!verdict.ok) {
        settled = true;
        resolve();
        return;
      }
      done();
    };
    void adapters.policyCheck(request, candidate, signal).then(record("policy"));
    void adapters.evidenceCheck(request, candidate, memory, signal).then(record("evidence"));
    void adapters.outputSafety(request, candidate, signal).then(record("safety"));
  });
  return verdicts;
}

/**
 * Pipeline de ejecución genérico:
 *  1. decisión de modo/nitro; 2. cache lookup (solo riesgo bajo/medio);
 *  3. gates de entrada + clasificación en paralelo; 4. recuperación de memoria;
 *  5. generación (con draft/paralelismo si corresponde); 6. fan-out de verificación;
 *  7. mandatoryGate SIEMPRE; 8. cache write solo tras aprobación; 9. telemetría.
 */
export async function executeHypercore(
  input: unknown,
  adapters: HypercoreAdapters,
  options: HypercoreRuntimeOptions = {},
): Promise<HypercoreResult> {
  const started = Date.now();
  const policyFingerprint = options.policyFingerprint ?? "policy-v1";
  const systemFingerprint = options.systemFingerprint ?? "isabella-core-v1";

  const validation = validateHypercoreRequest(input);
  if (!validation.ok) {
    return {
      ok: false,
      mode: "CRUISE",
      elapsedMs: Date.now() - started,
      checks: { input: { ok: false, reason: validation.reason } },
      memoryHitCount: 0,
      cache: options.cache ? "miss" : "disabled",
      decision: decideHypercore({
        latencyBudgetMs: DEFAULT_DEADLINE_MS,
        complexityScore: 0,
        risk: "low",
        policyFingerprint,
        systemFingerprint,
      }),
      reason: validation.reason,
      traceId: `hc-invalid-${started}`,
    };
  }

  const request = validation.value;
  const traceId = request.requestId || `hc-${started}`;
  const budget = Math.min(
    MAX_DEADLINE_MS,
    Math.max(MIN_DEADLINE_MS, request.deadlineMs ?? DEFAULT_DEADLINE_MS),
  );
  const deadlineAt = started + budget;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("hypercore_deadline")), budget);

  const emit = (name: string, fields?: Record<string, string | number | boolean>): void => {
    try {
      options.telemetry?.({ name, traceId, at: Date.now(), fields });
    } catch {
      /* la telemetría nunca debe romper la petición */
    }
  };
  const finish = (partial: Omit<HypercoreResult, "elapsedMs" | "traceId">): HypercoreResult => ({
    ...partial,
    elapsedMs: Date.now() - started,
    traceId,
  });

  const disabledDecision = decideHypercore({
    latencyBudgetMs: budget,
    complexityScore: 0,
    risk: request.risk,
    policyFingerprint,
    systemFingerprint,
  });

  try {
    const cacheKey = hypercoreCacheKey(request, policyFingerprint, systemFingerprint);
    if (options.cache && RISK_RANK[request.risk] <= 1) {
      const hit = options.cache.get(cacheKey);
      if (hit?.ok && hit.answer) {
        emit("hypercore.cache.hit");
        return finish({ ...hit, cache: "hit", decision: hit.decision ?? disabledDecision });
      }
    }

    emit("hypercore.start", { risk: request.risk, budgetMs: budget });

    const [inputVerdict, classification] = await Promise.all([
      adapters.inputPolicy(request, controller.signal),
      adapters.classify(request, controller.signal),
    ]);

    if (!inputVerdict.ok) {
      emit("hypercore.input_block", { reason: inputVerdict.reason ?? "policy_denied" });
      return finish({
        ok: false,
        mode: "CRUISE",
        checks: { input: inputVerdict },
        memoryHitCount: 0,
        cache: options.cache ? "miss" : "disabled",
        decision: disabledDecision,
        reason: inputVerdict.reason ?? "policy_denied",
      });
    }

    if (controller.signal.aborted || Date.now() >= deadlineAt)
      throw new Error("hypercore_deadline_before_generation");

    const decision = decideHypercore({
      latencyBudgetMs: deadlineAt - Date.now(),
      complexityScore: classification.complexity,
      risk: classification.risk,
      policyFingerprint,
      systemFingerprint,
    });
    emit("hypercore.mode", { mode: decision.mode, nitros: decision.activatedNitro.join(",") });

    const memory = await adapters.retrieve(request, controller.signal);
    if (!Array.isArray(memory)) throw new Error("memory_adapter_invalid_result");
    if (controller.signal.aborted || Date.now() >= deadlineAt)
      throw new Error("hypercore_deadline_before_generation");

    const candidate = await adapters.generate(
      request,
      memory,
      controller.signal,
      decision.mode,
      decision,
    );
    if (!candidate.text?.trim()) {
      return finish({
        ok: false,
        mode: decision.mode,
        checks: { input: inputVerdict, generation: { ok: false, reason: "empty_candidate" } },
        memoryHitCount: memory.length,
        cache: options.cache ? "miss" : "disabled",
        decision,
        reason: "empty_candidate",
      });
    }

    const checks = await runVerificationRails(
      adapters,
      request,
      candidate,
      memory,
      controller.signal,
      decision.earlyExitAllowed,
    );

    const deadlineHit = controller.signal.aborted || Date.now() >= deadlineAt;
    if (deadlineHit || !mandatoryGate(checks)) {
      emit("hypercore.output_block", {
        policy: checks.policy?.ok === true,
        evidence: checks.evidence?.ok === true,
        safety: checks.safety?.ok === true,
        deadline: deadlineHit,
      });
      return finish({
        ok: false,
        mode: decision.mode,
        checks,
        memoryHitCount: memory.length,
        cache: options.cache ? "miss" : "disabled",
        decision,
        reason: deadlineHit ? "deadline_during_verification" : "verification_failed",
      });
    }

    const result = finish({
      ok: true,
      answer: candidate.text,
      mode: decision.mode,
      checks,
      memoryHitCount: memory.length,
      cache: options.cache ? "miss" : "disabled",
      decision,
    });

    // La caché exacta solo se escribe para riesgo bajo y DESPUÉS de aprobar el gate.
    if (options.cache && RISK_RANK[request.risk] === 0) {
      options.cache.set(cacheKey, result, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    }
    emit("hypercore.success", { elapsedMs: result.elapsedMs, mode: decision.mode });
    return result;
  } catch (error) {
    const reason = controller.signal.aborted
      ? "deadline_exceeded"
      : error instanceof Error
        ? error.message
        : "unknown_error";
    emit("hypercore.fail_closed", { reason });
    return finish({
      ok: false,
      mode: "BOOST",
      checks: { runtime: { ok: false, reason } },
      memoryHitCount: 0,
      cache: options.cache ? "miss" : "disabled",
      decision: disabledDecision,
      reason,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adaptador determinista para ejercitar el contrato de ejecución en tests y desarrollo.
 * NO es el modelo real de Isabella y nunca debe usarse en producción.
 */
export function deterministicHypercoreAdapter(): HypercoreAdapters {
  const guard = (signal: AbortSignal): void => {
    if (signal.aborted) throw new Error("deadline_exceeded");
  };
  return {
    async inputPolicy(request, signal) {
      guard(signal);
      return request.prompt.trim().length > 0
        ? { ok: true, reason: "non_empty_prompt" }
        : { ok: false, reason: "empty_prompt" };
    },
    async classify(request, signal) {
      guard(signal);
      const complexity = clamp01(request.prompt.length / 1000);
      return { risk: request.risk, complexity };
    },
    async retrieve(_request, signal) {
      guard(signal);
      return [];
    },
    async generate(request, _memory, signal, mode) {
      guard(signal);
      return {
        text: `HYPERCORE(${mode}): ${request.prompt}`,
        model: "deterministic-hypercore-adapter",
        tokensIn: Math.ceil(request.prompt.length / 4),
        tokensOut: Math.ceil(request.prompt.length / 4) + 2,
      };
    },
    async policyCheck(_request, candidate, signal) {
      guard(signal);
      return {
        ok: !/ignore (all )?polic(y|ies)|reveal secrets/i.test(candidate.text),
        reason: "deterministic_policy_rule",
      };
    },
    async evidenceCheck(_request, _candidate, memory, signal) {
      guard(signal);
      return {
        ok: true,
        reason: "deterministic_evidence_adapter",
        evidenceIds: memory.map((hit) => hit.sourceId).filter(Boolean),
      };
    },
    async outputSafety(_request, candidate, signal) {
      guard(signal);
      return {
        ok: !/reveal secrets/i.test(candidate.text),
        reason: "deterministic_output_safety_rule",
      };
    },
  };
}
