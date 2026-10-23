# Isabella Genesis V6 — Sovereign Cognitive Runtime

## Architectural thesis

Genesis V6 is a governed cognitive runtime, not a model wrapper. Its execution plane is composed of:

1. Ingress — bounded, normalized, traceable input.
2. Identity & Authority — principal, tenant, consent, RBAC and real ABAC.
3. CROWN — intent/risk/capability/verification.
4. AEGIS — prompt, retrieval, tool, secret and policy-evasion security.
5. Memory / IKES — evidence-backed external knowledge with epistemic and temporal state.
6. Hypercore — governed acceleration adapters: prefix cache, semantic cache, speculative draft/verify and parallel branches.
7. Tools / Skills — registered capabilities with receipts and provenance.
8. Evolution Fabric — 7,000-control matrix, evidence contracts and lifecycle governance.
9. BookPI — append-oriented provenance ledger.
10. Observability — latency, TTFT, cache hit, speculative acceptance, policy/security and SLO telemetry.
11. Federation — territory packs and sovereign boundaries.
12. Genesis Runtime — composes the above without allowing acceleration to bypass authority.

## Non-negotiable invariant

Optimization may reduce computation; it may never reduce authority, evidence, security or governance.

The three accelerator families remain:

- VECTOR: PREFIX_CACHE + SEMANTIC_CACHE
- SPECULATIVE: DRAFT_MODEL + PARALLEL_BRANCHES
- VERITAS: VERIFIER_FANOUT + risk-bounded EARLY_EXIT

The repository currently implements governance and adapter contracts. It does not claim that a GPU inference engine, real KV cache, model serving cluster or federated training system is present merely because the contracts exist.

## Knowledge model

IKES separates found, sourced, corroborated, academically supported, reproducible, validated and established states from disputed, rejected and deprecated states.

Memory is not truth. Retrieval is constrained by temporal and epistemic state.

## Evolution model

The 7,000 controls are a catalog, not 7,000 completed features. Evidence is required to move a control from declared to wired and eventually verified. Lifecycle states separately represent revocation, invalidation, supersession, deprecation and rollback.

## Security model

- Unknown capabilities: DENY.
- ABAC condition failure: DENY.
- ABAC evaluation error: DENY.
- Human approval: Ed25519-bound, target-bound, expiring and replay-aware.
- BookPI production secret: external only.
- BookPI database boundary: append-only application role.
- AEGIS critical findings: BLOCK.
- Acceleration: never changes authority.

## Production truth

The architecture explicitly distinguishes implemented code, executable adapter contracts, external infrastructure requirements, empirical evidence, legal/compliance alignment and third-party certification. No certification or universal legal compliance is inferred from source code.
