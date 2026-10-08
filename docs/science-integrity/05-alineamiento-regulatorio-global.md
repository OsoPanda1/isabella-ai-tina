# 05 — Alineamiento Regulatorio Global

> **Estado:** Vigente (PLAN) — **Propietario:** Legal / Gobernanza — **Revisión:** 2026-10-07

Objetivo: que la plataforma cumpla y se alinee proactivamente con los marcos de **privacidad, integridad académica,
datos FAIR y credenciales verificables** aplicables en los mercados objetivo (Unión Europea, Estados Unidos,
Latinoamérica, Brasil/ANPD, Indonesia/LPDP, Reino Unido, Japón y Singapur).

## 1. Privacidad y protección de datos

### 1.1 GDPR (Reglamento UE 2016/679)
- **Base de legitimación:** consentimiento explícito / interés legítimo / contrato (según caso).
- **Derechos del interesado:** acceso, rectificación, supresión, portabilidad, oposición, limitación.
- **DPIA:** obligatoria para Verificación Humana y tratamiento de datos académicos a gran escala.
- **Notificación de brecha:** ≤ 72 h a la autoridad (`docs/operations/...` incident response y `legal/INCIDENT-RESPONSE-POLICY.md`).
- **Transferencias internacionales:** SCCs o sistemas IDPF vigentes; uk GDPR equivalente para Reino Unido.

### 1.2 Ley 27/2014 (Brasil) y otros regímenes
- LGPD: derechos del titular, ANPD, bases legales y transferencias.
- LPDP Indonesia (Law 27/2014): registro de procesadores y obligaciones locales.
- Leyes de datos de LGT y Malasia para latam/sureste asiático según despliegue regional.

### 1.3 Medidas comunes
Cifrado en tránsito/reposo, minimización, pseudonimización, bitácora de accesos, DPA y DUA en
`04-licenciamiento-y-modelos-legales.md`, y retención conforme a `03-reglamentos-y-politicas.md` §5.

## 2. Integridad y ética académica (COPE)

Alineación con las **Core Practices de COPE** (Committee on Publication Ethics):
- Gestión de reclamaciones y apelaciones.
- Manejo de acusaciones de mala conducta en investigación.
- Detección de fabricación, falsificación y plagio.
- Gestión de COI y publicación duplicada/redundante.
- Colaboración con revistas y bases de índice (Crossref/Retraction Watch).
- Enmiendas, correcciones y retractaciones (ver §6 de `03-reglamentos-y-politicas.md`).

## 3. Datos FAIR (Findable, Accessible, Interoperable, Reusable)

| Principio | Implementación |
| --- | --- |
| **F1** Identificadores persistentes | DOI para documentos, datasets y sellos |
| **F2** Metadatos ricos | Schema JSON-LD (`09-plantillas`), Dublin Core/DataCite |
| **F3** Metadatos indexados | Registro en DataCite/Crossref y buscador |
| **F4** Metadatos enlazados | IDs cruzados: DOI↔ORCID↔vocabularios |
| **A1/A2** Acceso: protocolo y auth | APIs abiertas con autenticación solo donde requiere restricción (evidencia firmada) |
| **I1/I2** Vocabularios e interop | Vocabularios controlados y ontologías (schema.org, CROSSREF) |
| **R1** Reutilizable | Licencias explícitas, procedencia (ledger), versionado, `environment_spec` |

## 4. Citas y crédito (DataCite, ORCID, DOI)

- **DataCite Metadata Schema** para la forma canónica de metadatos; mapeo JSON-LD en `09-plantillas`.
- **Crossref** para validación de referencias y registro de retractaciones/actualizaciones.
- **ORCID** como identidad de autores/revisores; vínculo obligatorio para firmas en sellos.
- Prácticas de atribución para revisiones, verificaciones y uso de datasets (contributor roles).

## 5. Credenciales verificables (W3C VC / Data Integrity)

Alineación con **W3C Verifiable Credentials Data Model v1.1** (`https://www.w3.org/TR/vc-data-model/`):
- `credentialSubject` con claims de nivel, fecha, vc_hash, merkle_root.
- Verificación pública vía `/api/v2/cert/{cert_id}/verify` y endpoint DID/DID document.
- Revocación vía estado registrado en ledger (independiente de la integridad single-node).

## 6. Seguridad de la información (ISO/IEC 27001:2022)

- Sistema de Gestión de Seguridad de la Información con controles Anexo A (cifrado, gestión de
  vulnerabilidades, continuidad, control de accesos, gestión de incidentes, auditoría).
- Auditorías anuales internas y externas; gestión de riesgos con política de tolerancia definida.
- Compatibilizar con `docs/operations/` (hardening, CSP, rate-limiting, backup, secrets) y
  `docs/security/THREAT-MODEL-TINA-*.md`.

## 7. Referencias canónicas

| Marco | Documento / recurso |
| --- | --- |
| COPE Core Practices | https://publicationethics.org/core-practices |
| Principios FAIR | https://www.go-fair.org/fair-principles/ |
| DataCite Metadata | https://datacite.org/ |
| W3C VC Data Model | https://www.w3.org/TR/vc-data-model/ |
| GDPR | https://gdpr-info.eu/ |
| ISO/IEC 27001:2022 | https://www.iso.org/standard/27001.html |
| LGPD (BR) | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm |
| LPDP (ID) | https://pidata.id/ |
| Crossref | https://www.crossref.org/ |
| ORCID | https://orcid.org/ |
| Retraction Watch | https://retractionwatch.com/ |

> Nota: las URLs anteriores son referencias públicas de programación/regulatorias del proyecto; no son enlaces externos al código.