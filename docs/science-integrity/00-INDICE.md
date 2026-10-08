# Paquete de Verificación y Certificación de Integridad Científica — Isabella

> **Estado:** Vigente (Blueprints, Manual, Políticas y Plantillas) — **Propietario:** Gobernanza / Arquitectura
> **Revisión:** 2026-10-07 — **Clasificación AGENTS.md:** Documentación de plan e integración. Nada de esto constituye
> certificación ni capacidad de producción verificada; véase `docs/INDEX.md` y la regla de honestidad de `AGENTS.md`.

## 1. Propósito

Transformar las librerías de Isabella en una plataforma que **filtre, verifique, asegure y certifique la veracidad,
viabilidad y respaldo** de la información científica y técnica que aloje o indexe, con trazabilidad criptográfica,
gobernanza de datos y procesos de certificación externa **más rigurosos que las prácticas comunes de Frontiers,
WEF, Mendeley y Scopus**.

Este paquete integra en el repositorio **toda la documentación** del blueprint: arquitectura modular, manual técnico
operativo, reglamentos y políticas internas, esquemas de licenciamiento, procedimientos de cumplimiento legal y
regulatorio global, playbooks operativos, plan de certificación y auditoría, plan piloto y cronograma, y paquete de
plantillas y artefactos.

## 2. Objetivos concretos

| Objetivo | Alcance |
| --- | --- |
| **Verificación automática** | Detección y clasificación de señales de baja calidad, plagio, datos fabricados, conflictos de interés y resultados no reproducibles mediante pipelines automáticos. |
| **Verificación humana** | Paneles de revisión por expertos, auditorías de metodología y reproducibilidad, y comités de ética. |
| **Trazabilidad y evidencia** | Registro inmutable de metadatos, versiones, revisiones y pruebas de verificación (hashes, firmas digitales). |
| **Certificación** | Emisión de sellos/certificados verificables por terceros ("Verificado", "Reproducible", "Auditado"). |
| **Seguridad y privacidad** | Protección de datos sensibles, control de accesos, cifrado en tránsito y reposo, cumplimiento GDPR/LPDP. |
| **Operatividad y gobernanza** | Roles, SLAs, KPIs, procesos de escalamiento y respuesta a incidentes. |

## 3. Alcance técnico

- **Plataforma híbrida:** microservicios en contenedores, orquestación (Kubernetes), almacenamiento distribuido
  (S3-compatible), motor de búsqueda indexado (Elasticsearch/OpenSearch) y pipelines de verificación batch+streaming.
- **Integraciones externas:** CrossRef, ORCID, DOI registries, PubMed, Retraction Watch, proveedores de integridad
  (plagiarism detection APIs) y sistemas de certificación/acreditación.
- **No incluye:** implementación de código en producción sin pruebas, ni extracción de contenido protegido sin permisos.

## 4. Fases del plan

1. **Fase A — Integración documental (este paquete):** blueprint, manual, políticas, licencias, cumplimiento,
   certificación, playbooks, roadmap, plantillas y el puente hacia Hypercore y ML nativo.
2. **Fase B — Librerías nativas reales y funcionales (posterior):** implementación de las librerías Isabella
   interconectadas con **ML nativo** (`src/lib/intelligence`, NCUA) y con **Hypercore de Isabella**
   (`src/lib/acceleration/hypercore.ts`, `hypercore-runtime`, rutas `/api/v1/isabella-hypercore`), de modo que exista
   un flujo real de información dentro de todo el proyecto. La especificación de integración está en
   [`10-integracion-hypercore-ml-nativo.md`](10-integracion-hypercore-ml-nativo.md).

## 5. Mapeo a la arquitectura Isabella existente

| Módulo del blueprint | Componente Isabella | Ruta/contrato |
| --- | --- | --- |
| Ledger de eventos | BookPI / Evidence Ledger (append-only encadenado por hash) | `docs/04-ISABELLA-ECONOMIA-BOOKPI.md`, `docs/architecture/ADR-012-evidence-ledger.md` |
| Sellos y procedencia | IGDS y firmas soberanas | `src/lib/igds/`, `docs/evidence/` |
| Epistemología y clasificación de confianza | NCUA E0–E4 | `src/lib/ncua/`, `docs/05-ISABELLA-INTELIGENCIA-ML.md` |
| ML nativo y modelos gobernados | Plano de inteligencia / model registry / transports | `src/lib/intelligence/`, `docs/ml/DRIFT.md` |
| Aceleración adaptativa y rails | Hypercore de Isabella | `src/lib/acceleration/hypercore.ts`, `hypercore-runtime/`, `src/routes/api/v1/isabella-hypercore.ts` |
| Aprobaciones durables y ledger económico | Approvals + marketplace | `src/lib/repositories/approval-repository.ts`, `bookpi-postgres-repository.ts` |
| Autorización centralizada de decisiones | CROWN / ARGUS / PDP | `src/lib/crown.ts`, `src/lib/authorization.ts`, `AGENTS.md` §6 |

> El estado de cada componente es **PLAN/documentado** hasta que la Fase B lo implemente y las pruebas lo verifiquen.

## 6. Documentos del paquete

| # | Documento | Contenido |
| --- | --- | --- |
| 0 | [00-INDICE.md](00-INDICE.md) | Este índice (visión, objetivos, mapeo, estado) |
| 1 | [01-blueprint-arquitectonico.md](01-blueprint-arquitectonico.md) | Principios, capas, componentes, flujos y diagramas (texto + PlantUML) |
| 2 | [02-manual-tecnico-operativo.md](02-manual-tecnico-operativo.md) | Contrato OpenAPI, JSON-LD, modelos de datos, pipelines de verificación, reproducibilidad, ledger/VC, seguridad, SRE, KPIs |
| 3 | [03-reglamentos-y-politicas.md](03-reglamentos-y-politicas.md) | Gobernanza y ética, comité, COI, retractación, privacidad, retención, acceso a evidencia, apelaciones, SOPs, roles, SLAs |
| 4 | [04-licenciamiento-y-modelos-legales.md](04-licenciamiento-y-modelos-legales.md) | Licencias por artefacto, cláusulas TOS, DPA, DUA, contratos con revisores, riesgos legales |
| 5 | [05-alineamiento-regulatorio-global.md](05-alineamiento-regulatorio-global.md) | GDPR, COPE, FAIR, DataCite, W3C VC, ISO/IEC 27001 y referencias |
| 6 | [06-plan-certificacion-y-auditoria.md](06-plan-certificacion-y-auditoria.md) | Niveles 0–4, criterios, evidencia, auditoría externa, sellos verificables |
| 7 | [07-playbooks-operativos.md](07-playbooks-operativos.md) | SOP por rol, incidentes, fraude, apelación, emisión de certificados |
| 8 | [08-hoja-de-ruta-cronograma-y-piloto.md](08-hoja-de-ruta-cronograma-y-piloto.md) | Fases, cronograma, recursos, costos, matriz de riesgos, plan piloto |
| 9 | [09-plantillas-y-artefactos.md](09-plantillas-y-artefactos.md) | JSON-LD, esquema de verificación, VC, checklist, Dockerfile, scripts reproducibles |
| 10 | [10-integracion-hypercore-ml-nativo.md](10-integracion-hypercore-ml-nativo.md) | Puente de implementación de las librerías nativas con Hypercore y ML nativo (Fase B) |

## 7. Convenciones de estado

- **(PLAN)** Documentación de intención sin implementación verificable.
- **(DOC)** Implementado como documentación integrada al repositorio (este paquete).
- **(IMPLEMENTED/TESTED/VERIFIED)** Solo cuando la Fase B produzca código con pruebas y evidencia same-commit,
  conforme a la escala de `AGENTS.md` §0.1.

## 8. Registro de integración de entregas

Cada módulo enviado por el responsable se revisa (debilidades → correcciones) y se integra aquí:

| Fecha | Módulo entregado | Dónde se integra | Correcciones aplicadas |
| --- | --- | --- | --- |
| 2026-10-07 | PlantUML componentes + secuencia | `01-blueprint-arquitectonico.md` | — |
| 2026-10-07 | OpenAPI v2 mínimo | `artifacts/openapi.yaml` (v1) | — |
| 2026-10-07 | OpenAPI v2 ampliado | `artifacts/openapi.yaml` (v2, canónico) | C1–C4 (`07-playbooks-operativos.md` §7) |
| 2026-10-07 | Playbooks por rol (Revisor, SRE, Gobernanza, Legal, ML/DS) | `07-playbooks-operativos.md` | C5–C9 (`07-playbooks-operativos.md` §7) |
| 2026-10-07 | Plantillas legales (TOS, DPA, DUA, contrato revisor) | `artifacts/legal/{01-TOS,02-DPA,03-DUA,04-CONTRATO-REVISOR}.md` | Integradas y referenciadas en `09-plantillas-y-artefactos.md` + README |
| 2026-10-08 | **Fase B — puente nativo implementado (B0–B6)** | `src/lib/science-integrity/` (ingest, claims, classifiers, pipeline, hypercore, review, certification, ledger, runtime, routes) | TESTS: 33 nuevos en `test/unit/science-integrity/`; gates typecheck 0, suite `1258 passed/9 skipped`, ORCID regex corregido (ISO 27729), banderas críticas solo sobre señales disponibles, verificación de certificado consulta revocaciones Genesis |
| — | Scripts reproducibles y Dockerfile (piloto) | `09-plantillas-y-artefactos.md` + `artifacts/` *(pendiente)* | Pendientes de revisión |
| — | Cronograma detallado y costos | `08-hoja-de-ruta-cronograma-y-piloto.md` *(pendiente)* | Pendientes de revisión |
| — | Archivos exportables (.puml, .yaml, .md, .csv, scripts) | `artifacts/` *(pendiente)* | Pendientes de revisión |