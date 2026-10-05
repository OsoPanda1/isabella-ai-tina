# Isabella-JDR — Threat Model

Estado: diseño de referencia. No es evidencia de cumplimiento hasta ejecutar las
pruebas de aceptación y los escaneos en el repositorio real.

## Bienes a proteger
- Identidad de tenant y sujeto (derivados del JWT verificado).
- Aislamiento multi-tenant en datos persistentes.
- Integridad de personajes, reglas y trabajos cuánticos.
- Trazabilidad (auditoría durable) y contrato de eventos (outbox).

## Controles por riesgo (mapeo al documento de propuesta)

| Riesgo (material original) | Mitigación implementada |
|---|---|
| Claims no confiables enviados por el cliente | `tenantId` se deriva del JWT verificado (`TenantContext.requiredTenant`); `X-Tenant-ID` es solo selector. |
| Tenant controlado por el cliente | `TenantContext.verifySelector` rechaza selector distinto al token (403). |
| JWT no verificado | `oauth2ResourceServer` con issuer-uri/audience; `JwtAuthenticationConverter` mapea scopes a `SCOPE_*`. |
| Objetos abiertos / campos desconocidos | Jackson `FAIL_ON_UNKNOWN_PROPERTIES=true`; DTOs con `additionalProperties:false` y validación estricta. |
| Repositorios/URLs arbitrarios | `QuantumDtos.FORBIDDEN_PARAM_KEYS` rechaza `repository/url/code/command/plugin/credentials/...`. |
| Repositorios JPA arbitrarios | Solo repositorios tipados por dominio; sin `JpaRepository` genérico expuesto. |
| Falta de idempotencia | `IdempotencyService` con `tenant_id + idempotency_key` único; hash de payload; 409 en conflicto. |
| Sin control de concurrencia | `@Version` en `CharacterEntity`; conflicto → 409. |
| Auditoría insuficiente | `AuditService` durable en toda mutación; endpoint `/audit/events` solo con `SCOPE_read:audit`. |
| Despliegue sin supply chain | Docker no-root, `readOnlyRootFilesystem`, NetworkPolicy deny-all, CI con Trivy + SBOM + firma + digest inmutable. |
| Rate limit ausente | `RateLimitFilter` por tenant+subject+client+IP; 429 con `Retry-After` y `X-RateLimit-*`. |
| Timeouts / circuit breaker | `jdr.external.*` timeouts; sin fallback para authz/tenant/audit (fail-closed). |

## Decisiones de diseño
- **Deny-by-default**: cualquier ruta no listada explícitamente es `authenticated()`.
- **Mínimo privilegio**: scopes granulares (`read/write/delete:characters`, `exec:quantum`, `read:audit`, ...).
- **Fallo cerrado**: autenticación, autorización, aislamiento de tenant, kill switch e
  integridad de auditoría nunca tienen fallback permisivo.

## Supuestos
- El issuer OIDC es confiable y expone JWKS.
- Isabella (fuera de este módulo) mantiene la autoridad de identidad, políticas y
  gobernanza cuántica.
- El broker de eventos (outbox → memoria/auditoría/quantum) se conecta en un paso
  posterior; mientras tanto `NoOpEventPublisher` registra el dispatch.

## Criterios de salida a producción
threat model aprobado · OpenAPI lint limpio · JWT/JWKS probado · tenant isolation
probado · rate limit probado · idempotencia probada · migraciones probadas · backup y
restore probado · SBOM generado · imagen escaneada · secrets fuera de Git · runbook de
rollback · prueba de carga · prueba de recuperación · revisión de seguridad.
