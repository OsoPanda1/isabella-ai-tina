import { createHash, randomUUID } from 'node:crypto';

/**
 * Isabella Hypercore Runtime — referencia funcional ejecutable (Node 22+).
 * Tres turbos (VECTOR / SPECULATIVE / VERITAS), seis nitros, modos CRUISE/BOOST/HYPERBOOST.
 * La autoridad final se conserva: ningún turbo concede autoridad y los rails obligatorios
 * siempre se ejecutan. El adaptador incluido es determinista (demo), no un LLM real.
 */

const RISK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
const MODES = new Set(['CRUISE', 'BOOST', 'HYPERBOOST']);
const now = () => performance.now();
const abortError = () => Object.assign(new Error('deadline_exceeded'), { code: 'DEADLINE_EXCEEDED' });

export function chooseMode(risk, remainingMs, complexity) {
  if (!(risk in RISK)) throw new TypeError('invalid_risk');
  if (RISK[risk] >= 2) return remainingMs < 900 ? 'BOOST' : 'CRUISE';
  if (remainingMs < 500 || complexity >= 0.8) return 'HYPERBOOST';
  if (remainingMs < 1400 || complexity >= 0.55) return 'BOOST';
  return 'CRUISE';
}

const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/**
 * Plano de decisión determinista y auditable. No concede autoridad.
 */
export function decideAcceleration(signals = {}) {
  const risk = signals.risk ?? 'low';
  if (!(risk in RISK)) throw new TypeError('invalid_risk');
  const riskHigh = RISK[risk] >= 2;
  const remainingMs = Math.max(0, Number(signals.latencyBudgetMs ?? 5000));
  const complexity = clamp01(signals.complexityScore ?? 0);
  const mode = chooseMode(risk, remainingMs, complexity);

  const activatedNitro = ['PREFIX_CACHE'];
  if (!riskHigh) activatedNitro.push('SEMANTIC_CACHE');
  if (mode !== 'CRUISE' && !riskHigh) {
    activatedNitro.push('DRAFT_MODEL');
    if (mode === 'HYPERBOOST' || complexity >= 0.7) activatedNitro.push('PARALLEL_BRANCHES');
  }
  activatedNitro.push('VERIFIER_FANOUT');
  const earlyExitAllowed = !riskHigh && mode === 'HYPERBOOST';
  if (earlyExitAllowed) activatedNitro.push('EARLY_EXIT');

  return {
    schema: 'isabella.hypercore.decision.v1',
    mode,
    turbos: ['VECTOR', 'SPECULATIVE', 'VERITAS'],
    activatedNitro,
    mandatoryGateRequired: true,
    earlyExitAllowed,
    governanceInvariant: 'PRESERVED',
    reason: `mode=${mode};risk=${risk};complexity=${complexity.toFixed(2)};remainingMs=${Math.round(remainingMs)}`,
  };
}

function makeCacheKey(request, policyVersion, systemVersion = 'isabella-core-v1') {
  // Producción debe usar HMAC con secreto server-side. Nunca registrar esta clave.
  const promptHash = createHash('sha256').update(request.prompt.trim()).digest('hex');
  return `${request.tenantId}:${request.risk}:${policyVersion}:${systemVersion}:${promptHash}`;
}

export class TTLCache {
  #items = new Map();
  constructor({ maxEntries = 500, ttlMs = 15000 } = {}) { this.maxEntries = maxEntries; this.ttlMs = ttlMs; }
  get(key) {
    const item = this.#items.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= Date.now()) { this.#items.delete(key); return undefined; }
    return structuredClone(item.value);
  }
  set(key, value, ttlMs = this.ttlMs) {
    if (this.#items.size >= this.maxEntries && !this.#items.has(key)) {
      const oldest = this.#items.keys().next().value;
      if (oldest !== undefined) this.#items.delete(oldest);
    }
    this.#items.set(key, { value: structuredClone(value), expiresAt: Date.now() + Math.max(1, ttlMs) });
  }
  clear() { this.#items.clear(); }
}

function validateRequest(r) {
  if (!r || typeof r !== 'object') throw new TypeError('body_must_be_object');
  for (const key of ['requestId', 'tenantId', 'prompt', 'risk']) {
    if (typeof r[key] !== 'string' || !r[key].trim()) throw new TypeError(`invalid_${key}`);
  }
  if (r.requestId.length > 128 || r.tenantId.length > 128 || r.prompt.length > 20000) throw new TypeError('request_too_large');
  if (!(r.risk in RISK)) throw new TypeError('invalid_risk');
  if (r.deadlineMs !== undefined && (!Number.isInteger(r.deadlineMs) || r.deadlineMs < 100 || r.deadlineMs > 30000)) throw new TypeError('deadlineMs_must_be_100_to_30000');
  return { ...r, prompt: r.prompt.trim(), deadlineMs: r.deadlineMs ?? 5000 };
}

export async function runHypercore(input, adapters, { cache = new TTLCache(), policyVersion = 'policy-v1', systemVersion = 'isabella-core-v1', emit = () => {} } = {}) {
  const r = validateRequest(input); const started = now(); const traceId = randomUUID();
  const deadlineAt = started + r.deadlineMs; const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(abortError()), r.deadlineMs);
  const event = (name, fields = {}) => { try { emit({ name, traceId, at: Date.now(), fields }); } catch { /* telemetry must not break request */ } };
  const finish = (result) => ({ ...result, elapsedMs: Math.round((now() - started) * 100) / 100, traceId });
  const cacheKey = makeCacheKey(r, policyVersion, systemVersion);
  try {
    const riskHigh = RISK[r.risk] >= 2;
    if (RISK[r.risk] <= 1) {
      const cached = cache.get(cacheKey);
      if (cached?.ok && cached.answer) { event('hypercore.cache.hit'); return finish({ ...cached, cache: 'hit' }); }
    }
    event('hypercore.start', { risk: r.risk, deadlineMs: r.deadlineMs });
    const [inputVerdict, classification] = await Promise.all([
      adapters.inputPolicy(r, controller.signal), adapters.classify(r, controller.signal),
    ]);
    const baseDecision = decideAcceleration({ latencyBudgetMs: r.deadlineMs, complexityScore: 0, risk: r.risk, policyFingerprint: policyVersion });
    if (!inputVerdict?.ok) return finish({ ok: false, mode: 'CRUISE', checks: { input: inputVerdict ?? { ok: false, reason: 'missing_input_verdict' } }, memoryHitCount: 0, cache: 'miss', decision: baseDecision, reason: inputVerdict?.reason ?? 'input_policy_denied' });
    if (controller.signal.aborted || now() >= deadlineAt) throw abortError();
    const decision = decideAcceleration({ latencyBudgetMs: deadlineAt - now(), complexityScore: classification?.complexity ?? 0.5, risk: classification?.risk ?? r.risk, policyFingerprint: policyVersion });
    event('hypercore.mode', { mode: decision.mode, nitros: decision.activatedNitro.join(',') });
    const memory = await adapters.retrieve(r, controller.signal);
    if (!Array.isArray(memory)) throw new Error('memory_adapter_invalid_result');
    if (controller.signal.aborted || now() >= deadlineAt) throw abortError();
    const candidate = await adapters.generate(r, memory, controller.signal, decision.mode, decision);
    if (!candidate || typeof candidate.text !== 'string' || !candidate.text.trim()) {
      return finish({ ok: false, mode: decision.mode, checks: { input: inputVerdict, generation: { ok: false, reason: 'empty_candidate' } }, memoryHitCount: memory.length, cache: 'miss', decision, reason: 'empty_candidate' });
    }
    // Todos los rails son obligatorios. El rechazo de la promesa falla en cerrado.
    const [policy, evidence, safety] = await Promise.all([
      adapters.policyCheck(r, candidate, controller.signal),
      adapters.evidenceCheck(r, candidate, memory, controller.signal),
      adapters.outputSafety(r, candidate, controller.signal),
    ]);
    const checks = { input: inputVerdict, policy, evidence, safety };
    if (controller.signal.aborted || now() >= deadlineAt || !policy?.ok || !evidence?.ok || !safety?.ok) {
      event('hypercore.output_block', { deadline: controller.signal.aborted, policy: !!policy?.ok, evidence: !!evidence?.ok, safety: !!safety?.ok });
      return finish({ ok: false, mode: decision.mode, checks, memoryHitCount: memory.length, cache: 'miss', decision, reason: controller.signal.aborted || now() >= deadlineAt ? 'deadline_during_verification' : 'verification_failed' });
    }
    const result = finish({ ok: true, answer: candidate.text, mode: decision.mode, checks, memoryHitCount: memory.length, cache: 'miss', decision, model: candidate.model ?? 'adapter-unspecified', tokensIn: candidate.tokensIn ?? null, tokensOut: candidate.tokensOut ?? null });
    if (!riskHigh && r.risk === 'low') cache.set(cacheKey, result);
    event('hypercore.success', { elapsedMs: result.elapsedMs, mode: decision.mode, tokensOut: candidate.tokensOut ?? 0 });
    return result;
  } catch (error) {
    const reason = error?.code === 'DEADLINE_EXCEEDED' || controller.signal.aborted ? 'deadline_exceeded' : 'adapter_failure';
    event('hypercore.fail_closed', { reason });
    return finish({ ok: false, mode: 'BOOST', checks: { runtime: { ok: false, reason } }, memoryHitCount: 0, cache: 'miss', reason });
  } finally { clearTimeout(timeout); }
}

export function demoAdapter() {
  const check = async (signal) => { if (signal.aborted) throw abortError(); return { ok: true, reason: 'demo_check_passed' }; };
  return {
    async inputPolicy(r, signal) { await check(signal); return r.prompt.length ? { ok: true, reason: 'non_empty_prompt' } : { ok: false, reason: 'empty_prompt' }; },
    async classify(r, signal) { await check(signal); return { risk: r.risk, complexity: Math.min(1, r.prompt.length / 1000) }; },
    async retrieve(r, signal) { await check(signal); return []; },
    async generate(r, memory, signal, mode) { await check(signal); return { text: `DEMO (${mode}): ${r.prompt}`, model: 'deterministic-demo-adapter', tokensIn: Math.ceil(r.prompt.length / 4), tokensOut: Math.ceil(r.prompt.length / 4) + 2 }; },
    async policyCheck(r, c, signal) { await check(signal); return { ok: !/ignore (all )?polic(y|ies)|reveal secrets/i.test(c.text), reason: 'demo_policy_rule' }; },
    async evidenceCheck(r, c, memory, signal) { await check(signal); return { ok: true, reason: 'demo_evidence_adapter_no_external_claims', evidenceIds: memory.map(x => x.sourceId).filter(Boolean) }; },
    async outputSafety(r, c, signal) { await check(signal); return { ok: !/reveal secrets/i.test(c.text), reason: 'demo_output_safety_rule' }; },
  };
}

export { MODES };
