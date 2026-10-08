# Hypercore — protocolo y máquina de estados

**Versión:** 1.0.0 · **Esquema de decisión:** `isabella.hypercore.decision.v1`.

## 1. Máquina de modos

```
                 presupuesto sano
   ┌────────────────────────────────┐
   │             CRUISE             │
   └───────────────┬────────────────┘
      latencia o complejidad altas │
                                   ▼
   ┌────────────────────────────────┐
   │              BOOST             │
   └───────────────┬────────────────┘
        presupuesto crítico │
                            ▼
   ┌────────────────────────────────┐
   │           HYPERBOOST           │
   └────────────────────────────────┘
```

Criterios deterministas (ver `decideHypercore`):

1. Si `risk ∈ {high, critical}`: `BOOST` si `remainingMs < 900`, si no `CRUISE`.
2. Si `remainingMs < 500` o `complexity ≥ 0.8`: `HYPERBOOST`.
3. Si `remainingMs < 1400` o `complexity ≥ 0.55`: `BOOST`.
4. En otro caso: `CRUISE`.

## 2. Reglas de activación de nitros

```
PREFIX_CACHE        siempre
SEMANTIC_CACHE      solo si risk ∈ {low, medium}
DRAFT_MODEL         mode ≠ CRUISE y risk no elevado
PARALLEL_BRANCHES   DRAFT activo y (HYPERBOOST o complexity ≥ 0.7)
VERIFIER_FANOUT     siempre
EARLY_EXIT          solo si HYPERBOOST y risk ∈ {low, medium}
```

## 3. Protocolo de tiempo agotado

- El deadline se propaga a clasificación, recuperación, generación y verificadores.
- Timeout, error o resultado malformado de un control obligatorio equivale a `deny/unknown`, nunca a `allow`.
- `AbortController` local no garantiza cancelar efectos externos si el adaptador/proveedor no respeta
  la señal. Para tools con side effects se requiere idempotency key, registro de operación, estado
  `pending/committed/failed` y reconciliación.
- No transmitir tokens especulativos al cliente antes de superar los controles de salida. Streaming
  seguro requiere buffer por segmentos y rail de salida antes de cada segmento; si no existe, usar
  respuesta no streaming.

## 4. Contrato de decisión

```json
{
  "ok": true,
  "schema": "isabella.hypercore.decision.v1",
  "decision": {
    "mode": "BOOST",
    "turbos": ["VECTOR", "SPECULATIVE", "VERITAS"],
    "activatedNitro": ["PREFIX_CACHE", "SEMANTIC_CACHE", "DRAFT_MODEL", "VERIFIER_FANOUT"],
    "mandatoryGateRequired": true,
    "earlyExitAllowed": false,
    "governanceInvariant": "PRESERVED",
    "reason": "mode=BOOST;risk=medium;complexity=0.62;remainingMs=900"
  }
}
```

## 5. Contrato de ejecución

```json
{
  "ok": true,
  "answer": "...",
  "mode": "BOOST",
  "elapsedMs": 412,
  "checks": {
    "input": { "ok": true },
    "policy": { "ok": true },
    "evidence": { "ok": true },
    "safety": { "ok": true }
  },
  "memoryHitCount": 3,
  "cache": "miss",
  "decision": { "...": "..." },
  "traceId": "req_01J..."
}
```

No exponer mensajes internos de fallo al usuario final; convertirlos en códigos de error públicos
estables y mantener detalles en logs restringidos.

## 6. Códigos de respuesta HTTP

| Estado | Significado |
| --- | --- |
| `200` | Respuesta aceptada tras superar los controles obligatorios. |
| `400` | Solicitud inválida. |
| `401` | No autenticado. |
| `403` | Política o permisos denegados. |
| `422` | Verificación fallida (fail-closed). |
| `429` | Cuota excedida. |
| `503` | Adaptadores o verificador no disponibles; fallo cerrado. |
| `504` | Deadline agotado. |
