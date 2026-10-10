# Data Use Agreement (DUA) — Acceso a Datasets Sensibles

> **Estado:** Plantilla — **Propietario:** Legal — **Revisión:** 2026-10-07

## 1. Encabezado y propósito

**Título:** Data Use Agreement entre Librerías Isabella y Solicitante de Acceso a Dataset Sensible

**Objeto:** regular las condiciones de acceso, uso, almacenamiento y eliminación de datasets sensibles alojados o indexados por la Plataforma.

## 2. Definiciones

- **Dataset Sensible:** datos que contienen información personal sensible, datos de salud, datos identificables o información sujeta a restricciones legales.
- **Solicitante:** persona o entidad que solicita acceso.

## 3. Condiciones de acceso

**Requisitos:** solicitud formal, propósito de investigación, plan de manejo de datos, aprobación ética cuando aplique, firma de DUA y verificación de identidad institucional.

**Niveles de acceso**
- **Acceso abierto:** datasets no sensibles con licencia abierta.
- **Acceso controlado:** datasets sensibles con DUA y entorno seguro.
- **Acceso restringido:** datasets con requisitos adicionales y revisión institucional.

> Alineación operativa: estos niveles mapean al campo `visibility` del contrato (`public | restricted | private`) en `artifacts/openapi.yaml`.

## 4. Obligaciones del Solicitante

- Usar datos solo para fines aprobados.
- No intentar reidentificación.
- Implementar medidas de seguridad equivalentes a las definidas en el anexo técnico.
- Notificar incidentes y cumplir con requisitos de retención y eliminación.

## 5. Requisitos técnicos

**Entorno seguro:** ejecución en entornos aislados con acceso controlado, sin posibilidad de descarga directa salvo autorización. Logs de acceso y auditoría obligatorios.

## 6. Supervisión y auditoría

La Plataforma podrá auditar el uso del dataset y revocar acceso por incumplimiento. Se requerirán informes de uso periódicos.

## 7. Sanciones y responsabilidad

Incumplimientos graves pueden derivar en revocación de acceso, notificación a autoridades y responsabilidad civil o penal según la ley aplicable.

## 8. Anexos

- **Anexo A:** Descripción del dataset y metadatos.
- **Anexo B:** Requisitos técnicos mínimos para el entorno seguro.
- **Anexo C:** Formato de informe de uso.