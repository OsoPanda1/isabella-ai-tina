# 06 — Plan de Certificación y Auditoría

> **Estado:** Vigente (PLAN) — **Propietario:** Gobernanza — **Revisión:** 2026-10-07

## 1. Niveles de certificación

| Nivel | Nombre | Requisito | Sello |
| --- | --- | --- | --- |
| 0 | Sin sello | No solicitado/rechazado | — |
| 1 | Verificación automática | Pipeline completo con `aggregate_score >= 0.90` y sin bandera crítica | Sello "Verificado automáticamente" |
| 2 | Revisión humana | Nivel 1 + revisión humana completa con firma | Sello "Revisión experta" |
| 3 | Reproducibilidad | Nivel 2 + `repro_score` ≥ umbral con entorno y salidas verificadas | Sello "Reproducible" |
| 4 | Auditoría externa | Nivel 3 + auditoría de organismo acreditado + acreditación | Sello "Auditado y acreditado" |

## 2. Criterios por nivel

**Nivel 1 (automático)**
- `aggregate_score ≥ 0.90` sin banderas críticas (`similarity_index > 0.35`, `ref_resolution_rate < 0.5`).
- Hashes de artefactos registrados y consistentes (`merkle_root`).
- Metadatos JSON-LD válidos.

**Nivel 2 (humano)**
- Dos revisiones independientes (o una + verificación por coordinador) con `decision != reject`.
- Revisores sin COI y con ORCID verificado.
- Informe firmado (`review_signature`) y registrado como `review_event`.

**Nivel 3 (reproducibilidad)**
- `environment_spec` completo y ejecución en sandbox exitosa.
- `repro_score` ≥ umbral (0.80) y `assertions[]` cumplidas dentro de tolerancia.
- Logs y salidas hasheadas en el paquete de evidencia.

**Nivel 4 (auditoría externa)**
- Auditoría anual por organismo acreditado con resultado positivo (no conformidades cerradas).
- Evidencia: paquetes firmados, logs de ejecución, controles de acceso y políticas.
- Independencia del auditor (máximo 3 ejercicios consecutivos la misma firma).

## 3. Evidencia requerida

- Paquete de evidencia firmado por el servicio (`EvidencePackage`).
- Logs de ejecución de pipelines con `pipeline_id + version`.
- Informes de revisión firmados y eventos de ledger (`ingest/verification/review/certification_event`).
- Reportes de auditoría con hallazgos y plan de acción.

## 4. Emisión, verificación y revocación de sellos (VC)

- Emisión: al cumplir los criterios, el Certification Service construye el VC con
  `credentialSubject { document_id, level, issued_at, issuer, merkle_root }`, lo firma con la clave HSM y
  registra `certification_event(vc_hash, issuer, level)` en el ledger.
- Verificación pública: `GET /api/v2/cert/{cert_id}/verify` → `{ valid, evidence_hash, ledger_tx }`.
- Revocación: `POST /api/v2/admin/revoke/{cert_id}` con `reason` obligatorio → `{ cert_id, status: revoked, ledger_tx }`.
  El evento de revocación se registra y el sello pasa a `revoked`.
- Re-emisión tras corrección: solo con nuevo `merkle_root` y nueva corrida de verificación.

## 5. Auditoría externa

- Frecuencia: anual; alcance definido en el Playbook de Gobernanza (`07-playbooks-operativos.md`).
- Muestreo: certificados emitidos, corridas de pipeline, decisiones de revisión y revocaciones.
- Salida: informe de aseguramiento con no conformidades y plan de acción; revisión por el Comité.

## 6. Transparencia

- Changelog público de criterios y versiones de política.
- Publicación de métricas de precisión/FP/FN de verificadores (sin datos personales).
- Historial de apelaciones y retractaciones agregadas.