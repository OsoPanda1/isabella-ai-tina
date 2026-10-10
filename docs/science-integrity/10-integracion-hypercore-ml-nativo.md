# 10 — Integración con Hypercore y ML Nativo de Isabella (Fase B)

> **Estado:** Vigente (PLAN) — **Propietario:** Arquitectura — **Revisión:** 2026-10-07
> Este documento es la **especificación del puente** hacia la implementación real de las librerías nativas de
> Isabella, interconectadas con el **ML nativo** y el **Hypercore de Isabella**, tal como establece la directiva de
> la Fase A → Fase B. Nada de esto está implementado aún: es el contrato de integración.

## 1. Principio del puente

Los pipelines de "Verificación y Certificación de Integridad Científica" **no se implementan como microservicios
foráneos**, sino que se materializan sobre los módulos nativos ya existentes de Isabella. La información debe fluir
**realmente** por el repositorio: ledger, epistemología, ML gobernado y rails de aceleración.

## 2. Mapeo de componentes del blueprint → módulos Isabella reales

| Componente del blueprint | Módulo Isabella (ruta real) | Palanca |
| --- | --- | --- |
| Ledger inmutable de eventos | `src/lib/ledger/`, `src/lib/bookpi/`, `src/lib/repositories/approval-repository.ts` | eventos `ingest/verification/review/certification_event` encadenados por hash |
| Sellos de procedencia y firmas | `src/lib/igds/`, `src/lib/signatures/` | VC + firma HSM; alinea con `docs/security/ATTESTATION-SIGNATURES.md` |
| Epistemología y niveles de confianza | `src/lib/ncua/` (academic-pipeline, audit-bundle, concept-engine, eri) | mapeo NCUA E0–E4 ↔ niveles 0–4 de certificación |
| Verificador de afirmaciones (NLP) | `src/lib/claim-radar/` (claim-radar.ts, contracts.ts) | `nlp_claims` → soporte de afirmaciones vs fuentes citadas |
| Verificadores ML nativos | `src/lib/native-ml/` (text-classifier, canonical-engine, moe-native, governed-ml), `src/lib/intelligence/` (moe, transports, tri-hepta) | clasificadores de señales, calibración, canary y drift |
| Orquestación de verificadores | `src/lib/acceleration/hypercore.ts` + `hypercore-adapters.ts` + `hypercore-routes.ts` (rutas `/api/v1/isabella-hypercore`) | Hypercore como rail de ejecución/aceleración y de registros |
| Autorización de decisiones | `src/lib/security/`, `authz/`, `policy/`, `kill-switch/`, `escudo/` | `withSovereignAuth`, rate-limit, fail-closed |
| Reproducibilidad | `src/lib/sandbox/` (entornos aislados) + contratos de `claim-radar` (`contracts.ts`) | ejecución contenida con `assertions[]` y tolerancias |
| Métricas/KPIs | `src/lib/telemetry/`, `statsig/`, `governance/`, `monetization/` | dashboards de precisión, FP/FN y drift |

## 3. Arquitectura de integración (flujo real de datos)

```
POST /api/v2/ingest (JSON-LD + artefactos)
   → Ingest adapter (src/routes) valida JSON-LD con zod + normativa del contrato OpenAPI v2
   → Ledger: ingest_event(merkle_root)        [src/lib/bookpi|ledger]
   → Hypercore: registra run + metadatos       [src/lib/acceleration]
   → Pipeline de verificación:
       · claim-radar.extractClaims()          → claims con contracts.ts
       · native-ml.textClassifier(...)        → señales plagi/sospecha (governed-ml + drift gates)
       · ncua.academicPipeline(...)           → puntuación epistemológica E0–E4
       · intelligence/transports (remote providers) → evidencia externa opcional
   → Agregación de score (reglas de decisión de 02-manual §4.2)
   → Si humano: workflow de revisión con signatures → review_event
   → Certificación: IGDS seal + VC firmada    [src/lib/igds]
   → Hypercore: certification_event + public search index
```

## 4. Contratos de eventos (ledger)

| Evento | Campos mínimos |
| --- | --- |
| `ingest_event` | `doc_id, merkle_root, schema_version, ts` |
| `pipeline_run` | `doc_id, pipeline_id, version, aggregate_score, status` |
| `verification_event` | `doc_id, verifier, score, result, evidence_hashes` |
| `review_event` | `doc_id, reviewer_orcid, decision, review_signature` |
| `certification_event` | `doc_id, vc_hash, issuer, level, ledger_tx` |
| `revocation_event` | `cert_id, reason, ledger_tx` |
| `appeal_event` | `doc_id, author, outcome, panel_decision` |

## 5. Reglas de integridad del puente

1. **Un solo ledger:** toda mutación de estado pasa por `src/lib/bookpi`/`src/lib/ledger`; el Hypercore es rail y
   registro de corrida, no fuente única de verdad.
2. **Sellos nativos:** VC emitidas por `src/lib/igds`; verificación pública reutiliza las insignia/rotación de
   `ATTESTATION-SIGNATURES.md`.
3. **ML gobernado:** verificación por `native-ml` con canary + drift (`docs/ml/DRIFT.md`); sin promoción sin
   métricas de sesgo/equidad.
4. **Fail-closed:** sin proveedor disponible, no se emite sello; la ruta devuelve 503 (patrón ya usado en la ruta
   voice endurecida).
5. **Reproducibilidad contenida:** todo código del autor se ejecuta en `src/lib/sandbox`, nunca en el entorno del
   revisor (C5).

## 6. Fases de implementación nativa (Fase B)

| Fase | Alcance | Criterio de salida |
| --- | --- | --- |
| B0 | Adapters de ingestión JSON-LD + hash/merkle en ledger | Test e2e de ingest→ledger |
| B1 | Verificador `nlp_claims` sobre `claim-radar` | 100 casos de contrato pasando |
| B2 | Clasificadores `native-ml` con gates governed-ml | Precisión ≥ objetivo; drift gates verdes |
| B3 | Pipeline Hypercore con reglas de decisión | Smoke del flujo completo en `/api/v1/isabella-hypercore` |
| B4 | Revisión humana + firma + `review_event` | Revisión e2e firmada en ledger |
| B5 | Emisión VC/IGDS + verificación + revocación | Cert emitido y verificado por endpoint |
| B6 | Auditoría, KPIs y hardening total (blindaMax) | Gates: lint, typecheck, tests, secret:scan |

## 7. Riesgos y controles del puente

| Riesgo | Control |
| --- | --- |
| Drift de modelos nativos | DRIFT + canary + umbrales por disciplina |
| Ledger desincronizado | Single source of truth (~§5.1) + tests de integridad de hash |
| Ejecución no sandboxeada | `src/lib/sandbox` obligatorio; prohibición C5 en playbooks |
| Sello sin auditoría | Nivel 4 solo con auditor externo independiente (≤ 3 años) |

## 8. Estado de activación

- **[TESTED]** Fase B implementada en `src/lib/science-integrity/` (B0–B6) e interconectada con los módulos nativos:
  - **B0** `ingest.ts` (JSON-LD + Merkle RFC 6962 + `ingest_event`/`verification_event`) · **B1** `claims.ts`
    (claim-radar real, 100 casos de contrato) · **B2** `classifiers.ts` (native-ml + gates governed-ml)
    · **B3** `pipeline.ts` (reglas §4.2, umbrales 0.70/0.90, banderas críticas, fail-closed) + `hypercore.ts`
    (rail `executeHypercore` real) · **B4** `review.ts` (firma Ed25519) · **B5** `certification.ts`
    (VC/IGDS, verificación con revocación) · **B6** gates limpios + tests.
  - Superficie: `routes.ts` montada en `server.ts` (`/api/v1/science-integrity/*`); runtime por defecto en `runtime.ts`.
  - Evidencia same-commit: `test/unit/science-integrity/` (33 tests) + typecheck 0 + suite completa
    `1258 passed / 9 skipped` (2026-10-08). Registro en `00-INDICE.md` §8.
- **Honestidad:** estado **TESTED** (local), no **CERTIFIED**. Faltan para producción/Nivel 4: TSA/hardening
  HSM-KMS, persistencia PostgreSQL del ledger (`approval-repository` en memoria es referencia), cableado de
  adaptadores MCP en runtime, auditoría externa independiente y CI remoto.
- Deuda técnica conocida para la Fase B: rutas OpenAPI `/api/v2/*` (aún no mapeadas al router),
  integración `claim-radar` ↔ `intelligence` no probada, y HAR de sellos IGDS con procesadores HSM opcionales.