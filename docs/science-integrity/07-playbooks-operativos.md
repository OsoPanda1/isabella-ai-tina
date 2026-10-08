# 07 — Playbooks Operativos

> **Estado:** Vigente (PLAN) — **Propietario:** Operaciones / Gobernanza — **Revisión:** 2026-10-07
> Integración de los módulos de playbooks entregados, con correcciones de revisión aplicadas (ver §7).

## Playbook 1 — Revisor Humano (SOP completo)

**Propósito:** garantizar que la revisión humana valide metodología, reproducibilidad, ética y congruencia entre
evidencia y conclusiones.

**Alcance:** todos los documentos que el Pipeline Manager encole para revisión humana (`aggregate_score` en rango
intermedio o bandera crítica que requiera verificación manual).

**Roles**
- **Revisor principal:** experto en la disciplina.
- **Revisor secundario:** experto independiente para casos de conflicto.
- **Coordinador de revisión:** asigna revisores y gestiona tiempos.

**SLA**
- Asignación inicial: 48 horas desde la encolación.
- Revisión completa: máximo 14 días calendario.
- Apelación: resolución en 21 días por panel independiente.

**Checklist paso a paso**

1. **Verificación preliminar (automática).** Revisar informe automático (plagio, referencias, imágenes,
   reproducibilidad). Confirmar `evidence_hashes` y acceder al paquete de evidencia (`/api/v2/doc/{id}/evidence`,
   firma verificada) si está permitido.
2. **Identidad y conflicto de interés.** Verificar ORCID (`https://orcid.org/0000-0001-....` formato canónico) y
   afiliaciones. Declarar COI; si existe, solicitar reemplazo del revisor (validación automática de cruces de
   afiliación y coautoría).
3. **Revisión metodológica.** Leer la sección de métodos en detalle; confirmar que el diseño experimental y el
   análisis estadístico son apropiados; verificar que variables, muestras y procedimientos estén descritos con
   suficiente detalle.
4. **Revisión de reproducibilidad.**
   - ⚠ **Corrección:** el revisor **nunca** ejecuta código del autor en su máquina. La ejecución ocurre **únicamente
     en el sandbox de la plataforma** (`reproducibility_run`). El revisor solicita el paquete reproducible, supervisa
     o revisa `reproducibility_report` y logs, y documenta diferencias frente a las afirmaciones del documento.
5. **Revisión de integridad de resultados.** Comparar tablas/figuras con outputs generados; detectar inconsistencias
   numéricas (sumas, medias, porcentajes no coherentes).
6. **Revisión ética.** Confirmar aprobación ética si aplica; revisar financiación y COI declarados.
7. **Evaluación de lenguaje y afirmaciones.** Identificar afirmaciones no respaldadas por evidencia; recomendar
   reescritura o matices en conclusiones.
8. **Documentación y firma.** Completar el formulario estandarizado (JSON schema); firmar digitalmente
   (`review_signature`) y subir al sistema.
9. **Decisión.** Opciones: `accept`, `minor_revision`, `major_revision`, `reject`, `refer_to_audit`. Si
   `refer_to_audit`, documentar razones y escalar al comité de gobernanza.
10. **Comunicación.** Notificar al autor con informe estructurado y pasos requeridos; registrar `review_event` en el
    ledger.

**Salida resumida (JSON)**

```json
{
  "document_id": "ISB-000123",
  "review_id": "rev-20261007-0001",
  "reviewer_orcid": "https://orcid.org/0000-0000-0000-0000",
  "decision": "minor_revision",
  "summary": "Observaciones metodológicas y solicitud de clarificar sección X",
  "evidence_hashes": ["sha256:..."],
  "signature": "base64-signature",
  "timestamp": "2026-10-07T21:00:00Z"
}
```

**Notas operativas**
- Mantener anonimato del revisor si la política lo requiere (doble ciego).
- Registrar tiempos y métricas para KPIs (tiempo medio de revisión, tasa de aceptación).

## Playbook 2 — SRE / DevOps (Operación, seguridad y recuperación)

**Propósito:** mantener disponibilidad, integridad y seguridad de la plataforma; asegurar reproducibilidad de
entornos y continuidad operativa.

**Responsables:** Lead SRE (SLAs y DR), DevOps (despliegues, CI/CD), Security Engineer (hardening y respuesta a
incidentes).

**SLA y objetivos**
- Disponibilidad: 99.9% (excluyendo ventanas de mantenimiento programado).
- RTO: 2 horas para servicios críticos (API Gateway, Ingest).
- RPO: 1 hora para metadatos; 24 horas para artefactos (con versionado S3 habilitado).

**Checklist diario**
- Verificar alertas (Prometheus/Grafana): colas, latencias, errores 5xx.
- Revisar integridad de backups (PostgreSQL snapshot, ciclo de vida S3).
- Comprobar estado de nodos y uso de recursos.
- Ejecutar pruebas de salud de pipelines (smoke tests).

**Despliegues y CI/CD**
- Pipelines GitOps (ArgoCD/Flux).
- Cada cambio en pipelines de verificación requiere: revisión de código, pruebas unitarias, pruebas de integración y
  aprobación del Security Engineer.
- Versionado obligatorio: `pipeline_id + version` en cada despliegue.

**Gestión de claves y HSM**
- Claves de firma en HSM; rotación anual o por incidente (`docs/operations/HSM-KMS.md`).
- Acceso a KMS restringido por RBAC; auditoría de uso.

**Backups y recuperación**
- PostgreSQL: snapshots diarios; retención 30 días.
- S3: versionado activado; lifecycle para retención y archivado.
- Pruebas de DR trimestrales: restaurar snapshot en entorno aislado y validar integridad.
- ⚠ **Corrección:** el RTO declarado (2 h) exige runbooks de failover ejecutados y probados; usar el runbook de
  incidentes existente (`docs/runbooks/incident.md`) y pruebas de caos periódicas (`docs/operations/CHAOS-ENGINEERING.md`).

**Respuesta a incidentes (resumen)**
1. Detección: SIEM/Prometheus.
2. Contención: aislar servicio afectado; activar modo degradado si aplica.
3. Investigación: logs, traces y dumps; preservar evidencia (hashes).
4. Remediación: parche o rollback; rotar claves si comprometidas.
5. Comunicación: comité de gobernanza y, si aplica, autoridades (GDPR ≤ 72 h).
6. Post-mortem: root cause, acciones correctivas y lecciones aprendidas.

**Pruebas y validación**
- Pentest anual por tercero.
- Escaneo de vulnerabilidades semanal.
- Revisión de dependencias (SCA) en cada build.

## Playbook 3 — Gobernanza, Ética y Auditoría (Comité y procesos)

**Propósito:** definir criterios de certificación, gestionar apelaciones, supervisar auditorías y mantener transparencia.

**Composición del Comité**
- 2 investigadores senior (diferentes disciplinas).
- 1 representante legal/compliance.
- 1 experto en reproducibilidad (ML/DS).
- 1 auditor externo (rotativo).

**Funciones**
- Aprobar y versionar criterios de certificación (changelog público de versiones de criterios).
- Revisar casos escalados (fraude, retractación).
- Autorizar auditorías externas y revisar hallazgos.

**Proceso de apelación**
1. Autor presenta apelación con evidencia adicional (plazo 30 días).
2. El comité designa panel independiente (sin involucrados en la revisión original).
3. El panel emite decisión en 21 días; registrar `appeal_event` en el ledger.
4. Si existe error en la revisión, emitir corrección y actualizar el certificado.

**Proceso de retractación**
- Criterios: fraude comprobado, manipulación de datos, error crítico que invalida conclusiones.
- Pasos: investigación, notificación a la afiliación institucional, decisión del comité, nota pública de
  retractación y `revocation_event` en el ledger.

**Auditorías**
- Internas: trimestrales (muestreo de pipelines y logs).
- Externas: anuales por organismo acreditado; alcance: muestreo de certificados, revisión del ledger, controles de
  acceso y políticas.
- ⚠ **Corrección (independencia):** la rotación del auditor externo debe impedir que la misma firma audite más de
  3 ejercicios consecutivos, para preservar independencia objetiva.

**KPIs de gobernanza**
- Tiempo medio de resolución de apelaciones.
- Número de retractaciones por año.
- Cumplimiento de auditorías (no conformidades abiertas).

## Playbook 4 — Legal & Compliance (Políticas, DPIA y contratos)

**Propósito:** asegurar cumplimiento con GDPR y leyes locales; gestionar contratos con proveedores y riesgos legales.

**Responsables:** Chief Legal Officer / responsable legal; Data Protection Officer (DPO) donde se requiera.

**Actividades clave**
- Ejecutar DPIA antes de procesar datos personales a escala.
- Mantener DPA con todos los subprocesadores (cloud, KMS, plagiarism API).
- Gestionar SCC para transferencias fuera del EEE.
- Revisar y actualizar TOS, DUA y contratos de revisores periódicamente.

**Checklist de cumplimiento**
- Consentimientos y bases legales documentadas.
- Endpoints para derechos ARCO/DSAR (acceso, rectificación, supresión, portabilidad).
- **Corrección (GDPR Art. 30):** mantener actualizado el Registro de Actividades de Tratamiento.
- Mecanismos de retención y borrado conforme a políticas.

**Incidentes legales**
- Incidente con datos personales → activar DPO, notificar autoridades en plazos legales (p. ej., 72 h GDPR).
- Mantener registro de notificaciones y acciones.

## Playbook 5 — Equipo de ML/DS (Verificadores automáticos)

**Propósito:** desarrollar, validar y mantener los modelos y reglas de verificación automática (plagio, forense de
imágenes, detección de afirmaciones NLP, análisis estadístico).

**Responsables:** Lead ML Engineer; Data Scientist por verificador.

**Ciclo de vida de modelos**
1. **Datos:** curación y etiquetado; dataset fijo de validación y test.
2. **Entrenamiento:** versionado de modelos (`model_id + version`).
3. **Validación:** métricas (precision, recall, F1) y análisis de falsos positivos/negativos.
4. **Despliegue:** canary release; monitorización de drift.
5. **Retraining:** programado o por detección de drift.

**Validación y calibración**
- Umbrales por disciplina; calibrar con datasets representativos.
- Documentar limitaciones y tasas esperadas de FP/FN.
- **Corrección (equidad y drift):** incorporar métricas de sesgo/equidad por subgrupo y alertas de drift según
  `docs/ml/DRIFT.md` antes de promover un modelo a producción.

**Monitoreo en producción**
- Métricas: tasa de alertas, tasa de revisión humana requerida, tiempo de ejecución.
- Feedback loop: incorporar correcciones de revisores para mejorar modelos.

## 7. Bitácora de correcciones de revisión

Debilidades detectadas en las entregas y su corrección:

| # | Debilidad detectada | Corrección aplicada |
| --- | --- | --- |
| C1 | Endpoints públicos del OpenAPI bloqueados por el `security` global Bearer | `security: []` explícito en `/health`, `/doc/{id}`, `/search`, `/cert/{cert_id}/verify` |
| C2 | Endpoints administrativos sin rol granular | `oauth2: [admin:all]` para `/users`, `/audit/logs`, `/admin/revoke/{cert_id}` |
| C3 | `/audit/logs` sin paginación | Añadidos `limit`/`offset` (max 500) |
| C4 | Revocación sin cuerpo de respuesta ni motivo registrado | `reason` obligatorio + respuesta `cert_id/status/ledger_tx` |
| C5 | Revisión humana: ejecutar código del autor fuera de sandbox | Prohibido; solo sandbox de la plataforma |
| C6 | RTO 2 h sin respaldo de runbook/DR | Vincular a `docs/runbooks/incident.md` y caos testing |
| C7 | Auditor externo "rotativo" sin garantía de independencia | Límite de 3 ejercicios consecutivos por firma |
| C8 | Registro de tratamiento GDPR no mencionado | Añadido Art. 30 (registro de actividades) |
| C9 | Modelos ML sin validación de equidad/drift | Métricas de bias y drift (`docs/ml/DRIFT.md`) como gate de promoción |