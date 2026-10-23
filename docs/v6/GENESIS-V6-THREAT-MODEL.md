# Genesis V6 Threat Model

## Assets

Identity, consent, private data, knowledge provenance, model context, tool authority, human approvals, BookPI history, model/provider credentials and territory policy.

## Threat classes

- prompt and indirect injection
- retrieval poisoning
- tool poisoning
- approval replay/tampering
- tenant breakout
- ABAC bypass
- secret exposure
- ledger tampering
- cache poisoning
- speculative verification bypass
- malicious evolution proposals
- stale knowledge presented as current
- model/provider failure or substitution

## Control response

| Threat               | Primary control                                             |
| -------------------- | ----------------------------------------------------------- |
| Injection            | AEGIS + CROWN                                               |
| Authorization bypass | PDP + fail-closed ABAC + capability registry                |
| Approval replay      | nonce + expiry + replay registry                            |
| Ledger tampering     | canonical event hash + integrity seal + append-only DB role |
| Knowledge poisoning  | IKES provenance + epistemic state + corroboration           |
| Cache poisoning      | authority-bound cache keys and verifier before commit       |
| Evolution abuse      | proposal domain + evidence + lifecycle + human approval     |
| Tenant breakout      | tenant isolation before capability evaluation               |
| Provider failure     | model registry/fallback contracts + observable SLOs         |
