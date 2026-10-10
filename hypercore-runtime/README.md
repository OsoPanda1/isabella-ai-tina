# Isabella Hypercore Runtime (functional reference)

Runtime de referencia ejecutable (Node.js 22+) para el diseño de **tres turbos / seis nitros**.
Usa únicamente módulos nativos de Node, por lo que es ejecutable y testeable sin dependencias.
El adaptador incluido es **determinista (demo)**; NO es el LLM real de Isabella. Sustituya
`demoAdapter()` por los servicios auténticos de modelo, memoria y política antes de tráfico real.

## Motores

| Turbo | Nitros | Función |
| --- | --- | --- |
| **VECTOR** | `PREFIX_CACHE`, `SEMANTIC_CACHE` | Reutilizar trabajo ya validado bajo la misma huella de política. |
| **SPECULATIVE** | `DRAFT_MODEL`, `PARALLEL_BRANCHES` | Producir candidatos verificables; un draft nunca es verdad por sí mismo. |
| **VERITAS** | `VERIFIER_FANOUT`, `EARLY_EXIT` | Verificar en paralelo; `EARLY_EXIT` se prohíbe en riesgo elevado. |

Los modos (`CRUISE`, `BOOST`, `HYPERBOOST`) alteran estrategia y presupuestos, **nunca** eliminan
el `mandatoryGate` (policy + evidence + safety).

## Run

```bash
cd hypercore-runtime
node --test
HYPERCORE_API_KEY=local-dev-key node src/server.mjs
```

Luego:

```bash
# Decisión (plano de aceleración, sin efectos secundarios)
curl -s http://localhost:8787/v1/hypercore/decide \
  -H "Authorization: Bearer local-dev-key" -H "content-type: application/json" \
  -d '{"latencyBudgetMs":200,"complexityScore":0.9,"risk":"low","policyFingerprint":"policy-v1"}'

# Ejecución (adaptador determinista)
curl -s http://localhost:8787/v1/hypercore/run \
  -H "Authorization: Bearer local-dev-key" -H "content-type: application/json" \
  -d '{"requestId":"demo-001","tenantId":"tenant-demo","prompt":"Explain the purpose of a cache","risk":"low","deadlineMs":1500}'
```

`GET /health` no requiere autenticación y no expone secretos. En producción use un proveedor de
identidad real y credenciales de servicio con alcance, no esta clave única de prototipo.

## Seguridad y límites

- Los checks obligatorios faltantes o fallidos fallan en cerrado. La presión de deadline nunca exime checks.
- La caché es en memoria, con alcance tenant/riesgo/prompt, de vida corta y solo para respuestas exactas de riesgo bajo. No es durable.
- El generador demo es determinista y no es el modelo real de Isabella.
- La señal de aborto se propaga a los adaptadores; los efectos externos requieren idempotencia.
- No introducir secretos, datos personales ni prompts confidenciales en logs.
