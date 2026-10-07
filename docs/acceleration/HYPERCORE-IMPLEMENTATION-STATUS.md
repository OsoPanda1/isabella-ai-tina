# Hypercore — estado de implementación

**Versión:** 1.0.0 · **Fecha:** 2026-10-06 · **Clasificación global:** IMPLEMENTED · **Certificación:** EXPERIMENTAL.

> Regla de honestidad (AGENTS.md): código existente ≠ capacidad verificada; un test local ≠ producción;
> build verde ≠ certificación.

## Componentes

| Componente | Ruta | Estado | Evidencia |
| --- | --- | --- | --- |
| Motor de decisión y pipeline | `src/lib/acceleration/hypercore.ts` | IMPLEMENTED / TESTED | 10 tests vitest |
| Superficie Express | `src/lib/acceleration/hypercore-routes.ts` | IMPLEMENTED | cableado en `server.ts` |
| Superficie TanStack/Nitro | `src/routes/api/v1/isabella-hypercore.ts` | IMPLEMENTED | registro en `types/tanstack-file-routes.d.ts` |
| Runtime de referencia | `hypercore-runtime/` | IMPLEMENTED / TESTED | 10 tests `node --test` |
| Documentación | `docs/acceleration/` | IMPLEMENTED | arquitectura, protocolo, OpenAPI, manifiesto |
| Adaptadores productivos | — | PLANNED | `/run` fail-closed 503 en producción |

## Capacidades

- **IMPLEMENTED:** máquina de modos determinista, activación de nitros, `mandatoryGate` fail-closed,
  fan-out de verificación, `EARLY_EXIT` condicionado, caché TTL tenant-scoped, telemetría agregada
  sin contenido.
- **TESTED:** invariantes de autoridad, fail-closed, aislamiento de caché, invalidación por política,
  validación de entrada, expiración TTL.
- **SIMULATED:** adaptador determinista (`deterministicHypercoreAdapter` / `demoAdapter`) — solo
  test/desarrollo, prohibido en producción.
- **PLANNED:** adaptadores de modelo, memoria, política, evidencia y output-security reales;
  benchmark, shadow mode y canary.
- **BLOCKED:** `/run` productivo hasta que existan dichos adaptadores (responde 503 fail-closed).

## Limitaciones conocidas

- La caché es en memoria y no durable: para multi-instancia requiere backend compartido.
- La clave de caché usa SHA-256; producción debe usar HMAC con secreto server-side.
- El timeout local no cancela proveedores que ignoren `AbortSignal`.
- El rendimiento debe medirse con adaptadores y carga reales; no se declaran cifras de velocidad.

## Declaración

Hypercore está **implementado y probado en local**, **no certificado** para producción. Su
integración productiva exige cablear adaptadores reales y superar el plan de validación
(`HYPERCORE-VALIDATION-PLAN.md`).
