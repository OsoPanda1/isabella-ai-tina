# Aislamiento multi-tenant (nivel de aplicación)

> state: draft | engine-generated.
> **SPECIFIED ≠ IMPLEMENTED ≠ TESTED ≠ INTEGRATED ≠ VERIFIED ≠ DEPLOYED ≠ CERTIFIED**.

Este documento describe el verificador de aislamiento multi-tenant
**a nivel de aplicación**. No verifica RLS ni seguridad a nivel de base de
datos, no es una frontera a prueba de manipulación y no sustituye una auditoría
humana.

## Modelo

- El **tenant** de un principal se toma de la identidad verificada en backend
  (`Principal.tenantId`). Un claim de UI nunca es autoridad
  (ver `src/companion/ui-context-guard.ts`).
- Un **registro** es `{ resourceId, tenantId }`. El verificador solo observa
  registros que se le entregan; no consulta la base de datos por sí mismo.

## API (`src/tenancy/isolation.ts`)

```ts
verifyTenantIsolation(principal, records, now?) : TenantIsolationReport
coerceTenantRecords(input) : readonly TenantRecord[]
assertTenantScope(principal, resource) : void   // fail-closed
```

`verifyTenantIsolation` clasifica:

| Estado               | Condición                                                  |
| -------------------- | ---------------------------------------------------------- |
| `ISOLATED`           | Todos los registros coinciden con el tenant del principal. |
| `VIOLATION_DETECTED` | Al menos un registro pertenece a otro tenant (fuga).       |
| `NOT_ASSESSED`       | Falta el tenant del principal o de algún registro.         |

El reporte declara siempre `coverage: "APPLICATION_LEVEL_RECORD_TENANT_CHECK"`,
`databaseRlsVerified: false` y `tamperProofBoundary: false` para no sobredeclarar
la garantía.

`assertTenantScope` lanza `TENANT_ISOLATION_VIOLATION` si el principal no declara
tenant (fail-closed) o si el recurso está fuera de su tenant.

## Integración con tools

El tool `tenant_isolation_verify` (`src/tools/catalog.ts`, method-id
`N.IDENTITY.E03_GOVERNANCE.verify_tenant_isolation.v1.0.0.MEDIUM.CONSTITUTIONAL`)
ejecuta `verifyTenantIsolation` sobre los registros del input. Acepta
`resources`/`records` (o un arreglo directo); normaliza con
`coerceTenantRecords` y devuelve el reporte.

## Pruebas

`test/tenancy/isolation.test.ts`: ISOLATED, VIOLATION_DETECTED (conteo de fugas),
NOT_ASSESSED por principal sin tenant, NOT_ASSESSED por registro sin tenant,
lista vacía, coerciones y fail-closed de `assertTenantScope`.

## Pendiente (no presentar como terminado)

1. Verificación real de RLS/políticas en Postgres con dataset multi-tenant.
2. Resolución del tenant del principal dentro del request HTTP (no solo en tools).
3. Pruebas negativas end-to-end sobre los endpoints de billing/commerce.
