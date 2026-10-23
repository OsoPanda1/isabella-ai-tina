# Genesis V6.1 Runtime Plane

## Scope

Genesis V6.1 converts the cognitive foundation into explicit runtime planes without claiming capabilities that are not wired.

### Planes

1. **Authority** — identity, PDP, CROWN and approval binding.
2. **Security** — AEGIS inspection before memory/tool/inference boundaries.
3. **Inference** — adapter/router abstraction plus OpenAI-compatible HTTP adapter.
4. **Memory** — IKES epistemic claims, vector store, retrieval and persistence contract.
5. **Veritas** — deterministic candidate verification.
6. **Tools/Skills** — governed execution and receipts.
7. **Evaluation** — benchmark and security suites.
8. **Deployment** — readiness gates and rollback registry.
9. **Observability** — metrics/traces and SLO calculations.

## Production boundary

The OpenAI-compatible adapter is a transport integration, not a claim of a native model. GPU scheduling, continuous batching, KV cache, speculative decoding and distributed workers require concrete providers/runtimes and operational evidence.

## Security invariants

- Acceleration never overrides authority.
- High/critical tools require approval bound to the live request.
- AEGIS can block hostile input before tool execution.
- Memory provenance and epistemic state remain separate from truth claims.
- Deployment is not considered ready while required gates remain false.

## Runtime configuration

Credentials and endpoints must be supplied through deployment secrets/environment variables. They must never be committed to source control.
