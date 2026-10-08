# 09 — Plantillas y Artefactos

> **Estado:** Vigente (PLANTILLA/ARTEFACTO) — **Propietario:** Arquitectura — **Revisión:** 2026-10-07
> Índice canónico de las plantillas y artefactos exportables del paquete. Cada artefacto tiene fecha y está
> versionado en `artifacts/`.

## 1. Contrato de API

| Artefacto | Ruta | Estado |
| --- | --- | --- |
| OpenAPI v2 (ampliado, corregido C1–C4) | [`artifacts/openapi.yaml`](artifacts/openapi.yaml) | Canónico |

Endpoints cubiertos: `health`, `auth/me`, `users`, `ingest`, `ingest/{id}/status`, `doc/{id}`,
`doc/{id}/evidence`, `search`, `pipeline/{ingest_id}/rerun`, `pipeline/runs/{run_id}`, `verifications/{id}`,
`cert/{cert_id}/verify`, `audit/logs`, `admin/revoke/{cert_id}`.

## 2. Paquete legal (plantillas)

| Plantilla | Ruta | Notas |
| --- | --- | --- |
| Términos de Servicio | [`artifacts/legal/01-TOS.md`](artifacts/legal/01-TOS.md) | Revisión jurídica local antes de uso |
| DPA (Processor) | [`artifacts/legal/02-DPA.md`](artifacts/legal/02-DPA.md) | GDPR + SCC; lista de subprocesadores pendiente |
| DUA (datasets sensibles) | [`artifacts/legal/03-DUA.md`](artifacts/legal/03-DUA.md) | Niveles de acceso alineados con `visibility` del OpenAPI |
| Contrato de Revisor (NDA) | [`artifacts/legal/04-CONTRATO-REVISOR.md`](artifacts/legal/04-CONTRATO-REVISOR.md) | Firma + `review_event` en ledger |
| Anexos técnicos comunes | [`artifacts/legal/05-ANEXOS-TECNICOS.md`](artifacts/legal/05-ANEXOS-TECNICOS.md) | Incluye corrección de retención (coherencia con `03` §5) |

## 3. Metadatos JSON-LD (formato de ingestión)

Esquema canónico según `Metadata` en `artifacts/openapi.yaml`. Campos obligatorios: `@type`, `headline`, `author`
(mínimo 1, ORCID canónigo cuando se aporte), `license`. Campos condicionales: `environment_spec`
(`dockerfile`, `conda_env`, `run_command`), `assertions[]` (`path`, `metric`, `tolerance`). Reglas de validación:
`02-manual-tecnico-operativo.md` §3.

## 4. Salidas de verificación y VC

- Reporte de verificador: `id, pipeline_run_id, type, score, result (pass|warn|fail), report_s3_key,
  evidence_hashes, service_signature`.
- VC emitida por `src/lib/igds`: `credentialSubject { document_id, level, issued_at, issuer, merkle_root }` + prueba
  criptográfica (firma HSM). Claims mínimos y estructura en `06-plan-certificacion-y-auditoria.md` §4.
- Plantilla de salida de revisión humana (JSON) en `07-playbooks-operativos.md` — Playbook 1.

## 5. Checklist de verificación (plantilla)

- [ ] Metadatos JSON-LD válidos y `merkle_root` registrado en ledger.
- [ ] `aggregate_score` calculado con pesos de `02-manual` §4.2.
- [ ] Bandera crítica revisada (similitud > 0.35, refs < 0.5).
- [ ] COI de revisores validado por cruces automáticos.
- [ ] Firma de revisión registrada (`review_event`).
- [ ] Sello emitido con `vc_hash`, o rechazo comunicado con derecho de apelación.
- [ ] Si Nivel 3: `reproducibility_report` con logs y hashes.
- [ ] Si Nivel 4: informe de auditor externo independiente vigente.

## 6. Artefactos reproducibles (piloto) — pendiente de integración

El paquete de scripts/Dockerfile (`Dockerfile`, `requirements.txt`, `reproduce.py`, dataset sintético,
script de comparación y manifest) se integrará como módulo canónico entregado por el responsable
(registro pendiente en `00-INDICE.md` §8) en `artifacts/reproducibility/`.

## 7. Artefactos exportables

Su versión canónica se generará al integrarse los módulos restantes (`.puml`, `.yaml`, `.md`, `.csv`, scripts).
Los bloques PlantUML canónicos ya están embebidos en `01-blueprint-arquitectonico.md` §3 y §4.