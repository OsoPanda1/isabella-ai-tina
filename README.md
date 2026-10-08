# Isabella Villaseñor AI — TINA

**Trusted Intelligence, Native & Adaptive** — arquitectura de inteligencia artificial gobernada, federada y auditable del ecosistema **TAMV Online Network** (RDM Digital Hub · Nodo Cero · Real del Monte + LATAM community partners).

- Versión del proyecto (`package.json`): **4.3.3**
- Versión de este documento: **5.1.0** — fecha **2026-10-07** (blindaMax · pilar de Integridad Científica + gates limpios)
- Medición de gates y métricas: **2026-10-07**, en local (ver [Estado y avance a producción](#estado-y-avance-a-producción))

> **Regla de honestidad** (heredada de `AGENTS.md`): _código existente ≠ capacidad verificada; un test local ≠ producción; build verde ≠ certificación_. Ninguna sección de este documento afirma que Isabella esté lista para producción ni que sea un producto comercial certificado.

---

## Estados de código en este documento

| Estado    | Significado                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **(A)**   | Implementado **y** cableado a un punto de entrada, con tests.                                                                             |
| **(A)\*** | Implementado y cableado a un punto de entrada, **sin tests unitarios propios** (cobertura solo indirecta).                                |
| **(B)**   | Implementado y con tests, pero **sin consumidor**: superficie no expuesta, código muerto o pendiente de cableado.                         |
| **(C)**   | Solo documentado, o **no existe**. El código presente con 0 importadores y sin suite propia se marca **(C)** y se rotula "código muerto". |

---

## Introducción

**Isabella Villaseñor AI** es una capa de orquestación cognitiva gobernada: coordina modelos de inferencia externos, memoria, identidad, políticas, herramientas, evidencia y auditoría dentro de un entorno de soberanía digital y territorios vinculados (LATAM, especialmente Nodo Cero en Real del Monte, México).

### Qué es

- una plataforma de orquestación con gobernanza de políticas y autorización server-side;
- un gateway conversacional con streaming SSE, salida gobernada y trazabilidad;
- un registro de skills y herramientas ejecutables bajo contrato;
- un laboratorio de investigación aplicada en seguridad de agentes, procedencia y soberanía digital;
- una infraestructura multi-tenant con aislamiento por tenant, RBAC/ABAC y evidencia de decisiones.

### Qué NO es

- no es AGI, ni consciencia artificial, ni persona ni sujeto jurídico;
- no es una certificación de producción, ni una acreditación jurídica, financiera, académica o regulatoria;
- no es una garantía de neutralidad, exactitud o seguridad absoluta;
- no es un único LLM ni una autoridad autónoma sobre seres humanos.

### Principio rector de AGENTS.md

> _Las inteligencias sugieren, calculan y evalúan; el humano decide, aprueba y ejecuta._

---

## ¿Qué problema resuelve?

Cuando un sistema de IA deja de ser solo conversacional y empieza a tocar **memoria privada, herramientas, servicios externos, dinero y decisiones**, el modelo tiende a ocupar a la vez cinco roles (inteligencia, autoridad, ejecutor, auditor, aprendiz) de forma inseparable. **Isabella resuelve eso separando esos roles.**

### Problemas concretos abordados

- **Autoridad difusa:** el modelo no debe poder autorizar sus propias herramientas ni sus propias acciones.
- **Egress incontrolado:** toda llamada saliente debe pasar por allowlist, bloqueo de SSRF y circuit breaker.
- **Salida no inspeccionada:** lo que el modelo produce debe ser escaneado antes de salir, incluso en streaming.
- **Memoria sin frontera:** recuperación por scopes, tenant, consentimiento y procedencia.
- **Evidencia frágil:** las decisiones necesitan hash, cadena de integridad y registro append-only.
- **Claims inflados:** implementar algo no equivale a tenerlo certificado; hace falta distinguir estados.

---

## Cómo funciona

Pipeline real de una petición de chat (ruta de archivo verificada):

1. **Entrada:** `POST /api/isabella` o `POST /api/v1/isabella` (TanStack file-routes o Express catch-all)
2. **Autenticación:** `withSovereignAuth` → identidad, tenant, scopes y roles server-side
3. **Policy, cuota y sanitización:** rate limit distribuido + Zod validation + sanitización de payload
4. **Skills:** resuelve skill en runtime con `getRuntimeSkill` → ejecuta gobernado en `executeConversationalSkill`
5. **Inferencia:** cadena multi-proveedor (groq → gemini → xai → ai-gateway) con `fetchSafeUpstream`
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

## Estado de producción (2026-10-07)

### ✅ Verificado (local, misma máquina)
- Typecheck: `pnpm typecheck` (`tsc --noEmit`) — **0 errores** (deuda preexistente 247 resuelta en esta ronda).
- Tests: `pnpm test` (vitest) — **165 archivos, 1225 tests passed, 9 skipped, 0 failed**.
- Hypercore: `pnpm hypercore:test` — **10/10 pass** (más 10 vitest del motor).
- Build: `pnpm build` (Vite + Nitro + client-shell) — **SUCCESS**.
- Lockfile: `pnpm install --frozen-lockfile` (`verify:lock`) — **OK**; `package.json` alineado al lockfile.
- Recipes: `pnpm audit:recipes` — **PASS** (manifest regenerado con el SHA actual de `package.json`).
- Rutas: `pnpm audit:routes` — **0 findings** (nueva ruta `api/isabella-voice` endurecida: auth soberana, rate-limit, Zod, sanitización, headers seguros).
- `pnpm production:gate` — **PASS** (`scripts/production-integrity-gate.mjs`).
- `pnpm security:scan` — **0 errores ESLint + 0 secretos hardcodeados** (14 warnings de regex preexistentes, no bloqueantes).
- Phantoms de scripts eliminados (`release:verify`, `schema:check`, `seed:db`, `version:sync`); `security:scan` y `production:gate` ahora apuntan a gates reales.
- `selectRemoteProviders` implementado en `src/lib/intelligence/transports/registry.ts`.

### 🔴 Pendiente / no verificable desde local
- CI en GitHub (billing) y estado **remoto** de 6 PRs de dependabot + 2 PRs críticos (#455, #449): requieren verificación remota.
- 7 branches `repair/*` a limpiar tras merge (remoto).
- `pnpm lint` (repo completo) excede 15 min en este entorno; el conjunto de código cambiado fue lint-verificado con **0 errores**.

### 🟡 En cola (hoja de ruta)
- Fase B: librerías nativas de Verificación/Certificación interconectadas con **Hypercore** (`src/lib/acceleration`) y **ML nativo** (`native-ml`, `intelligence`, `claim-radar`, `ncua`) — especificación lista en `docs/science-integrity/10-integracion-hypercore-ml-nativo.md`.
- Módulos documentales pendientes de recibir: cronograma/costos CSV, scripts/Dockerfile reproducibles y archivos exportables.

---

## Funciones principales — estado verificado (A)

### Conversación e inferencia
- Chat SSE con dos rutas API protegidas
- Selección multi-proveedor (groq, gemini, xai, AI Gateway) con fallback
- Normalización de SSE Gemini ↔ OpenAI
- Gate de salida aplicado al stream

### Gobernanza y autorización
- Policy engine versionado con decisiones allow/deny
- RBAC, ABAC, capability tokens, aislamiento tenant
- Validación Zod sin `process.env` directo fuera de config
- Kill-switch y audit trail

### Seguridad
- `SecuritySystem`: sanitización, rate limiting distribuido, allowlist egress, circuit breaker
- SSRF deny (CIDR, loopback, IMDS)
- Output gate `ALLOW/FLAG/DENY` con cancelación de upstream
- Firewall de inyección, detección de PII, escaneo de secretos

### Memoria y evidencia
- BookPI: ledger append-only con hash-chain integrity
- Scopes jerárquicos, consentimiento, expiración
- IGDS: procedencia y sellos
- Decision ledger: auditable cuando existe `DATABASE_URL`

### Skills y herramientas
- Registro en ejecución con 50+ skills gobernados
- Bridge y executor con validación de contrato
- 5 herramientas ejecutables en `tools-catalog.ts`
- 28 descriptores de política en `tool-registry.ts`

---

## Isabella Hypercore — aceleración adaptativa gobernada

**Isabella Hypercore** es la capa de aceleración adaptativa (analogía: el _Tsuru_ con turbos). El
núcleo ordinario y resistente —CROWN, autorización, policy-as-code, evidencia y output-security—
permanece como **autoridad final**; los turbos reducen latencia sin comprar velocidad a costa de
seguridad.

> **Invariante:** ningún turbo ni nitro concede autoridad. El `mandatoryGate`
> (policy + evidence + safety) se ejecuta **siempre**. Un timeout, error o resultado malformado de
> un rail obligatorio equivale a **DENY**, nunca a **ALLOW**.

### Tres turbos, seis nitros

| Turbo           | Nitro               | Función                                                                          |
| --------------- | ------------------- | -------------------------------------------------------------------------------- |
| **VECTOR**      | `PREFIX_CACHE`      | Reutilizar cómputo de prefijos estables (sistema, política, contexto).            |
| **VECTOR**      | `SEMANTIC_CACHE`    | Reutilizar resultados validados bajo la misma huella de política.                 |
| **SPECULATIVE** | `DRAFT_MODEL`       | Candidatos económicos que nunca son respuesta final sin verificación.             |
| **SPECULATIVE** | `PARALLEL_BRANCHES` | Probar varios candidatos/rutas en paralelo.                                       |
| **VERITAS**     | `VERIFIER_FANOUT`   | Comprobaciones independientes en paralelo (obligatorio).                          |
| **VERITAS**     | `EARLY_EXIT`        | Reducir verificaciones redundantes; **prohibido** en riesgo elevado.              |

### Modos

`CRUISE` (presupuesto sano) → `BOOST` (presión de latencia o complejidad) → `HYPERBOOST`
(presupuesto crítico). Los modos alteran estrategia y presupuestos, **nunca** eliminan el gate.

### Superficie y artefactos

| Ruta / artefacto                          | Rol                                                            |
| ----------------------------------------- | ------------------------------------------------------------- |
| `GET /api/v1/isabella/hypercore`          | Metadatos (turbos, nitros, invariantes).                       |
| `POST /api/v1/isabella/hypercore/decide`  | Decisión del plano de aceleración (sin efectos secundarios).   |
| `POST /api/v1/isabella/hypercore/run`     | Ejecución gobernada (requiere adaptadores productivos).        |
| `src/lib/acceleration/hypercore.ts`       | Motor unificado (decisión + pipeline + caché + telemetría).    |
| `src/lib/acceleration/hypercore-routes.ts`| Superficie Express.                                            |
| `src/routes/api/v1/isabella-hypercore.ts` | Superficie TanStack/Nitro.                                     |
| `hypercore-runtime/`                      | Runtime de referencia ejecutable (Node nativo) + `node --test`.|
| `docs/acceleration/`                      | Arquitectura, protocolo, OpenAPI y manifiesto.                |
| `test/unit/acceleration/hypercore.test.ts`| Pruebas del motor y de los invariantes.                        |

### Estado

- **(A)\*** Motor, superficies HTTP y runtime de referencia: implementado, cableado y con tests
  (10 vitest + 10 `node --test` verdes en local, 2026-10-06).
- **(EXPERIMENTAL)** `/run` responde `503` (fail-closed) en producción hasta cablear adaptadores
  reales (modelo, memoria, política, evidencia, output-security). El adaptador incluido es
  determinista y **no** es el modelo real de Isabella.
- Aprender de un resultado no lo convierte en verdad: la caché no concede autorización y solo
  cachea riesgo bajo tras aprobar el gate.

Detalle completo en [`docs/acceleration/README.md`](docs/acceleration/README.md).

---

## Verificación y Certificación de Integridad Científica (pilar nuevo)

Isabella filtra, verifica, certifica y blinda la veracidad, viabilidad y respaldo de la información científica y
técnica con trazabilidad criptográfica, gobernanza de datos, revisión humana y auditoría externa.

> **Honestidad:** pilar **PLAN/DOC**. No existe certificación ni sello en producción. Los contratos OpenAPI, plantillas
> legales y playbooks son documentación integrada (`docs/08-…`), no capacidad verificada (escala de `AGENTS.md` §0.1).

| Artefacto | Ruta |
| --- | --- |
| Índice y registro de entregas del paquete | `docs/science-integrity/00-INDICE.md` |
| Contrato OpenAPI v2 ampliado (corregido C1–C4) | `docs/science-integrity/artifacts/openapi.yaml` |
| Plantillas legales (TOS, DPA, DUA, Contrato Revisor, Anexos) | `docs/science-integrity/artifacts/legal/` |
| Puente de integración Hypercore + ML nativo (Fase B) | `docs/science-integrity/10-integracion-hypercore-ml-nativo.md` |

---

## Roadmap verificable

### Corto plazo (próximas 2 semanas)
- [x] Ejecutar `pnpm production:gate` full locally — **PASS** (2026-10-07)
- [ ] Mergear PRs dependabot en orden (#473 → #474 → #475 → #476 → #477 → #472) — verificación remota
- [ ] Verificar gates verdes en #455 y #449 — verificación remota
- [ ] Limpiar branches `repair/*` post-merge
- [ ] Integrar módulos de documentación restantes (cronograma/costos CSV, scripts Dockerfile reproducibles, exportables) → `docs/science-integrity/00-INDICE.md` §8
- [ ] **Fase B:** librerías nativas de Verificación/Certificación interconectadas con Hypercore y ML nativo (B0–B2 de `docs/science-integrity/10-…`)

### Mediano plazo (próximo mes)
- [ ] Activar CI en GitHub Actions (resolver billing)
- [ ] SBOM verificado en cada release
- [ ] Attestations SLSA L3 en todos los artefactos
- [ ] ADR para branch protection policy
- [ ] Primer piloto de sellos de verificación (beta cerrada, 100–200 contenidos)

### Largo plazo
- [ ] Auditoría externa de seguridad
- [ ] Certificación de gobernanza de IA
- [ ] Despliegue multi-región con replicación de ledger
- [ ] Acreditación Nivel 4 (auditoría externa del pilar de Integridad Científica)

---

## Licencia y gobernanza

- **Código:** Apache License 2.0 (ver `LICENSE-CONTROL.md`)
- **Documentación:** CC BY 4.0
- **Gobernanza:** FGAIS Governance Charter en `docs/governance/`
- **Contribución:** Ver `CONTRIBUTING.md`

---

## Contacto y reportes de seguridad

- **Propietario:** @OsoPanda1
- **Reportes de seguridad:** GitHub Security Advisories (private)
- **General:** Issues con label `[question]` o `[discussion]`

---

**Última auditoría:** 2026-10-07 | **Estado:** Gates locales verdes (blindaMax) | **Certificación:** NO (es código en evolución, no producto certificado)
