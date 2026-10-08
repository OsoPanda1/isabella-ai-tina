# 03 — Reglamentos y Políticas (Gobernanza y Ética)

> **Estado:** Vigente (PLAN) — **Propietario:** Gobernanza — **Revisión:** 2026-10-07

## 1. Principios de gobernanza

1. **Veracidad y honestidad:** todas las declaraciones de verificación/certificación deben ser auditables y reproducibles.
2. **Transparencia y rendición de cuentas:** decisiones de revisión documentadas y firmadas; trazabilidad completa.
3. **Imparcialidad y mérito académico:** revisión ciega cuando proceda; decisiones por evidencia, no por afiliación.
4. **Respeto a la privacidad y derechos de autor.**
5. **Mejora continua:** KPIs, auditorías periódicas y actualización de políticas — alineado con el
   `docs/governance/README.md` y el FGAIS Governance Charter de Isabella.
6. **Autonomía y supervisión humana:** la decisión final es humana en niveles altos (Nivel 2+), ver
   `governance/human-oversight/governance-board.md`.

## 2. Roles y responsabilidades

| Rol | Responsabilidad | Requisitos |
| --- | --- | --- |
| **Autor** | Sube contenido y metadatos, declara datos/código, responde observaciones, apela decisiones | Identidad verificada (ORCID) |
| **Revisor (experto)** | Evalúa contenido, firma informe, alerta COI | Especialidad afín; sin conflicto de interés |
| **Revisor de metodología** | Valida rigor estadístico y metodológico | Experiencia demostrable |
| **Revisor de reproducibilidad** | Ejecuta/valida entorno y salidas | Ingeniería/DevOps científica |
| **Comité de ética** | Decide casos límite, retractaciones, controversias | Pluralidad de disciplinas |
| **Auditor externo** | Audit anualmente procesos y sellos emitidos | Organización acreditada |
| **Administrador** | Gestión de accesos, roles y config (RBAC/ABAC) | Sin rol de revisión simultáneo |

## 3. Conflicto de intereses (COI)

- Todo revisor debe firmar declaración de ausencia de COI (afiliación, financiación, coautoría,
  relaciones personales o editoriales con el autor/doc).
- El sistema valida automáticamente el cruce `revisor.affiliation != document.affiliation` y
  colaboraciones previas (coautoría cruzada).
- COI no declarado → retiro de la revisión, re-asignación y registro en el ledger de conformidad del revisor.

## 4. Reglamento de privacidad y protección de datos

- Solo se recopilan datos necesarios y con finalidad determinada (minimización).
- Consentimiento explícito e informado para tratamiento; derecho de revocación.
- Los revisores ven el contenido pero no PII innecesaria de autores (pseudonimización por defecto cuando sea posible).
- Responde al cumplimiento **GDPR/Law 27/2014 (BR)** y regímenes locales; ver `05-alineamiento-regulatorio-global.md`.
- Violaciones de datos → notificación regulatoria en los plazos legales (GDPR ≤ 72 h) bajo el runbook de incidentes.

## 5. Retención de datos y evidencia

- **Evidencia de verificación:** retención mínima de **7 años** post-cierre.
- **Metadatos de documentos:** conservación indefinida con anonimización progresiva cuando aplique.
- **Datos de autores:** retención mínima necesaria; borrado/anonimización a solicitud conforme al
  `docs/security/DATA-ERASURE-RETENTION.md`.
- **Ledger:** inmutable e indeleble; solo se anexan eventos de revocación/corrección (nunca mutación).

## 6. Acceso a la evidencia

- **Público:** metadatos, sellos y resultados agregados.
- **Revisores/Auditores:** informes completos, evidencias y paquete firmado (`/api/v2/doc/{id}/evidence`, firmado).
- **Administradores/Operadores:** logs operativos según menor privilegio.
- Auditorías con acceso de solo lectura y logs de accesos auditados.

## 7. Política de apelaciones

1. El autor presenta apelación formal en ≤ **15 días** por resolución desfavorable.
2. Revisión por una segunda instancia (panel distinto de revisores) en ≤ **30 días**.
3. Decisión final con dictamen motivado; si se revoca, se emite el sello y se registran eventos de corrección.
4. Se mantiene registro público del historial de apelaciones resueltas (métricas de imparcialidad).

## 8. Política de retractación

- Se activa ante: error grave robustez, plagio, fraude de datos, COI no declarado o manipulación de imágenes.
- Comité de ética decide; documento retractado conserva su DOI original y se marca `current_status='retracted'`.
- El sello previo se revoca (evento ledger + `revoked_at`) y se publica aviso de retractación cruzado a Crossref/Retraction Watch.

## 9. Protocolos operativos (SOPs) resumidos

SOP detallados en [`07-playbooks-operativos.md`](07-playbooks-operativos.md):

| # | SOP |
| --- | --- |
| SOP-1 | Revisión humana por especialidad y método |
| SOP-2 | Verificación de reproducibilidad |
| SOP-3 | Escalamiento y moderación de contiendas entre revisores |
| SOP-4 | Emisión y revocación de sellos/certificados |
| SOP-5 | Manejo de incidentes de fraude o integridad de datos |
| SOP-6 | Respuesta a incidentes de seguridad |
| SOP-7 | Apelaciones y quejas |

## 10. Cumplimiento y sanciones

- Incumplimientos leves → aviso + plan correctivo.
- Incumplimientos graves (fraude, filtración de datos) → suspensión de roles, reporte a autoridades y al registro electrónico cuando proceda.
- El panel es el propietario de las sanciones; las decisiones se registran en el ledger y son apelables.