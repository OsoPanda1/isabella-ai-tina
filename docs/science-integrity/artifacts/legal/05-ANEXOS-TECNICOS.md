# Anexos Técnicos y Cláusulas Operativas Comunes

> **Estado:** Plantilla — **Propietario:** Legal/Operaciones — **Revisión:** 2026-10-07

Estos anexos son referenciados por TOS, DPA, DUA y Contrato de Revisor (ver `01-TOS.md`, `02-DPA.md`,
`03-DUA.md`, `04-CONTRATO-REVISOR.md`).

## 1. Anexo de licencias recomendadas

| Tipo de contenido | Licencia recomendada |
| --- | --- |
| Artículos | CC BY 4.0 |
| Datasets | CC0 u ODC-BY; DUA para datos sensibles |
| Código | Apache 2.0 o MIT |
| Documentación | CC BY 4.0 |
| Sellos/VC | Bien inmaterial de la Plataforma (uso registrado) |

## 2. Anexo de criterios de certificación

- **Nivel 1:** verificación automática pasada.
- **Nivel 2:** revisión humana completada.
- **Nivel 3:** reproducibilidad verificada.
- **Nivel 4:** auditoría externa y acreditación.

Detalle completo en [`../../06-plan-certificacion-y-auditoria.md`](../../06-plan-certificacion-y-auditoria.md).

## 3. Anexo de retención y eliminación

> **Corrección de coherencia:** la versión original de los anexos fijaba "metadatos: retención mínima 5 años salvo
> solicitud de eliminación". Esto **contradice** la política de evidencia (`03-reglamentos-y-politicas.md` §5:
> evidencia ≥ 7 años, metadatos indefinido con anonimización, ledger inmutable). Aplicada la siguiente tabla:

| Dato | Retención | Nota |
| --- | --- | --- |
| Metadatos de documentos | Indefinida con anonimización progresiva | Derecho de supresión disponible salvo obligación legal |
| Evidencia de verificación | Mínimo 7 años tras cierre | Paquetes firmados |
| Artefactos (S3) | Según licencia y acuerdos | Backups con retención adicional controlada |
| Datos personales de autores | Mínimo necesario; borrado/anonimización a solicitud | DSAR/ARCO |
| Ledger | Inmutable | Solo se anexan eventos de corrección/revocación |
| Logs operativos | 12 meses (o según auditoría) | SIEM |

Eliminación: procesos seguros (borrado criptográfico) y certificación de borrado.

## 4. Anexo de notificación de brechas

Procedimiento para notificación interna y a autoridades (plazos, responsables y plantillas de comunicación):

| Paso | Responsable | Plazo |
| --- | --- | --- |
| Detección y triage | Security Engineer | Inmediato |
| Confirmación de brecha con datos personales | DPO/Legal | ≤ 24 h |
| Notificación interna al Comité | Gobernanza | ≤ 24 h |
| Notificación a autoridad (GDPR) | DPO | ≤ 72 h |
| Notificación a interesados | DPO | Sin demora indebida |
| Registro de notificaciones y acciones | Legal | Permanente |