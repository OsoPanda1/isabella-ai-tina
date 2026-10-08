# Isabella Villaseñor AI — TINA

**Trusted Intelligence, Native & Adaptive** — arquitectura de inteligencia artificial **gobernada, federada y auditable** del ecosistema **TAMV Online Network** (RDM Digital Hub · Nodo Cero · Real del Monte, Hidalgo, México + community partners LATAM).

- Versión del proyecto (`package.json`): **4.3.3**
- Versión de este documento: **6.0.0** — fecha **2026-10-08** (Fase B TESTED: puente nativo de Integridad Científica + README integral)
- Medición de gates y métricas: **2026-10-08**, en local (ver [Estado y porcentaje de avance a producción](#estado-y-porcentaje-de-avance-a-producción))

> **Regla de honestidad** (heredada de `AGENTS.md`): _código existente ≠ capacidad verificada; un test local ≠ producción; build verde ≠ certificación; una firma simulada ≠ criptografía operativa; un hash ≠ WORM regulatorio_. Ninguna sección de este documento afirma que Isabella esté lista para producción ni que sea un producto comercial certificado. Estado **TESTED** (local, 2026-10-08); estado **CERTIFIED** exige auditoría externa independiente (Nivel 4).

---

## Estados de código usados en este documento

| Estado    | Significado                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **(A)**   | Implementado **y** cableado a un punto de entrada, con tests.                                                                               |
| **(A)\*** | Implementado y cableado a un punto de entrada, **sin tests unitarios propios** (cobertura solo indirecta).                                  |
| **(B)**   | Implementado y con tests, pero **sin consumidor**: superficie no expuesta, código muerto o pendiente de cableado.                          |
| **(C)**   | Solo documentado, o **no existe**. El código presente con 0 importadores y sin suite propia se marca **(C)** y se rotula "código muerto".  |
| **TESTED**| Pruebas automatizadas aprobadas (escala `AGENTS.md` §0.1).                                                                                 |

---

## Índice

1. [Qué es el proyecto](#qué-es-el-proyecto)
2. [Qué problema resuelve](#qué-problema-resuelve)
3. [Cómo funciona](#cómo-funciona)
4. [Stack y dependencias](#stack-y-dependencias)
5. [Funciones principales](#funciones-principales)
6. [Skills y Tools](#skills-y-tools)
7. [Elementos nativos del ecosistema](#elementos-nativos-del-ecosistema)
8. [Verificación y Certificación de Integridad Científica (TESTED)](#verificación-y-certificación-de-integridad-científica-tested)
9. [Isabella Hypercore — aceleración adaptativa gobernada](#isabella-hypercore--aceleración-adaptativa-gobernada)
10. [Blindaje jurídico-legal anclado a DOIs](#blindaje-jurídico-legal-anclado-a-dois)
11. [Estado y porcentaje de avance a producción](#estado-y-porcentaje-de-avance-a-producción)
12. [Roadmap verificable](#roadmap-verificable)
13. [Licencia y gobernanza](#licencia-y-gobernanza)
14. [Contacto y reportes de seguridad](#contacto-y-reportes-de-seguridad)

---

## Qué es el proyecto

**Isabella Villaseñor AI** es una capa de orquestación cognitiva gobernada: coordina modelos de inferencia externos, memoria, identidad, políticas, herramientas, evidencia y auditoría dentro de un entorno de **soberanía digital** y territorios vinculados (LATAM, especialmente Nodo Cero en Real del Monte, México). No es un único LLM: es la orquestación entre modelos, reglas, retrieval y herramientas bajo límites explícitos y auditables.

### Qué es

- una plataforma de orquestación con gobernanza de políticas y autorización **server-side**;
- un gateway conversacional con streaming SSE, salida gobernada y trazabilidad;
- un registro de **skills** y **herramientas** ejecutables bajo contrato;
- un laboratorio de investigación aplicada en seguridad de agentes, procedencia y soberanía digital;
- una infraestructura multi-tenant con aislamiento por tenant, RBAC/ABAC y evidencia de decisiones;
- un sistema de **verificación y certificación de integridad científica** con sellos criptográficos, revisión humana y auditoría externa.

### Qué NO es

- no es AGI, ni consciencia artificial, ni persona ni sujeto jurídico;
- no es una certificación de producción, ni una acreditación jurídica, financiera, académica o regulatoria;
- no es una garantía de neutralidad, exactitud o seguridad absoluta;
- no es un único LLM ni una autoridad autónoma sobre seres humanos;
- no es, por sí solo, protección de propiedad intelectual: el blindaje técnico y documental **reduce** el riesgo de plagio/robo, pero no sustituye asesoría ni registro legal.

### Principio rector (AGENTS.md)

> _Las inteligencias sugieren, calculan y evalúan; el humano decide, aprueba y ejecuta._

Doctrina de capacidad y autoridad:

```
capacidad técnica ≠ permiso      ·  predicción ≠ hecho
recomendación ≠ aprobación       ·  modelo ≠ autoridad
memoria ≠ verdad                 ·  hash ≠ WORM regulatorio
build verde ≠ certificación
```

---

## Qué problema resuelve

Cuando un sistema de IA deja de ser solo conversacional y toca **memoria privada, herramientas, servicios externos, dinero y decisiones**, el modelo tiende a ocupar a la vez cinco roles (inteligencia, autoridad, ejecutor, auditor, aprendiz) de forma inseparable. **Isabella los separa.**

- **Autoridad difusa:** el modelo no autoriza sus propias herramientas ni acciones.
- **Egress incontrolado:** toda llamada saliente pasa por allowlist, bloqueo de SSRF y circuit breaker.
- **Salida no inspeccionada:** lo que el modelo produce se escanea antes de salir, incluso en streaming.
- **Memoria sin frontera:** recuperación por scopes, tenant, consentimiento y procedencia.
- **Evidencia frágil:** las decisiones necesitan hash, cadena de integridad y registro append-only.
- **Claims inflados:** implementar algo no equivale a tenerlo certificado; hay que distinguir estados (`PLAN/DOC → IMPLEMENTED → TESTED → VERIFIED → DEPLOYED → HARDENED → CERTIFIED`).
- **Ciencia sin verificación:** distinguir afirmación sostenida, insuficiente, contradictoria o no verificable, y blindar procedencia con sellos.

---

## Cómo funciona

Pipeline real de una petición de chat (ruta de archivo verificada):

1. **Entrada:** `POST /api/isabella` o `POST /api/v1/isabella` (TanStack file-routes o Express catch-all)
2. **Autenticación:** `withSovereignAuth` → identidad, tenant, scopes y roles server-side
3. **Policy, cuota y sanitización:** rate limit distribuido + Zod validation + sanitización de payload
4. **Skills:** resuelve skill en runtime con `getRuntimeSkill` → ejecuta gobernado en `executeConversationalSkill`
5. **Inferencia:** cadena multi-proveedor (groq → gemini → xai → ai-gateway) con `fetchSafeUpstream` y `selectRemoteProviders`
6. **Output gate (SSE):** `ALLOW/FLAG/DENY` — ante `DENY` cancela el upstream
7. **Auditoría:** `AutoAuditingSystem` → ledger de decisiones (PostgreSQL, fail-closed) + observabilidad
8. **Fallback:** respuesta soberana local degradada si no hay proveedor

---

## Stack y dependencias

| Capa               | Tecnología                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Runtime            | Node.js 24.x, Docker `node:24.11.0-alpine`                                                           |
| Package manager    | pnpm 10.34.5                                                                                        |
| Framework web      | TanStack Start 1.168+ + Vite 8 + Nitro 3                                                            |
| Lenguaje           | TypeScript 6.0 (strict mode, `tsc --noEmit`)                                                        |
| UI                 | React 19 · Tailwind CSS 4 · Radix UI · Framer Motion · Three.js                                     |
| Backend            | Express 5 · h3                                                                                      |
| Base de datos      | PostgreSQL/Neon · Prisma 7 · Drizzle · better-sqlite3                                              |
| IA                 | Vercel AI SDK · @google/genai · anthropic (transports implementados)                                 |
| Tests              | vitest 5 (unit, security, bookpi, integration)                                                      |
| Lint/Format        | ESLint 10 + typescript-eslint + eslint-plugin-security + Prettier 3                                 |
| Despliegue         | Vercel (Nitro) · Docker · 18 workflows GitHub Actions                                               |

---

## Funciones principales

### Conversación e inferencia **(A)**
- Chat SSE con dos rutas API protegidas.
- Selección multi-proveedor (groq, gemini, xai, AI Gateway) con fallback y `selectRemoteProviders` (`src/lib/intelligence/transports/registry.ts`).
- Normalización de SSE Gemini ↔ OpenAI; gate de salida aplicado al stream.

### Gobernanza y autorización **(A)**
- Policy engine versionado con decisiones allow/deny (`CROWN`).
- RBAC, ABAC, capability tokens, aislamiento por tenant.
- Validación Zod sin `process.env` directo fuera de config.
- Kill-switch y audit trail (`ARGUS`).

### Seguridad **(A)**
- `SecuritySystem`: sanitización, rate limiting distribuido, allowlist egress, circuit breaker.
- SSRF deny (CIDR, loopback, IMDS); escaneo de secretos y detección de PII.
- Output gate `ALLOW/FLAG/DENY` con cancelación de upstream; firewall de inyección.

### Memoria y evidencia **(A)**
- BookPI: ledger append-only con hash-chain integrity.
- IGDS: procedencia y sellos (`src/lib/igds/`).
- Decision ledger auditable cuando existe `DATABASE_URL`.
- Scope jerárquico, consentimiento y expiración.

### Verificación científica **(TESTED, 2026-10-08)**
- Ingestion JSON-LD con digests + Merkle RFC 6962 y ledger encadenado.
- Verificador `nlp_claims` sobre claim-radar (100 casos de contrato) y señales `native-ml` gobernadas.
- Pipeline de decisión con reglas del manual §4.2, revisión humana firmada y emisión/verificación/revocación de VC/IGDS.
- Rail Hypercore gobernado (fail-closed). Detalle en [§8](#verificación-y-certificación-de-integridad-científica-tested).

---

## Skills y Tools

### Skills
- Registro en ejecución con **50+ skills gobernados** bajo contrato (`getRuntimeSkill`).
- Bridge y executor con validación de contrato en runtime.
- Un skill no puede autorizarse a sí mismo: la autorización se repite inmediatamente antes de ejecutar.

### Tools (catálogo y registro)
- **5 herramientas ejecutables** en `tools-catalog.ts`.
- **28 descriptores de política** en `tool-registry.ts` (`ToolContract`: nombre, versión, riesgo, esquemas de entrada/salida, scopes, timeout, side effects, aprobación humana).
- Whitelist de egress + circuit breaker por herramienta.

---

## Elementos nativos del ecosistema

Isabella integra librerías **nativas** (propias del repositorio) que interconectan evidencia, epistemología, ML y ejecución gobernada:

| Módulo nativo | Ruta | Función | Estado |
| --- | --- | --- | --- |
| **CROWN / ARGUS** | `src/lib/crown.ts` · `constitutional-gate.ts` · `authorization.ts` | Arbitraje de políticas; veto, redacción y auditoría | **(A)** |
| **BookPI** | `src/lib/bookpi*` · `repositories/bookpi-postgres-repository.ts` | Ledger append-only con integridad hash | **(A)** |
| **IGDS** | `src/lib/igds/` | Sellos de procedencia: canonicalización JCS RFC 8785, firmas Ed25519/ML-DSA-65, Merkle, TSA RFC 3161 (opcional), revocación, verificación offline | **(A)** |
| **NCUA** | `src/lib/ncua/` | Epistemología E0–E4 + ERI (Índice de Robustez Epistémica), gates fail-closed | **(A)** |
| **native-ml** | `src/lib/native-ml/` | Clasificadores gobernados: `classifyTextRisk`, `governed-ml` (drift + fairness) | **(A)** |
| **claim-radar** | `src/lib/claim-radar/` | Evaluación de afirmaciones (`retrieval ≠ proof`), separando sostiene/contradice/insuficiente/no disponible | **(A)** |
| **mcp-adapters** | `src/lib/mcp-adapters/` | Hub de conectores (Zenodo, OSF, LITLE) con timeout y fusión de resultados | **(A)*** |
| **acceleration/hypercore** | `src/lib/acceleration/` | Rail de aceleración gobernada (turbos/nitros, `mandatoryGate` siempre) | **(A)** + `node --test` |
| **science-integrity** | `src/lib/science-integrity/` | **Nuevo:** puente Fase B (B0–B6) de Verificación y Certificación | **(TESTED)** |
| **orion / sovereign-sandbox** | `src/lib/orion-engine.ts` · `sovereign-sandbox.ts` | Ejecución de herramientas aislada | **(A)** |

---

## Verificación y Certificación de Integridad Científica (TESTED)

Filtra, verifica, certifica y blinda la veracidad, viabilidad y respaldo de la información científica y técnica con **trazabilidad criptográfica**, gobernanza de datos, revisión humana y auditoría externa. La **Fase A documental** (contratos OpenAPI, manual operativo, plantillas legales, playbooks, plan de certificación) se integró con correcciones C1–C9; la **Fase B nativa** quedó **TESTED** el 2026-10-08.

### Fases implementadas (B0–B6)

| Fase | Módulo `src/lib/science-integrity/` | Qué hace | Estado |
| --- | --- | --- | --- |
| B0 | `ingest.ts` + `ledger.ts` | Ingreso JSON-LD; digests SHA-256; Merkle RFC 6962; `ingest_event`/`verification_event` en ledger encadenado | ✅ TESTED |
| B1 | `claims.ts` | Complemento `nlp_claims` sobre claim-radar; 100 casos de contrato; `groundingScore` honesto | ✅ TESTED |
| B2 | `classifiers.ts` | Señales `native-ml`: `classifyTextRisk`, drift, fairness, `plagiarismSuspicion`, `citationCoverage` | ✅ TESTED |
| B3 | `pipeline.ts` + `hypercore.ts` | Agregación §4.2 (pesos 0.35/0.20/0.25/0.10/0.10; umbrales 0.70/0.90; banderas críticas; fail-closed) y rail Hypercore gobernado | ✅ TESTED |
| B4 | `review.ts` | Revisión humana con firma Ed25519 real → `review_event` | ✅ TESTED |
| B5 | `certification.ts` | Emisión/verificación/revocación VC-IGDS (perfil `restricted` sin TSA; `public-verifiable` exige RFC 3161); verificación consulta revocaciones Genesis | ✅ TESTED |
| B6 | Gates | `typecheck` 0, suite `1258 passed / 9 skipped`, `security:scan`, `production:gate` | ✅ TESTED |

### Superficie HTTP (montada en `server.ts`)

| Endpoint | Función |
| --- | --- |
| `GET  /api/v1/science-integrity` | Metadatos del subsistema y honestidad de estado |
| `POST /api/v1/science-integrity/verify` | Pipeline completo de verificación (fail-closed sin señales externas) |
| `POST /api/v1/science-integrity/hypercore-verify` | Verificación vía rail Hypercore gobernado |
| `POST /api/v1/science-integrity/reviews` | Revisión humana firmada (B4) |
| `POST /api/v1/science-integrity/certificates` | Emisión de certificado VC/IGDS (B5) |
| `GET  /api/v1/science-integrity/certificates/:certId` | Verificación pública (incl. estado de revocación) |
| `POST /api/v1/science-integrity/certificates/:certId/revoke` | Revocación en Genesis (append-only) |

**Honestidad del pilar:** estado **TESTED**, no **CERTIFIED**. Sin conectores de evidencia el pipeline rechaza por señales insuficientes (fail-closed); solo un agregado `>= 0.90` habilita un sello de **Nivel 2 provisional**; **Nivel 4** requiere auditoría externa independiente (≤ 3 años). El sello autentica integridad/procedencia, no la verdad del contenido.

---

## Isabella Hypercore — aceleración adaptativa gobernada

Capa de aceleración adaptativa (el "Tsuru con turbos"). El núcleo —CROWN, autorización, policy-as-code, evidencia y output-security— sigue siendo **autoridad final**.

> **Invariante:** ningún turbo ni nitro concede autoridad. El `mandatoryGate` (policy + evidence + safety) se ejecuta **siempre**. Timeout, error o resultado malformado de un rail obligatorio equivale a **DENY**, nunca a **ALLOW**.

- **Turbos:** VECTOR (`PREFIX_CACHE`, `SEMANTIC_CACHE`), SPECULATIVE (`DRAFT_MODEL`, `PARALLEL_BRANCHES`), VERITAS (`VERIFIER_FANOUT`, `EARLY_EXIT`).
- **Modos:** `CRUISE` → `BOOST` → `HYPERBOOST` (alteran presupuestos, nunca eliminan el gate).
- **Superficie:** `GET/POST /api/v1/isabella/hypercore` + `/decide` + `/run` (el último responde `503` fail-closed en producción hasta cablear adaptadores reales).
- Detalle en `docs/acceleration/README.md`.

---

## Blindaje jurídico-legal anclado a DOIs

El proyecto combina **identificadores persistentes**, sellos criptográficos y plantillas legales para blindar autoría, procedencia y trazabilidad frente a plagio, robo de código/documentación o claims sin sustento:

### Identificadores permanentes (anclas)
- **DOI del registro Open Science:** `10.5281/zenodo.20606361` (autoría y evidencia)
- **OSF:** `10.17605/OSF.IO/T3WMY`
- **Frontiers Loop:** `3117809`
- **ORCID del autor técnico:** `0009-0008-5050-1539` (validado ISO 27729 en contratos)
- **Licencia:** **CC BY 4.0** para documentación/contenido; código bajo la licencia que cada dependencia declare (ver `LICENSES.md`)

### Cómo funciona el blindaje anti plagio / robo
1. **Notaría criptográfica interna:** cada documento científico se ancla en un **ledger append-only** (hash-chaining SHA-256 + JCS RFC 8785) y en el **registro Genesis IGDS** (sello Ed25519, Merkle, entrada encadenada). Alterar o plagiar rompe la cadena (`BLOCK_TAMPERED`/`verifyGenesisChain`).
2. **Sellos de VC verificables:** emisión, verificación pública y revocación de credenciales verificables JSON-LD (`VC_SCHEMA`) con perfil `restricted` (offline) o `public-verifiable` (RFC 3161 TSA, fail-closed si no hay TSA).
3. **Afirmaciones con procedencia:** cada claim cita DOIs/URLs/ISBN y el verificador `nlp_claims` documenta sostiene/contradice/insuficiente/no disponible (retrieval ≠ proof). El DOI citado queda en el árbol Merkle del documento.
4. **Plantillas legales integradas** (`docs/science-integrity/artifacts/legal/`): TOS, DPA (GDPR + SCC), DUA y Contrato de Revisor, con cláusulas de propiedad intelectual, confidencialidad y responsabilidad, alineadas al marco regulatorio global (GDPR, EU AI Act, marco UNESCO/ONU/OECD/WEF/NIST, leyes mexicanas).
5. **Auditoría y apelación:** playbooks de incidentes (incl. fraude y apelación), política de retractación y revocación registradas en ledger.
6. **Piloto y evidencia:** el paquete documental completo vive en `docs/science-integrity/` (00-INDICE · blueprint · manual técnico §4.2 · reglamentos · licenciamiento · alineamiento regulatorio · plan de certificación · playbooks · hoja de ruta · plantillas · especificación de integración).

> **Límite honesto:** este blindaje es **técnico + documental**: minimiza riesgos de plagio/robo y aporta evidencia auditable, pero **no sustituye** registro de propiedad intelectual, asesoría legal por jurisdicción ni certificación regulatoria. Nada de esto es una garantía absoluta.

---

## Estado y porcentaje de avance a producción

### ✅ Verificado (local, misma máquina — 2026-10-08)
- **Typecheck:** `pnpm typecheck` (`tsc --noEmit`) — **0 errores**.
- **Tests:** `pnpm test` (vitest) — **169 archivos (170, 1 skipped), 1258 tests passed, 9 skipped, 0 failed** (incluyen los 33 tests nuevos de la Fase B).
- **Hypercore:** `node --test` **10/10** (más vitest del motor).
- **Build:** `pnpm build` (Vite + Nitro + client-shell) — **SUCCESS**.
- **Gates:** `pnpm production:gate` **PASS** · `pnpm verify:lock` **OK** · `pnpm audit:routes` **0 findings** · `pnpm security:scan` **0 errores ESLint + 0 secretos** (14 warnings de regex preexistentes, no bloqueantes).

### 🟡 Pendiente / no verificable desde local
- CI en GitHub (billing) y estado remoto de PRs dependabot (#473–#477, #472) y críticos (#455, #449).
- 7 branches `repair/*` a limpiar (remoto).
- `pnpm lint` (repo completo) excede 15 min en este entorno; el conjunto de código cambiado fue lint-verificado con **0 errores**.
- Ledger en PostgreSQL productivo (la implementación es cargo de referencia en memoria), TSA/HSM-KMS, adaptadores MCP cableados en runtime, auditoría externa Nivel 4.
- Módulos documentales por recibir: cronograma/costos CSV, scripts reproducibles + Dockerfile, archivos exportables (.puml/.yaml/.md/.csv).

### Porcentaje de avance hacia producción y despliegue (estimación interna)

| Componente | Avance | Estado |
| --- | --- | --- |
| Documentación del pilar (Fase A) | 100% | Integrada + correcciones C1–C9 (**TESTED** como registro) |
| Puente nativo Fase B (B0–B6) | 100% | Implementado + tests (**TESTED** 2026-10-08) |
| Motor, política y evidencia | 100% | Gates locales **PASS** |
| Integralidad del ledger (PostgreSQL) | ⚠️ referencial | En memoria (`approval-repository`) — productivo pendiente |
| Adaptadores MCP runtime | ⚠️ parcial | Hub listo; sin conectores por defecto (fail-closed honesto) |
| TSA / HSM-KMS (Nivel 3–4) | 0% | Pendiente |
| CI remoto + deploys Vercel/Nitro | 0% | Pendiente (billing GitHub Actions) |
| Auditoría externa independiente (Nivel 4) | 0% | Pendiente |
| **Estimación global (no certificada)** | **≈ 80%** | Camino a un **primer despliegue controlado**; **0%** de certificación formal |

> **Lectura honesta:** el código y las pruebas representan **~80% del recorrido hacia un primer despliegue controlado** en local (estimación interna basada en fases completadas y gates). La **certificación formal (Nivel 4) es 0%**: exige TSA/HSM reales, ledger PostgreSQL productivo, adaptadores de evidencia, CI remoto, despliegue en ambiente identificable y auditoría externa independiente.

---

## Roadmap verificable

### Corto plazo (próximas 2 semanas)
- [x] Fase A (paquete documental) integrada con correcciones C1–C9
- [x] Fase B (puente nativo B0–B6) implementada y **TESTED** — 33 tests nuevos
- [x] `pnpm production:gate` full local — **PASS** (2026-10-07/08)
- [ ] CI en GitHub Actions activo (resolver billing) y PRs dependabot en orden (#473→#474→#475→#476→#477→#472)
- [ ] Verificar gates verdes en #455 y #449 (remoto); limpiar `repair/*`
- [ ] Integrar módulos documentales restantes (cronograma/CSV, Dockerfile reproducible, exportables) → `00-INDICE.md` §8
- [ ] Cablear adaptadores MCP de evidencia (Zenodo/OSF/LITLE) y persistir el ledger en PostgreSQL

### Mediano plazo (próximo mes)
- [ ] SBOM verificado por release; attestations SLSA L3
- [ ] Primer despliegue controlado (Vercel/Nitro) con gates remotos verdes
- [ ] TSA RFC 3161 y hardening HSM/KMS; rotación de llaves documentada
- [ ] Primer piloto de sellos de verificación (beta cerrada, 100–200 contenidos)
- [ ] ADR para branch protection policy

### Largo plazo
- [ ] Auditoría externa de seguridad
- [ ] Certificación de gobernanza de IA
- [ ] Despliegue multi-región con replicación de ledger
- [ ] Acreditación **Nivel 4** (auditoría externa independiente del pilar de Integridad Científica)

---

## Licencia y gobernanza

- **Código:** Apache License 2.0 (ver `LICENSE-CONTROL.md`)
- **Documentación:** CC BY 4.0
- **Gobernanza:** FGAIS Governance Charter en `docs/governance/`
- **Contribución:** Ver `CONTRIBUTING.md`; flujo `feat/<short-name>` con gates obligatorios (`typecheck`, `lint`, `test`, `build`) y **prohibido** reescribir historia en ramas remotas.

---

## Contacto y reportes de seguridad

- **Propietario:** @OsoPanda1
- **Reportes de seguridad:** GitHub Security Advisories (private)
- **General:** Issues con label `[question]` o `[discussion]`

---

**Última auditoría local:** 2026-10-08 | **Fase B puente nativo:** TESTED (B0–B6, gates verdes) | **Certificación:** NO (es código en evolución, no producto certificado) | **Avance estimado a despliegue controlado:** ≈ 80% (no certificado) | **Registros:** DOI 10.5281/zenodo.20606361 · OSF 10.17605/OSF.IO/T3WMY · Frontiers Loop 3117809