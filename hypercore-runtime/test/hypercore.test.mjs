import test from 'node:test';
import assert from 'node:assert/strict';
import { runHypercore, chooseMode, decideAcceleration, TTLCache, demoAdapter } from '../src/hypercore.mjs';
const request = (overrides={}) => ({ requestId:'test-1', tenantId:'tenant-a', prompt:'Explain caching', risk:'low', deadlineMs:1000, ...overrides });

test('selects stronger acceleration as deadline tightens', () => {
  assert.equal(chooseMode('low', 3000, .1), 'CRUISE');
  assert.equal(chooseMode('low', 1000, .1), 'BOOST');
  assert.equal(chooseMode('low', 300, .1), 'HYPERBOOST');
});

test('decision plane activates turbos/nitros and preserves authority', () => {
  const cruise = decideAcceleration({ latencyBudgetMs: 3000, complexityScore: .1, risk: 'low', policyFingerprint: 'p' });
  assert.deepEqual(cruise.turbos, ['VECTOR', 'SPECULATIVE', 'VERITAS']);
  assert.equal(cruise.mandatoryGateRequired, true);
  assert.equal(cruise.governanceInvariant, 'PRESERVED');
  assert.ok(cruise.activatedNitro.includes('PREFIX_CACHE'));
  assert.ok(cruise.activatedNitro.includes('VERIFIER_FANOUT'));

  const hyper = decideAcceleration({ latencyBudgetMs: 200, complexityScore: .9, risk: 'low', policyFingerprint: 'p' });
  assert.equal(hyper.mode, 'HYPERBOOST');
  assert.equal(hyper.earlyExitAllowed, true);
  assert.ok(hyper.activatedNitro.includes('EARLY_EXIT'));
  assert.ok(hyper.activatedNitro.includes('DRAFT_MODEL'));
});

test('high risk forbids semantic cache and early exit', () => {
  const decision = decideAcceleration({ latencyBudgetMs: 200, complexityScore: .95, risk: 'critical', policyFingerprint: 'p' });
  assert.equal(decision.earlyExitAllowed, false);
  assert.ok(!decision.activatedNitro.includes('SEMANTIC_CACHE'));
  assert.ok(!decision.activatedNitro.includes('EARLY_EXIT'));
});

test('returns a verified deterministic demo response', async () => {
  const r = await runHypercore(request(), demoAdapter());
  assert.equal(r.ok, true); assert.match(r.answer, /DEMO/);
  assert.equal(r.checks.policy.ok, true); assert.equal(r.checks.evidence.ok, true); assert.equal(r.checks.safety.ok, true);
  assert.equal(r.decision.schema, 'isabella.hypercore.decision.v1');
});

test('fails closed when any output rail rejects', async () => {
  const a = { ...demoAdapter(), async evidenceCheck() { return { ok:false, reason:'evidence_missing' }; } };
  const r = await runHypercore(request({requestId:'test-2'}), a);
  assert.equal(r.ok, false); assert.equal(r.reason, 'verification_failed');
});

test('fails closed when a mandatory output rail throws', async () => {
  const a = { ...demoAdapter(), async outputSafety() { throw new Error('safety_unavailable'); } };
  const r = await runHypercore(request({requestId:'test-3'}), a);
  assert.equal(r.ok, false); assert.equal(r.reason, 'adapter_failure');
});

test('cache is tenant-scoped and only caches low risk', async () => {
  const cache = new TTLCache(); let generated = 0; const base = demoAdapter();
  const a = { ...base, async generate(...args) { generated++; return base.generate(...args); } };
  await runHypercore(request(), a, { cache }); await runHypercore(request({requestId:'test-4'}), a, { cache });
  assert.equal(generated, 1);
  await runHypercore(request({requestId:'test-5', tenantId:'tenant-b'}), a, { cache }); assert.equal(generated, 2);
  await runHypercore(request({requestId:'test-6', risk:'high'}), a, { cache }); assert.equal(generated, 3);
});

test('policy version invalidates cache', async () => {
  const cache = new TTLCache(); let generated = 0; const base = demoAdapter();
  const a = { ...base, async generate(...args) { generated++; return base.generate(...args); } };
  await runHypercore(request(), a, { cache, policyVersion: 'v1' });
  await runHypercore(request({requestId:'test-7'}), a, { cache, policyVersion: 'v1' });
  assert.equal(generated, 1);
  await runHypercore(request({requestId:'test-8'}), a, { cache, policyVersion: 'v2' });
  assert.equal(generated, 2);
});

test('rejects malformed requests', async () => {
  await assert.rejects(() => runHypercore({ prompt:'x' }, demoAdapter()), /invalid_requestId/);
});

test('TTL cache expires entries', async () => {
  const cache = new TTLCache({ ttlMs: 10 }); cache.set('k', {ok:true});
  await new Promise(r => setTimeout(r, 20)); assert.equal(cache.get('k'), undefined);
});
