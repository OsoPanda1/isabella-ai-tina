# Hypercore — plan de validación

**Versión:** 1.0.0 · **Estado:** validación local completada para el motor y los invariantes; validación productiva pendiente de adaptadores reales.

## 1. Evidencia local (2026-10-06)

| Comprobación | Comando | Resultado |
| --- | --- | --- |
| Tests del motor (TS) | `pnpm exec vitest run test/unit/acceleration/hypercore.test.ts` | 10/10 PASS |
| Tests del runtime (Node nativo) | `pnpm hypercore:test` | 10/10 PASS |
| Tipos de los módulos nuevos | `tsc --noEmit` dirigido a `src/lib/acceleration/**` y `src/routes/api/v1/isabella-hypercore.ts` | 0 errores |
| Lint de los módulos nuevos | `eslint src/lib/acceleration/** src/routes/api/v1/isabella-hypercore.ts` | 0 errores |
| Build | `pnpm build` | SUCCESS (Nitro `.output/`, `.vercel/output/`) |

> El typecheck global del repositorio arrastra deuda heredada (247 errores preexistentes, no
> introducidos por Hypercore). La evidencia de los módulos nuevos se obtuvo con un `tsc` dirigido.

## 2. Casos cubiertos

- Escalado de modo conforme se agota el presupuesto (`CRUISE`→`BOOST`→`HYPERBOOST`).
- Preservación de la autoridad en riesgo elevado (sin `SEMANTIC_CACHE` ni `EARLY_EXIT`).
- `EARLY_EXIT` solo en `HYPERBOOST` de riesgo bajo.
- Publicación únicamente tras superar policy + evidence + safety.
- Fail-closed ante rail que deniega y ante rail que lanza.
- Rechazo de solicitudes malformadas sin ejecutar adaptadores.
- Caché aislada por tenant y limitada a riesgo bajo; invalidación por huella de política; TTL.

## 3. Validación productiva (pendiente)

1. **Contrato por adaptador:** tests que verifiquen forma estricta de `Verdict`, cancelación vía
   `AbortSignal` y resultados malformados.
2. **Benchmark reproducible:** baseline vs. Hypercore con idéntica carga y dataset congelado.
3. **Shadow mode:** sin afectar respuestas; comparar latencia, decisiones y coste.
4. **Canary:** porcentaje creciente de tráfico con kill switch y rollback.
5. **SLO:** fijar umbrales solo tras medir baseline real (no afirmar rendimiento no medido).

## 4. Criterios de aceptación

- 0 regresiones en las métricas de seguridad (bloqueos, fuga, política) respecto al baseline.
- Sin aumento de falsos negativos de los rails obligatorios.
- Latencia p95 no peor que el baseline fuera del objetivo declarado.
- Rollback verificado y documentado.

## 5. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Caché obsoleta tras cambio de política | Huella de política en la clave; TTL corto; solo riesgo bajo. |
| Proveedor ignora `AbortSignal` | Timeout server-side, idempotency key, reconciliación de estado. |
| `EARLY_EXIT` suprime verificación | Prohibido en riesgo elevado; gate obligatorio incondicional. |
| Draft se emite como final | Verificación obligatoria antes de publicar. |
