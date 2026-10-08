# 02 — Manual Técnico Operativo

> **Estado:** Vigente (PLAN/ARTEFACTO) — **Propietario:** Operaciones / Arquitectura — **Revisión:** 2026-10-07
> Contrato OpenAPI canónico: [`artifacts/openapi.yaml`](artifacts/openapi.yaml).

## 1. Contrato OpenAPI y uso

La especificación mínima viable está versionada como artefacto del paquete:
[`artifacts/openapi.yaml`](artifacts/openapi.yaml). Endpoints centrales:

| Ruta | Método | Propósito | Auth |
| --- | --- | --- | --- |
| `/api/v2/ingest` | POST | Ingesta de metadatos JSON-LD + archivos (multipart) | Bearer |
| `/api/v2/doc/{id}` | GET | Metadatos y estado del documento | Pública (firma opcional) |
| `/api/v2/search` | GET | Búsqueda avanzada con filtros (`filter[sello]`, `filter[status]`, `author_orcid`, `doi`) | Pública |
| `/api/v2/pipeline/{ingest_id}/rerun` | POST | Re-ejecución del pipeline de verificación | Bearer (rol `admin`/`reviewer`) |
| `/api/v2/cert/{cert_id}/verify` | GET | Verificación de validez de un certificado/sello | Pública |
| `/api/v2/doc/{id}/evidence` | GET | Paquete de evidencia firmado (acceso restringido) | Bearer (rol `auditor`) |

Notas de integración:
- Validar estrictamente el JSON-LD de metadatos en el Ingest Service (schema DataCite/Dublin Core extendido).
- Extender `components.securitySchemes` con scopes ABAC finos (p. ej. `scope: review`, `scope: audit`).
- Todos los eventos críticos (`ingest_event`, `verification_event`, `review_event`, `certification_event`)
  se escriben en el ledger con el `merkle_root` o `vc_hash` correspondiente.

## 2. Modelo de datos relacional (esquema canónico)

```sql
-- documentos: versión actual + estado
CREATE TABLE documents (
  id               UUID PRIMARY KEY,
  doi              TEXT,
  title            TEXT NOT NULL,
  current_status   TEXT NOT NULL DEFAULT 'draft', -- draft|queued|auto_verified|human_review|verified|certified|rejected|retracted
  version          TEXT NOT NULL DEFAULT '1.0.0',
  merkle_root      TEXT NOT NULL,                  -- SHA-256 root de artefactos
  ingest_date      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- hashes de cada artefacto
CREATE TABLE artifact_hashes (
  artifact_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id),
  sha256      TEXT NOT NULL,
  file_type   TEXT NOT NULL,
  size        BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- resultados de verificadores (1 fila por corrida)
CREATE TABLE verifications (
  verification_id UUID PRIMARY KEY,
  ingest_id       UUID NOT NULL,
  verifier        TEXT NOT NULL,   -- plagiarism|references|statistics|image_forensics|reproducibility|coi|nlp_claims
  pipeline_version TEXT NOT NULL,
  score           NUMERIC(5,2),
  evidence_url    TEXT,
  report_json     JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- revisiones humanas y firmas
CREATE TABLE reviews (
  review_id   UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id),
  reviewer_id TEXT NOT NULL,
  decision    TEXT NOT NULL,       -- approve|reject|more_info
  signature   TEXT NOT NULL,       -- ed25519 signature del revisor
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- certificaciones/sellos
CREATE TABLE certifications (
  cert_id     UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id),
  level       TEXT NOT NULL,       -- 0..4 (ver 06-plan-certificacion)
  issuer      TEXT NOT NULL,
  vc_hash     TEXT NOT NULL,       -- hash del Verifiable Credential
  ledger_tx   TEXT,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

-- ledger append-only encadenado por hash (alineado con el evidencia de Isabella)
CREATE TABLE ledger_events (
  seq      BIGSERIAL PRIMARY KEY,
  doc_id   UUID,
  event_type TEXT NOT NULL,
  payload  JSONB NOT NULL,
  prev_hash TEXT NOT NULL,
  hash     TEXT NOT NULL,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 3. Esquema JSON-LD (contexto ampliado)

Ejemplo de metadatos JSON-LD completos en [`09-plantillas-y-artefactos.md`](09-plantillas-y-artefactos.md)
(sección "JSON-LD completo"). Reglas de validación:

| Campo | Regla | Obligatorio |
| --- | --- | --- |
| `@type` | `ScholarlyArticle`, `Dataset` o `SoftwareSourceCode` | Sí |
| `headline` | 3–300 caracteres, sin HTML | Sí |
| `author[]` | al menos 1; `identifier` debe ser ORCID válido (`0000-0001-...`) si se aporta | Sí |
| `license` | IRI de licencia reconocida (CC-BY-4.0, Apache-2.0, MIT, …) | Sí |
| `doi` | formato DOI válido (sin espacios) | No |
| `conflictsOfInterest` | cadena libre o `none` | Recomendado |
| `environment_spec` | requerido para el verificador de reproducibilidad | Condicional |
| `version` | semver y coherente con `document.version` | Recomendado |

## 4. Pipelines de verificación

### 4.1 Tipos de verificador

| Verificador | Entrada | Método | Métrica de salida |
| --- | --- | --- | --- |
| `plagiarism` | texto extraído | API de similitud (servicio externo) con hashes de sites/fuentes | `similarity_index ∈ [0,1]` + report URL |
| `references` | lista de referencias | Resolución de DOI/Crossref + URLs | `ref_resolution_rate` + no-ISSN sospechosos |
| `statistics` | tablas/estadísticas declaradas | Estos comparan `assertions[]` contra datasets | `PASS/FAIL` por afirmación + tolerancia |
| `image_forensics` | imágenes | Detección de manipulación (ELA, metadatos, ruido) | `forensics_warnings[]` |
| `reproducibility` | `environment_spec` + `data_availability` + `code_availability` | Contenedor aislado, ejecución y comparación de salidas contra `assertions[]` | `repro_score ∈ [0,1]` + logs |
| `coi` | `conflictsOfInterest` | Análisis de texto + validación cruzada con revisores asignados | bandera `coi_reviewer_conflict` |
| `nlp_claims` | texto completo | Extracción de afirmaciones, hechos verificables e intersección con fuentes citadas | `claim_support_log` |

### 4.2 Reglas de decisión (agregación)

Indicador agregado por corrida del pipeline:

| Señal | Peso sugerido |
| --- | --- |
| `similarity_index` | 0.35 |
| `ref_resolution_rate` | 0.20 |
| `repro_score` | 0.25 |
| `statistics (PASS rate)` | 0.10 |
| `nlp_claims (soporte)` | 0.10 |

Umbrales de decisión:

| Rango agregado | Acción |
| --- | --- |
| `>= 0.90` | **Auto-verificado** habilitando sello de Nivel 2 provisional |
| `[0.70, 0.90)` | **Revisión humana** (cola por área temática) |
| `< 0.70` o flag crítico (`similarity_index > 0.35` o `ref_resolution_rate < 0.5`) | **Rechazado** con informe y derecho de apelación |

Bandera crítica (fail-fast) → revisión obligatoria independientemente del agregado.

## 5. Reproducibilidad como servicio

1. El autor declara `environment_spec.dockerfile` y `environment_spec.run_command` en los metadatos.
2. La plataforma construye la imagen en sandbox (sin red de salida en primera pasada; capa de prueba de trazado DNS resuelto).
3. Ejecuta con límite de recursos documentado, capturando stdout/stderr en `reproducibility_log`.
4. Compara **salidas clave** (tablas, figuras, números de resultados) contra el contenido del documento usando
   `assertions[]` y tolerancias (`abs` y `rel`).
5. Genera `reproducibility_report` con diffs y hashes; al pasar, habilita el camino al sello de Nivel 3.

## 6. Ledger, sellos y credenciales verificables (VC)

- Cada evento se encadena por hash (`prev_hash` → `hash`), alineado con el **Evidence Ledger** de Isabella
  (`docs/architecture/ADR-012-evidence-ledger.md`).
- El sello se representa como **W3C Verifiable Credential** (JWT-VC o JSON-LD-VP):
  claims mínimos en [`09-plantillas-y-artefactos.md`](09-plantillas-y-artefactos.md).
- La clave de firma de la plataforma reside en HSM (o KMS con custodia soberana), coherente con
  `docs/operations/HSM-KMS.md` y `docs/security/ATTESTATION-SIGNATURES.md`.
- La comprobación pública se hace contra `/api/v2/cert/{cert_id}/verify`; revocación registra `revoked_at` + evento ledger.

## 7. Seguridad y cifrado

| Capa | Control |
| --- | --- |
| Identidad | OIDC/OAuth2, ORCID vinculado, JWT firmado con rotación de claves, refresh rotate |
| API | WAF, rate limiting por token/IP (reutilizar `docs/operations/RATE-LIMITING.md`), mTLS opcional |
| Datos en reposo | AES-256 (S3/S3-compatible), columnas PII tokenizadas; backups cifrados |
| Datos en tránsito | TLS 1.2+ obligatorio; HSTS |
| Ledger | Assinatura HSM; hashing SHA-256; cadena de custodia verificable |
| Contenedor | Imágenes escaneadas (SCA + malware), no-root, seccomp, read-only FS |

## 8. SRE / Observabilidad y KPIs

| KPI | Fórmula | SLO objetivo |
| --- | --- | --- |
| Disponibilidad ingest | uptime mensual | >= 99.9% |
| P95 latencia ingest→verificable | percentil 95 | <= 15 s |
| Precisión de auto-verificación | TP/(TP+FP) | >= 95% |
| Fracción revisada por humanos | docs re-view/hdocs | 100% en Nivel 2+ |
| Tiempo respuesta al autor | mediana | <= 7 días |
| Tasa de falsos positivos en sellos | FP/sellos | <= 2% |
| Tasa de apelaciones atendidas | apelaciones resueltas/apelaciones | >= 90% |

### SLAs de servicio

| Servicio | SLA |
| --- | --- |
| API pública | 99.9% mensual |
| Verificación automática de un documento `<= 2 MB` | <= 10 min (P95) |
| Revisión humana Nivel 2+ | <= 7 días laborables |
| Respuesta a incidentes P1 | <= 1 min detección; <= 15 min contención |
| Disponibilidad de datos | RPO <= 15 min; RTO <= 60 min |

## 9. Despliegue e infraestructura

- Infra como código; entornos dev/staging/prod aislados.
- Helm charts por servicio; escalado automático del orquestador y los verificadores.
- Canary para nuevos pipelines (comparar `aggregate_score` previo vs nuevo en muestra).
- No se promueve un verificador sin tests de previa difusa y métricas mínimas de drift (ver `docs/ml/DRIFT.md`).