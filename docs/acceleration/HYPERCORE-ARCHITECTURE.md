# Hypercore — arquitectura

**Versión:** 1.0.0 · **Estado:** implementado; adaptadores productivos pendientes de cableado.

## 1. Objetivo

Reducir latencia extremo a extremo sin transformar la urgencia en una excepción de seguridad.
Hypercore optimiza trabajo redundante, selección de ruta, recuperación de memoria, concurrencia y
longitud de contexto. **No** promete «0 a un millón en microsegundos»: esa cifra no es una métrica
operativamente plausible para una petición remota que requiere inferencia y verificaciones.

## 2. Planos

```
                     PETICIÓN
                        │
                        ▼
                  AUTH / RATE / TENANT
                        │
                        ▼
              ┌─────── HYPERCORE ───────┐
              ▼            ▼            ▼
           VECTOR     SPECULATIVE    VERITAS
        (2 nitros)    (2 nitros)    (2 nitros)
              └────────────┼────────────┘
                           ▼
                   AUTHORITY PLANE
             (CROWN · policy · evidence)
                           │
                           ▼
                     TARGET MODEL
                           │
                           ▼
                   OUTPUT SECURITY
                           │
                           ▼
                       RESPUESTA
```

El plano de aceleración **no** sustituye la autoridad existente: se invoca después de autenticación
y antes de las operaciones costosas de inferencia.

## 3. Flujo de ejecución

1. Crear `requestId`, tenant autenticado y deadline monotónico.
2. `inputPolicy` y `classify` en paralelo.
3. Denegar inmediatamente si el gate de entrada deniega.
4. Elegir modo y nitros según riesgo, complejidad y presupuesto restante.
5. Recuperar memoria con aislamiento de tenant y procedencia.
6. Generar un candidato (con draft/paralelismo si el modo lo permite); no exponerlo aún.
7. Ejecutar política, evidencia y seguridad de salida (fan-out; `EARLY_EXIT` solo en riesgo bajo).
8. Publicar solo si todas las comprobaciones obligatorias devuelven `ok: true` antes del deadline.
9. Escribir caché solo tras aprobación y solo para riesgo bajo.
10. Emitir telemetría agregada sin prompt, memoria ni respuesta por defecto.

## 4. Contrato de adaptadores

La interfaz está en `src/lib/acceleration/hypercore.ts` (`HypercoreAdapters`). Los adaptadores reales
deben conectarse a los servicios existentes de Isabella:

- `classify`: clasificación barata y calibrada, con fallback conservador.
- `inputPolicy`: reglas deterministas y controles de abuso antes de generar.
- `retrieve`: memoria aislada por tenant, autorización, consentimiento, procedencia y TTL.
- `generate`: gateway de modelos existente; debe propagar `AbortSignal` al proveedor.
- `policyCheck`, `evidenceCheck`, `outputSafety`: verificadores independientes con resultado estricto.

## 5. Seguridad y gobernanza

- Deny-by-default y controles obligatorios no degradables.
- Tool execution separado de generación; autorización server-side, allowlist y validación de argumentos.
- Versionar políticas y asociar versión/hash a cada decisión (huella de política en la clave de caché).
- Memoria con procedencia, consentimiento, borrado, TTL y aislamiento por tenant.
- No aprender automáticamente de una respuesta solo porque fue generada o aceptada.
- Kill switch por motor/nitro: si un rail se degrada, desactivar aceleración, no seguridad.

## 6. Telemetría y SLO

Histogramas de `time_to_first_token`, `end_to_end_ms`, latencia por rail, tokens de entrada/salida,
cache hit rate, rechazo por política, timeout, cancelación efectiva, errores por proveedor,
profundidad de cola, memoria recuperada y porcentaje de salida bloqueada. Segmentar por versión,
ruta y clase de riesgo; evitar etiquetas de alta cardinalidad con IDs personales.

Objetivos iniciales para **ensayo** (no afirmaciones de rendimiento): p50/p95/p99 por clase de tarea,
tasa de bloqueo falso positivo/negativo, coste por respuesta aceptada, tasa de caché obsoleta y
disponibilidad de cada rail. Los SLO se fijan tras medir baseline real.

## 7. Plan de implementación

1. Adaptar la interfaz a gateway y rails reales sin cambiar el comportamiento por defecto.
2. Tests de contrato por adaptador, cancelación y resultados malformados.
3. Benchmark reproducible baseline vs. Hypercore con la misma carga.
4. Shadow mode sin afectar respuestas; comparar latencia, decisiones y coste.
5. Canary por porcentaje de tráfico, con kill switch y rollback.
6. Activar gradualmente solo si no empeoran las métricas de seguridad y calidad.

## 8. Limitaciones conocidas

Es una orquestación de referencia, no un sistema autónomo completo. La clave de caché debe
sustituirse por HMAC de producción. La clasificación no sustituye el control de acceso. El timeout
no garantiza cancelar proveedores que ignoren `AbortSignal`. El rendimiento debe medirse con
adaptadores y carga reales.
