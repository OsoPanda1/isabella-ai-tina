# Índice canónico de documentación — Isabella AI Genesis v4.3.3

> **Regla:** este índice es el único punto de entrada a la documentación viva.
> Todo lo demás en `docs/_archive/` es histórico: no citar como autoridad sin revisar vigencia.
> Cifras y versiones: `package.json` (SSOT) + `production-capabilities.json` + `AGENTS.md`.
>
> **Custodia y estado:** [`docs/README.md`](README.md) registra propósito, propietario,
> estado y última revisión de los documentos vivos (110+, ver registro). Este archivo describe
> *qué leer*; aquél describe *quién lo mantiene y si sigue vigente*.

## Canon vivo (leer en este orden)

| # | Documento | Contenido |
|---|-----------|-----------|
| 0 | `AGENTS.md` | Arquitectura, seguridad, gobernanza, contratos canónicos, reglas de agentes |
| 1 | `docs/01-ISABELLA-CANONICA-UNIFICADA.md` | Identidad, 4 planos, CROWN v6, pipeline FGAIS |
| 2 | `docs/02-ISABELLA-OPERACIONES-PRODUCCION.md` | Gates, DB, Vercel, SLO, capacidades |
| 3 | `docs/03-ISABELLA-SEGURIDAD-PRIVACIDAD.md` | Zero Trust, auth, crypto triangulado, privacidad |
| 4 | `docs/04-ISABELLA-ECONOMIA-BOOKPI.md` | BookPI, Stripe, Cattleya, x402 |
| 5 | `docs/05-ISABELLA-INTELIGENCIA-ML.md` | ML gobernado, HDC, NCUA, quantum, skills |
| 6 | `docs/06-ISABELLA-DESARROLLO-CONTRIBUCION.md` | Stack, comandos, contribución, licencias |
| 7 | `docs/07-TINA-CATEGORIA.md` | Categoría TINA — Isabella primera AI declarada |
| 8 | `docs/08-ISABELLA-VERIFICACION-CERTIFICACION-INTEGRIDAD.md` | Pilar de Verificación, Certificación y Blindaje de Integridad Científica (plan) → `docs/science-integrity/00-INDICE.md` |

## Raíz del repo

| Documento | Rol |
|-----------|-----|
| `README.md` | Presentación operativa y ficha verificada (se reescribe con evidencia real) |
| `SECURITY.md` | Reporte responsable, rotación de claves, gates de seguridad |
| `AGENTS.md` | SSOT arquitectónica para agentes y contribuidores |
| `LICENSE` / `LICENSE-*` / `NOTICE` | Licencias software/docs/marca |

## Áreas de soporte (vivas)

- `docs/architecture/SSOT.md` — SSoT por dominio
- `docs/architecture/RUNTIME-AUTHORITY-MAP.md` — mapa de autoridades runtime
- `docs/operations/` — runbooks operativos (SLO, CSP, rate limit, backups, HSM, etc.)
- [`docs/operations/SECRETS-CATALOG.md`](operations/SECRETS-CATALOG.md) — catálogo de claves externas e internas y requisitos por capacidad
- `docs/runbooks/incident.md` — respuesta a incidentes P0/P1
- `docs/security/ISABELLA-API-KEYS.md` — contrato de API keys
- `docs/evidence/` — manifiestos de evidencia same-commit
- `docs/ml/DRIFT.md` — drift y fairness ML
- `docs/governance/01-FGAIS-Governance-Constitution.md` — charter FGAIS
- `docs/science-integrity/00-INDICE.md` — paquete de Verificación y Certificación de Integridad Científica (índice/registro de entregas)
- `docs/science-integrity/10-integracion-hypercore-ml-nativo.md` — contrato de integración Hypercore + ML nativo (Fase B)
- `docs/science-integrity/artifacts/openapi.yaml` — contrato OpenAPI v2 ampliado (ingestión/verificación/certificación/auditoría)

## Registros de decisión de arquitectura (ADR)

| ADR | Documento | Ubicación | Estado |
|-----|-----------|-----------|--------|
| ADR-011 | Blueprint Maestro v2.0 — adaptación al stack TypeScript | `docs/architecture/ADR-011-blueprint-maestro-v2-adaptacion-ts.md` | Aceptado (2026-09-17) |
| ADR-012 | Evidence Ledger — bitácora append-only encadenada por hash | `docs/architecture/ADR-012-evidence-ledger.md` | Aceptado (2026-09-26) |
| ADR-013 | Propiedad canónica del generador JDR | `docs/architecture/ADR-013-jdr-generator-propiedad.md` | Aceptado (2026-09-30) |
| ADR-014 | Consolidación del kernel cognitivo canónico | `docs/architecture/ADR-014-canonical-cognitive-kernel.md` | Propuesto (2026-09-30) |
| ADR-001 … ADR-010 | 16 registros históricos | `docs/_archive/architecture/` | Históricos; varios aceptados el 2026-09-05 |

> **Colisión de numeración (abierta):** `docs/_archive/architecture/` conserva dos
> series paralelas que reutilizan los números 001–005 y 008 (p. ej.
> `ADR-001-source-of-truth.md` frente a `ADR-001-authorization-plane.md`).
> Renumerarlas exige un ADR nuevo; hasta entonces no se promueven al canon y no
> deben citarse como autoridad sin revisar vigencia.

## Archivo histórico

`docs/_archive/**` conserva ADRs, auditorías, unificaciones previas y documentos
absorbidos por `docs/01..06`. No borrar sin política de retención; no usar como fuente de cifras actuales.

## Higiene documental y artefactos

- `docs/_archive/**` es histórico deliberado y no se usa como fuente operativa.
- Los artefactos generados (`.output`, `dist`, `.next` y caches) están excluidos del control de versiones.
- Los duplicados exactos restantes se conservaron cuando pertenecen a contratos distintos: assets públicos/runtime, catálogos de policy y fixtures de despliegue.
- `README.md` documenta únicamente capacidades y validaciones verificables; no convierte intención o documentación histórica en evidencia de producción.
- Toda futura deduplicación debe comprobar referencias, propietario funcional, licencia y ruta de despliegue antes de borrar.
