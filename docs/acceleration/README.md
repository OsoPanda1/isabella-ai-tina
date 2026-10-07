# Isabella Hypercore — aceleración adaptativa gobernada

**Versión:** 1.0.0 · **Fecha:** 2026-10-06 · **Estado:** implementado y cableado; adaptadores productivos pendientes.

Hypercore es la capa de aceleración adaptativa de Isabella. Convierte la analogía del _Tsuru con
turbos_ en un mecanismo técnico: el núcleo ordinario y resistente (CROWN, autorización,
policy-as-code, evidencia, output-security) permanece como **autoridad final**; los turbos
reducen latencia sin comprar velocidad a costa de seguridad.

> **Regla de honestidad:** Hypercore acelera la ejecución, **nunca** la autoridad. La velocidad no
> puede convertirse en una excepción para CROWN, autorización, policy-as-code, evidencia,
> output-security ni aprobación humana.

## Tres turbos, seis nitros

| Turbo | Nitro | Función |
| --- | --- | --- |
| VECTOR | `PREFIX_CACHE` | Reutilizar cómputo de prefijos estables (sistema, política, contexto). |
| VECTOR | `SEMANTIC_CACHE` | Reutilizar resultados validados bajo la misma huella de política. |
| SPECULATIVE | `DRAFT_MODEL` | Generar candidatos económicos que nunca son respuesta final por sí mismos. |
| SPECULATIVE | `PARALLEL_BRANCHES` | Probar varios candidatos/rutas en paralelo. |
| VERITAS | `VERIFIER_FANOUT` | Ejecutar comprobaciones independientes en paralelo. |
| VERITAS | `EARLY_EXIT` | Reducir comprobaciones redundantes; **prohibido** en riesgo elevado. |

## Máquina de aceleración

| Modo | Criterio | Acción |
| --- | --- | --- |
| `CRUISE` | Presupuesto sano | Ruta normal + reutilización segura. |
| `BOOST` | Presión de latencia o complejidad alta | Cache + paralelismo + especulación selectiva. |
| `HYPERBOOST` | Presupuesto crítico | Máxima aceleración permitida por política. |

## Invariantes

1. Ningún turbo ni nitro concede autoridad.
2. El `mandatoryGate` (policy + evidence + safety) se ejecuta **siempre**.
3. Timeout, error o resultado malformado de un rail obligatorio equivale a **DENY**, nunca a **ALLOW**.
4. La caché nunca concede autorización y solo se escribe tras aprobar el gate.
5. Un draft nunca se emite como respuesta final sin verificación del target y del gate.

## Implementación

| Artefacto | Rol |
| --- | --- |
| `src/lib/acceleration/hypercore.ts` | Motor unificado (decisión + pipeline gobernado + caché + telemetría). |
| `src/lib/acceleration/hypercore-routes.ts` | Superficie HTTP Express. |
| `src/routes/api/v1/isabella-hypercore.ts` | Superficie TanStack/Nitro. |
| `hypercore-runtime/` | Runtime de referencia ejecutable (Node nativo) + tests. |
| `test/unit/acceleration/hypercore.test.ts` | Pruebas del motor y de los invariantes. |

## API

```
GET  /api/v1/isabella/hypercore          → metadatos (turbos, nitros, invariantes)
POST /api/v1/isabella/hypercore/decide   → decisión (plano de aceleración)
POST /api/v1/isabella/hypercore/run      → ejecución gobernada
```

`/run` requiere adaptadores productivos. Sin ellos, en producción responde `503` (fail-closed)
en lugar de simular inferencia.

## Documentos

- [`HYPERCORE-ARCHITECTURE.md`](./HYPERCORE-ARCHITECTURE.md) — arquitectura y evolución.
- [`HYPERCORE-PROTOCOL.md`](./HYPERCORE-PROTOCOL.md) — protocolo y máquina de estados.
- [`hypercore.manifest.json`](./hypercore.manifest.json) — contrato machine-readable.
- [`../../hypercore-runtime/README.md`](../../hypercore-runtime/README.md) — runtime ejecutable.
