# docs/ — Índice de documentación

Registro de **propiedad, estado y última revisión** de toda la documentación vigente
del repositorio. Se genera desde el contenido real de cada archivo; no es una lista
declarada a mano.

| Pregunta | Documento |
| --- | --- |
| ¿Por dónde empiezo a leer? | [`docs/INDEX.md`](INDEX.md) — orden de lectura y mapa de rutas |
| ¿Quién es dueño de qué y qué está vigente? | **este archivo** — registro de propiedad y estado |
| ¿Qué está retirado y por qué? | `docs/_archive/` — ver política de retención en `INDEX.md` |

No hay duplicación entre ambos: `INDEX.md` describe el *contenido y su lectura*;
`README.md` describe la *custodia y su vigencia*.

## Convenciones

- **Propietario** es el **área funcional** responsable. La identidad de cuenta se
  declara en [`.github/CODEOWNERS`](../.github/CODEOWNERS), que asigna `@OsoPanda1`
  como propietario de `*`.
- **Estado** para ADRs se lee de su propio encabezado (`- **Estado:**` o `## Estado:`).
  Para el resto: `Vigente`, `Evidencia` (artefacto con fecha, no norma),
  `Registro` o `Plantilla`.
- **Revisión** es la fecha del último commit que tocó el archivo — regenerable con
  `git log -1 --format=%cs -- <archivo>`.
- `docs/_archive/**` **no aparece** aquí: es retención histórica, no fuente
  operativa (`docs/INDEX.md`).

## Reglas para añadir un documento

1. Todo documento nuevo debe entrar en esta tabla en el mismo commit que lo crea.
2. Debe tener propósito, propietario, estado y fecha.
3. Antes de crear uno, comprobar si ya existe uno vigente que lo cubra.
4. Un ADR por decision; `Estado` muta a `Rechazado` o `Reemplazado por ADR-xxx`,
   nunca se borra.

---


### Raíz del repositorio

| Documento | Propósito | Estado | Propietario | Revisión |
| --- | --- | --- | --- | --- |
| `AGENTS.md` | AGENTS.md — Documento Maestro de Arquitectura, Seguridad y Especificación Canónica | Vigente | Gobernanza | 2026-09-24 |
| `CHANGELOG.md` | Registro de Cambios (Changelog) :: Isabella Villaseñor AI™ | Registro | Gobernanza | 2026-09-27 |
| `CODE_OF_CONDUCT.md` | Código de Conducta :: Isabella Villaseñor AI™ | Vigente | Gobernanza | 2026-09-27 |
| `CONTRIBUTING.md` | Guía de Contribución :: Isabella Villaseñor AI™ | Vigente | Gobernanza | 2026-09-27 |
| `LICENSE-CONTROL.md` | Isabella AI Genesis — License Control Notice | Vigente | Gobernanza | 2026-09-07 |
| `LICENSES.md` | LICENSES.md — Matriz de licencias Isabella AI Genesis | Vigente | Gobernanza | 2026-09-24 |
| `LICENSE-SOVEREIGN.md` | ISABELLA VILLASEÑOR AI — SOVEREIGN PROPRIETARY COVENANT & HYBRID LICENSE (v1.0.0) | Vigente | Gobernanza | 2026-09-16 |
| `README.md` | Isabella Villaseñor AI — TAMV Online · Isabella | Vigente | Gobernanza | 2026-09-29 |
| `ROADMAP.md` | Roadmap :: Isabella Villaseñor AI™ v4.2.0 | Vigente | Gobernanza | 2026-09-27 |
| `SECURITY.md` | Security Policy — Isabella Villaseñor AI | Vigente | Gobernanza | 2026-09-23 |

### docs/architecture

| Documento | Propósito | Estado | Propietario | Revisión |
| --- | --- | --- | --- | --- |
| `docs/architecture/ADR-011-blueprint-maestro-v2-adaptacion-ts.md` | ADR-011: Blueprint Maestro v2.0 — Adaptación al stack TypeScript | Aceptado | Arquitectura | 2026-09-30 |
| `docs/architecture/ADR-012-evidence-ledger.md` | ADR-012: Evidence Ledger — bitácora append-only encadenada por hash | Aceptado | Arquitectura | 2026-09-27 |
| `docs/architecture/ADR-013-jdr-generator-propiedad.md` | ADR-013: Propiedad canónica del generador JDR | Aceptado | Arquitectura | 2026-09-30 |
| `docs/architecture/RUNTIME-AUTHORITY-MAP.md` | Runtime Authority Map | Vigente | Arquitectura | 2026-09-24 |
| `docs/architecture/SSOT.md` | Isabella SSOT | Vigente | Arquitectura | 2026-09-24 |

### docs/ (resto)

| Documento | Propósito | Estado | Propietario | Revisión |
| --- | --- | --- | --- | --- |
| `docs/01-ISABELLA-CANONICA-UNIFICADA.md` | 01 — ISABELLA CANÓNICA UNIFICADA | Vigente | Arquitectura | 2026-09-24 |
| `docs/02-ISABELLA-OPERACIONES-PRODUCCION.md` | 02 — ISABELLA OPERACIONES Y PRODUCCIÓN | Vigente | Arquitectura | 2026-09-24 |
| `docs/03-ISABELLA-SEGURIDAD-PRIVACIDAD.md` | 03 — ISABELLA SEGURIDAD Y PRIVACIDAD | Vigente | Arquitectura | 2026-09-23 |
| `docs/04-ISABELLA-ECONOMIA-BOOKPI.md` | 04 — ISABELLA ECONOMÍA Y BOOKPI | Vigente | Arquitectura | 2026-09-23 |
| `docs/05-ISABELLA-INTELIGENCIA-ML.md` | 05 — ISABELLA INTELIGENCIA Y ML | Vigente | Arquitectura | 2026-09-23 |
| `docs/06-ISABELLA-DESARROLLO-CONTRIBUCION.md` | 06 — ISABELLA DESARROLLO Y CONTRIBUCIÓN | Vigente | Arquitectura | 2026-09-23 |
| `docs/07-TINA-CATEGORIA.md` | 07 — Categoría TINA (Trusted Intelligence, Native & Adaptive) | Vigente | Arquitectura | 2026-09-24 |
| `docs/08-ISABELLA-VERIFICACION-CERTIFICACION-INTEGRIDAD.md` | 08 — Verificación y Certificación de Integridad Científica (cabecera del pilar) | Vigente | Gobernanza | 2026-10-07 |
| `docs/evidence/300-COMPLETADO-2026-09-23.md` | 300/300 Completado — 2026-09-23 | Evidencia | Gobernanza | 2026-09-24 |
| `docs/evidence/FINAL-EVOLUCION-2026-09-23.md` | Final Evolución Funcional — Isabella Villaseñor AI™ — 2026-09-23 | Evidencia | Gobernanza | 2026-09-24 |
| `docs/evidence/FINAL-PRODUCCION-2026-09-23.md` | Evidencia Final — Producción Lista para Pruebas — 2026-09-23 | Evidencia | Gobernanza | 2026-09-23 |
| `docs/governance/01-FGAIS-Governance-Constitution.md` | Isabella AI Genesis — FGAIS Governance Charter (Versión Génesis 2.0 Final) | Vigente | Gobernanza | 2026-09-23 |
| `docs/governance/README.md` | Gobernanza — Isabella AI Genesis | Vigente | Gobernanza | 2026-09-27 |
| `docs/governance/risk-register/README.md` | AI Risk Register — Isabella AI Genesis | Vigente | Gobernanza | 2026-09-27 |
| `docs/INDEX.md` | Índice canónico de documentación — Isabella AI Genesis v4.3.3 | Vigente | Arquitectura | 2026-09-30 |
| `docs/ml/DRIFT.md` | DRIFT — Detección, Fairness y Velocidad (ML Gobernado v3.1) | Vigente | Datos/ML | 2026-09-23 |
| `docs/operations/API-KEYS-ROTATION.md` | API Keys Rotation — P1 | Vigente | Operaciones | 2026-09-23 |
| `docs/operations/BACKUP-ENCRYPTION.md` | Backup Encryption — P1 | Vigente | Operaciones | 2026-09-24 |
| `docs/operations/BACKUP-VERIFICATION.md` | Backup Verification — P1 | Vigente | Operaciones | 2026-09-23 |
| `docs/operations/BRANCH-PROTECTION.md` | Branch Protection — `main` | Vigente | Operaciones | 2026-09-23 |
| `docs/operations/CAPABILITY_MATRIX.md` | Matriz de capabilities (generada) | Vigente | Operaciones | 2026-09-29 |
| `docs/operations/CHAOS-ENGINEERING.md` | Chaos Engineering — P1 | Vigente | Operaciones | 2026-09-24 |
| `docs/operations/CODE-QUALITY.md` | Code Quality — P2 | Vigente | Operaciones | 2026-09-23 |
| `docs/operations/CSP-NONCES.md` | CSP Nonces — P1 (HSTS preload + nonces) | Vigente | Operaciones | 2026-09-23 |
| `docs/operations/FINAL-300-COMPLETION.md` | Final 300 — Completado sin pausa | Evidencia | Operaciones | 2026-09-24 |
| `docs/operations/HARDENING-500.md` | Hardening Total — 500 Gates (P1) | Vigente | Operaciones | 2026-09-24 |
| `docs/operations/HSM-KMS.md` | HSM / KMS — Custodia de Claves y Firma Soberana | Vigente | Operaciones | 2026-09-24 |
| `docs/operations/OBSERVABILITY-SLO.md` | Observabilidad — SRE (OTel + Prometheus + PII controls) | Vigente | Operaciones | 2026-09-24 |
| `docs/operations/PERFORMANCE.md` | Performance — P2 | Vigente | Operaciones | 2026-09-23 |
| `docs/operations/PRE-COMMIT-HOOKS.md` | Pre-commit Hooks — P1 | Vigente | Operaciones | 2026-09-23 |
| `docs/operations/PROCESS-ENV-AUDIT.md` | Process Env Audit — P1 | Vigente | Operaciones | 2026-09-24 |
| `docs/operations/RATE-LIMITING.md` | Rate Limiting — P1 (Tenant + IP) | Vigente | Operaciones | 2026-09-23 |
| `docs/operations/SECRETS-CATALOG.md` | Claves y secretos de Isabella | Vigente | Operaciones | 2026-09-26 |
| `docs/operations/SLO.md` | SLO/SLI — Isabella AI Genesis (P1) | Vigente | Operaciones | 2026-09-23 |
| `docs/operations/SLSA-PROVENANCE.md` | SLSA Provenance — P1 | Vigente | Operaciones | 2026-09-23 |
| `docs/operations/VERSION-DRIFT.md` | Version Drift — P1 | Vigente | Operaciones | 2026-09-24 |
| `docs/operations/WAF-ANTI-BOT.md` | WAF + Anti-Bot — P1 | Vigente | Operaciones | 2026-09-23 |
| `docs/research/README.md` | docs/research — Registro bibliográfico ORCID | Vigente | Datos/ML | 2026-09-27 |
| `docs/runbooks/incident.md` | Runbook — Incidentes (P0/P1) | Vigente | Operaciones | 2026-09-25 |
| `docs/security/ATTESTATION-SIGNATURES.md` | Atestaciones Isabella — firmas RSA-2048 externas | Vigente | Seguridad | 2026-09-29 |
| `docs/security/DATA-ERASURE-RETENTION.md` | Data Erasure and Immutable Evidence Retention | Vigente | Seguridad | 2026-09-27 |
| `docs/security/ISABELLA-API-KEYS.md` | Isabella API Keys — Security Contract | Vigente | Seguridad | 2026-09-23 |
| `docs/security/THREAT-MODEL-TINA-INITIAL.md` | Threat model — Isabella AI Genesis / TINA | Vigente | Seguridad | 2026-09-27 |
| `docs/security/THREAT-MODEL-TINA-ISABELLA.md` | Threat Model — Isabella AI / TINA Runtime | Vigente | Seguridad | 2026-09-27 |
| `docs/status/CRITICAL-AUDIT-2026-09-28.md` | Auditoría crítica TINA / Isabella — 2026-09-28 | Evidencia | Gobernanza | 2026-09-28 |
| `docs/status/ISA-500-STATUS-2026-09-26.md` | Estado de la auditoría ISA-500 — 2026-09-26 | Evidencia | Gobernanza | 2026-09-26 |
| `docs/status/ISABELLA-GENESIS-500-CHECKLIST.md` | Isabella Villaseñor AI Genesis — Checklist de remediación de 500 puntos | Evidencia | Gobernanza | 2026-09-26 |

### docs/science-integrity

| Documento | Propósito | Estado | Propietario | Revisión |
| --- | --- | --- | --- | --- |
| `docs/science-integrity/00-INDICE.md` | Paquete Verificación y Certificación — visión, mapeo e integración de entregas | Vigente | Gobernanza | 2026-10-07 |
| `docs/science-integrity/01-blueprint-arquitectonico.md` | Blueprint arquitectónico (capas, flujos, PlantUML canónico) | Vigente | Arquitectura | 2026-10-07 |
| `docs/science-integrity/02-manual-tecnico-operativo.md` | Manual técnico-operativo (contrato, datos, pipelines, SRE, KPIs) | Vigente | Operaciones | 2026-10-07 |
| `docs/science-integrity/03-reglamentos-y-politicas.md` | Reglamentos y políticas (COI, retractación, apelaciones, privacidad) | Vigente | Gobernanza | 2026-10-07 |
| `docs/science-integrity/04-licenciamiento-y-modelos-legales.md` | Licencias, TOS/DPA/DUA estructurales y riesgos legales | Vigente | Legal | 2026-10-07 |
| `docs/science-integrity/05-alineamiento-regulatorio-global.md` | GDPR, COPE, FAIR, DataCite, W3C VC, ISO/IEC 27001 | Vigente | Legal | 2026-10-07 |
| `docs/science-integrity/06-plan-certificacion-y-auditoria.md` | Niveles 0–4 de certificación, evidencia y auditoría externa | Vigente | Gobernanza | 2026-10-07 |
| `docs/science-integrity/07-playbooks-operativos.md` | Playbooks por rol + bitácora de correcciones de revisión | Vigente | Operaciones | 2026-10-07 |
| `docs/science-integrity/08-hoja-de-ruta-cronograma-y-piloto.md` | Fases, plan piloto, matriz de riesgos y KPIs | Vigente | Gobernanza | 2026-10-07 |
| `docs/science-integrity/09-plantillas-y-artefactos.md` | Índice de plantillas y artefactos (JSON-LD, VC, checklist) | Vigente | Arquitectura | 2026-10-07 |
| `docs/science-integrity/10-integracion-hypercore-ml-nativo.md` | Contrato del puente Hypercore + ML nativo (Fase B) | Vigente | Arquitectura | 2026-10-07 |
| `docs/science-integrity/artifacts/openapi.yaml` | Contrato OpenAPI v2 ampliado (correcciones C1–C4) | Plantilla | Arquitectura | 2026-10-07 |

### docs/science-integrity/artifacts/legal

| Documento | Propósito | Estado | Propietario | Revisión |
| --- | --- | --- | --- | --- |
| `docs/science-integrity/artifacts/legal/01-TOS.md` | Plantilla Términos de Servicio | Plantilla | Legal | 2026-10-07 |
| `docs/science-integrity/artifacts/legal/02-DPA.md` | Plantilla Data Processing Agreement | Plantilla | Legal | 2026-10-07 |
| `docs/science-integrity/artifacts/legal/03-DUA.md` | Plantilla Data Use Agreement (datasets sensibles) | Plantilla | Legal | 2026-10-07 |
| `docs/science-integrity/artifacts/legal/04-CONTRATO-REVISOR.md` | Plantilla Contrato de Revisor y NDA | Plantilla | Legal | 2026-10-07 |
| `docs/science-integrity/artifacts/legal/05-ANEXOS-TECNICOS.md` | Anexos técnicos y cláusulas operativas comunes | Plantilla | Legal | 2026-10-07 |

### governance/

| Documento | Propósito | Estado | Propietario | Revisión |
| --- | --- | --- | --- | --- |
| `governance/data-sheets/user-data.md` | Data Sheet — Datos de Usuario de Isabella | Vigente | Arquitectura | 2026-09-27 |
| `governance/human-oversight/governance-board.md` | AI Governance Board & Human Oversight Policy | Vigente | Arquitectura | 2026-09-27 |
| `governance/model-cards/isabella-sovereign.md` | Model Card — isabella-sovereign | Vigente | Arquitectura | 2026-09-27 |
| `governance/README.md` | Governanza de Isabella | Vigente | Arquitectura | 2026-09-27 |
| `governance/risk-register/README.md` | AI Risk Register | Vigente | Arquitectura | 2026-09-27 |
| `governance/system-cards/isabella-5-3-0.md` | System Card — Isabella 5.3.0 | Vigente | Arquitectura | 2026-09-27 |

### legal/

| Documento | Propósito | Estado | Propietario | Revisión |
| --- | --- | --- | --- | --- |
| `legal/ACCEPTABLE-USE-POLICY.md` | Acceptable Use Policy — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/AI-TRANSPARENCY-NOTICE.md` | AI Transparency Notice — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/API-TERMS.md` | API Terms — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/CONTRIBUTOR-AGREEMENT.md` | Contributor Agreement — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/COOKIE-POLICY.md` | Cookie Policy — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/DPA.md` | Data Processing Agreement (DPA) | Vigente | Legal | 2026-09-27 |
| `legal/HUMAN-OVERSIGHT-POLICY.md` | Human Oversight Policy — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/INCIDENT-RESPONSE-POLICY.md` | Incident Response Policy — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/LICENSES/CODE/README.md` | Código — Apache License 2.0 | Vigente | Legal | 2026-09-27 |
| `legal/LICENSES/COMMERCIAL/COMMERCIAL-LICENSE.md` | Commercial License — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/LICENSES/CONTENT/README.md` | CONTENT — Activación y contenido (licencia de contenido) | Vigente | Legal | 2026-09-27 |
| `legal/LICENSES/DOCS/README.md` | DOCS — Creative Commons Attribution 4.0 (CC BY 4.0) | Vigente | Legal | 2026-09-27 |
| `legal/LICENSES/MARKS/TRADEMARK-POLICY.md` | TRADEMARK POLICY — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/PRIVACY-NOTICE.md` | Privacy Notice — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/README.md` | Legal & Licensing | Vigente | Legal | 2026-09-27 |
| `legal/SECURITY-DISCLOSURE.md` | Security Disclosure — Isabella | Vigente | Legal | 2026-09-27 |
| `legal/THIRD-PARTY-NOTICES.md` | Third-Party Notices — Isabella | Vigente | Legal | 2026-09-27 |

### .github/

| Documento | Propósito | Estado | Propietario | Revisión |
| --- | --- | --- | --- | --- |
| `.github/pull_request_template.md` | PR — Isabella Genesis | Plantilla | Gobernanza | 2026-09-23 |

### Resto del árbol

| Documento | Propósito | Estado | Propietario | Revisión |
| --- | --- | --- | --- | --- |
| `authz-runtime/README.md` | Isabella Scope Authorization Runtime v4 | Vigente | Arquitectura | 2026-09-27 |
| `contrib/jdr-generator/docs/threat-model.md` | Isabella-JDR — Threat Model | Vigente | Arquitectura | 2026-09-23 |
| `genesis/reports/genesis-report-2026-09-07T23-58-41-581Z.md` | GENESIS 2.0 REPOSITORY EVIDENCE AUDIT REPORT | Vigente | Arquitectura | 2026-09-07 |
| `genesis/reports/genesis-report-2026-09-08T01-30-44-546Z.md` | GENESIS 2.0 REPOSITORY EVIDENCE AUDIT REPORT | Vigente | Arquitectura | 2026-09-07 |
| `latam-aegis-x/README.md` | LATAM AEGIS-X | Vigente | Arquitectura | 2026-09-01 |
| `quantum_utility_platform/README.md` | Quantum Utility Platform (qup) | Vigente | Arquitectura | 2026-09-01 |
| `src/lib/isabella/pake/DOCUMENTATION.md` | PAKE: Professional Anchoring of Ethical Knowledge | Vigente | Arquitectura | 2026-09-06 |
| `src/routes/README.md` | Routes | Vigente | Arquitectura | 2026-08-31 |

