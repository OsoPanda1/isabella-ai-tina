# Security Policy — Isabella AI Genesis

## Responsible disclosure
Do not publish an undisclosed vulnerability in a public issue.

Use GitHub Security Advisories for private reporting:
https://github.com/OsoPanda1/isabella-ai-tina/security/advisories/new

Include the affected component, reproducible steps, impact, and proposed mitigation when available. Never include live credentials, tokens, private keys, personal data, or production secrets in the disclosure.

## Secret compromise
A credential exposed in source control, logs, CI output, or an external integration is treated as compromised. Revoke or rotate it immediately, invalidate dependent sessions where applicable, and document the remediation in the incident timeline.

## Security controls
- **Dependency audit and dependency review:** `pnpm audit`, GitHub Dependabot, and `actions/dependency-review-action` v5
- **Secret scanning and CodeQL:** GitHub secret scanning + `eslint-plugin-security` + manual audit scripts
- **Trivy filesystem/container scanning:** `trivy fs` for dependencies + `trivy image` for Docker builds
- **SBOM generation and verification:** `scripts/sbom.mjs` generates CycloneDX + `sbom-verify.mjs` validates integrity
- **Signed release/image artifacts:** `actions/attest-build-provenance` v4 (SLSA L3 attestations)
- **Production preflight and integrity gates:** `production:preflight` validates architecture + health checks
- **Authentication, authorization, tenant isolation and rate/quota controls:** `withSovereignAuth`, RBAC/ABAC, `SecuritySystem.checkRateLimitDistributed`
- **Webhook signature verification and durable event claims:** BookPI ledger with hash-chain integrity + outbox auditing
- **Output gate and egress security:** `ALLOW/FLAG/DENY` gate on SSE + `fetchSafeUpstream` with allowlist, SSRF blocking, circuit breaker
- **Typecheck and lint gates:** `tsc --noEmit --strict`, `eslint` with security plugin, `prettier` format check

## Response time and escalation

| Severity | Target SLA | Escalation |  
|----------|------------|------------|  
| Critical (P0) | 4 hours to acknowledge, 24 hours for patch | Immediate escalation to @OsoPanda1, pause deployments |  
| High (P1) | 1 day to acknowledge, 3 days for patch | Day-shift escalation, plan release window |  
| Medium (P2) | 3 days to acknowledge, 2 weeks for patch | Standard backlog, next release |  
| Low (P3) | 2 weeks to acknowledge, next quarter planned | Backlog, include in planned release |  

## Evidence of execution in CI

- **Dependency review:** `.github/workflows/security.yml` → `actions/dependency-review-action@v5` on every PR
- **Secret scan:** `.github/workflows/secret-scan.yml` → `script/secret-scan.mjs` + GitHub secret scanning
- **SAST/CodeQL:** `.github/workflows/codeql.yml` (pending runner allocation)
- **Typecheck/Lint/Build gates:** Enforced locally via `pnpm production:gate` before merge
- **Container scanning:** Manual Trivy runs; integrate into release workflow
- **SBOM verification:** `pnpm sbom && pnpm sbom:verify` before production deployment

## Security status statement

**This repository is not certified as production-ready by this document alone.** Security status claims require executable evidence from the target environment:
- Successful test runs of all gates
- Passing CI checks on the target branch
- Verified artifact signatures (SLSA attestations)
- Audit of environment-specific secrets rotation

## Fix lifecycle
1. **Reproduce and classify** the issue: confirm severity, attack vector, affected version.
2. **Contain affected functionality** when necessary: kill-switch, circuit breaker, rate limit tightening.
3. **Implement and test** the remediation: code review, security test suite, regression tests.
4. **Verify the fix** with the relevant gate: `pnpm production:gate`, CI checks, SBOM refresh.
5. **Rotate credentials** if exposure occurred: API keys, signing keys, database passwords.
6. **Publish remediation** details when disclosure is appropriate: advisories, release notes, timeline.

## Contact
- **Security Lead:** @OsoPanda1
- **Emergency:** Use GitHub Security Advisories (private)
- **General:** Issues labeled `[security]` in the main repository
