# Isabella Villaseñor AI — TINA

**Trusted Intelligence, Native & Adaptive** — arquitectura de inteligencia artificial gobernada, federada y auditable del ecosistema **TAMV Online Network** (RDM Digital Hub · Nodo Cero · Real del Monte, Hidalgo, México).

- Versión del proyecto (`package.json`): **4.3.3**
- Versión de este documento: **5.0.0** — fecha **2026-10-05**
- Medición de gates y métricas: **2026-10-05**, en local (ver [Estado y avance a producción](#estado-y-avance-a-producción))

> **Regla de honestidad** (heredada de `AGENTS.md`): _código existente ≠ capacidad verificada; un test local ≠ producción; build verde ≠ certificación_. Ninguna sección de este documento afirma una capacidad que no esté cableada y comprobable.

| Estado    | Significado                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **(A)**   | Implementado **y** cableado a un punto de entrada, con tests.                                                                             |
| **(A)\*** | Implementado y cableado a un punto de entrada, **sin tests unitarios propios** (cobertura solo indirecta).                                |
| **(B)**   | Implementado y con tests, pero **sin consumidor**: superficie no expuesta, código muerto o pendiente de cableado.                         |
| **(C)**   | Solo documentado, o **no existe**. El código presente con 0 importadores y sin suite propia se marca **(C)** y se rotula "código muerto". |

---

## Introducción

**Isabella Villaseñor AI** es una capa de orquestación cognitiva gobernada: coordina modelos de inferencia externos, memoria, identidad, políticas, herramientas, evidencia y auditoría dentro de fronteras explícitas. No es un modelo propio; es la arquitectura que decide qué puede hacer un modelo, con qué datos y bajo qué autoridad.

**Qué es:**

- una plataforma de orquestación con gobernanza de políticas y autorización server-side;
- un gateway conversacional con streaming SSE, salida gobernada y trazabilidad;
- un registro de skills y herramientas ejecutables bajo contrato;
- un laboratorio de investigación aplicada en seguridad de agentes, procedencia y soberanía digital;
- una infraestructura multi-tenant con aislamiento por tenant, RBAC/ABAC y evidencia de decisiones.

**Qué NO es** (declarado también en `AGENTS.md` §1.2):

- no es AGI, ni consciencia artificial, ni persona ni sujeto jurídico;
- no es una certificación de producción, ni una acreditación jurídica, financiera, académica o regulatoria;
- no es una garantía de neutralidad, exactitud o seguridad absoluta;
- no es un único LLM ni una autoridad autónoma sobre seres humanos.

Principio rector citable de `AGENTS.md`:

> _Las inteligencias sugieren, calculan y evalúan; el humano decide, aprueba y ejecuta._

y su frontera correspondiente:

```text
CAPABILITY ≠ AUTHORITY ≠ EXECUTION ≠ EVIDENCE ≠ LEARNING ≠ PRODUCTION
```

---

## ¿Qué problema resuelve?

Cuando un sistema de IA deja de ser solo conversacional y empieza a tocar **memoria privada, herramientas, servicios externos, dinero y decisiones**, el modelo tiende a ocupar a la vez cinco roles: genera la respuesta, decide, ejecuta, recuerda y certifica lo que ocurrió. Ese solapamiento es el fallo de diseño que Isabella separa en capas gobernadas.

Problemas concretos que aborda:

- **Autoridad difusa:** el modelo no debe poder autorizar sus propias herramientas ni sus propias acciones.
- **Egress incontrolado:** toda llamada saliente debe pasar por allowlist, bloqueo de SSRF y circuit breaker.
- **Salida no inspeccionada:** lo que el modelo produce debe ser escaneado antes de salir, incluso en streaming.
- **Memoria sin frontera:** recuperación por scopes, tenant, consentimiento y procedencia.
- **Evidencia frágil:** las decisiones necesitan hash, cadena de integridad y registro append-only.
- **Claims inflados:** implementar algo no equivale a tenerlo certificado; hace falta distinguir estados.

### Diagrama conceptual de capas

```text
   Cliente (navegador · API · terminal)
            |
            v
 [1] Rutas de entrada ........ src/routes/api/*.ts (TanStack) · server.ts (Express)
            |
 [2] Identidad y tenancy ..... withSovereignAuth -> principal-context -> RBAC/ABAC
            |
 [3] Límites de entrada ...... rate limit · validación Zod · sanitización · anti inyección
            |
 [4] Policy / gobernanza ..... policy engine · capability tokens · CROWN / ARGUS
            |
 [5] Memoria y contexto ...... scopes · consentimiento · procedencia · hashes
            |
 [6] Skills y herramientas ... getRuntimeSkill · executeTool (catálogo ejecutable)
            |
 [7] Inferencia .............. groq -> gemini -> xai -> ai-gateway (fetchSafeUpstream)
            |
 [8] Output gate (SSE) ....... ALLOW / FLAG / DENY (+ cancelación del upstream ante DENY)
            |
 [9] Auditoría y evidencia ... audit-tracer · decision ledger · BookPI · observabilidad
            |
            v
        Respuesta SSE + trazas auditable
```

---

## ¿Qué es técnicamente y categoría del proyecto

### Qué es técnicamente

Una aplicación **TypeScript full-stack** con dos superficies de entrada que comparten el mismo núcleo:

- **Superficie web/API moderna:** TanStack Start (file-routes) compilada con Vite 8 y servida por Nitro.
- **Superficie legacy/express:** un servidor Express 5 (`server.ts`, ~112 KB) expuesto en Vercel mediante `api/[...path].ts`.

Ambas comparten `src/lib/`: seguridad, memoria, skills, inteligencia, gobernanza y repositorios. La persistencia es PostgreSQL/Neon con Prisma 7, Drizzle y `better-sqlite3` para bolsillos locales; Supabase para migraciones/RLS. La inferencia usa el Vercel AI SDK (`ai` v7) más SDKs de Google y proveedores compatibles.

### Categoría del proyecto

| Nivel                  | Categoría                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Principal              | **Governed AI / Cognitive Orchestration Platform**                                                                             |
| Subcategorías          | AI Governance · Agent Security · Auditable AI · Cognitive Gateway · AI Infrastructure · Evidence & Provenance · Territorial AI |
| Tipo de trabajo        | Investigación aplicada + plataforma experimental + infraestructura modular                                                     |
| Licencia de contenidos | CC BY 4.0 (documentación); el código conserva su licencia propia (ver [Licencias](#licencias))                                 |

No es un producto comercial certificado ni un servicio en producción declarado como tal; es un repositorio de ingeniería con gates locales verdes y bloqueos externos documentados.

---

## Cómo funciona

Pipeline real de una petición de chat, con la ruta de archivo verificada:

1. **Entrada.** `POST /api/isabella` y `POST /api/v1/isabella` (file-routes `src/routes/api/isabella.ts` y `src/routes/api/v1/isabella.ts`) o rutas Express bajo `server.ts`. Ambas superficies comparten `api/[...path].ts` como adaptador de Vercel.
2. **Autenticación.** El handler se envuelve con `withSovereignAuth("chat", "execute", ...)` (`src/lib/principal-context.ts`): identidad, tenant, scopes y roles se resuelven server-side antes de entrar en el handler.
3. **Policy, cuota y sanitización.** `SecuritySystem.checkRateLimitDistributed` (`src/lib/security.ts`), sanitización de payload, límites de tamaño (`parseSafeJsonBody`) y guardas de prompt injection.
4. **Skills.** `handleIsabellaChat` (`src/lib/isabella-chat-gateway.ts`) llama a `executeConversationalSkill` (`src/lib/isabella-skill-executor.ts`), que resuelve el runtime con `getRuntimeSkill` sobre `isabellaSkills` (`src/lib/skills/registry.ts`). Si hay skill activa, la respuesta se emite como SSE y pasa inmediatamente por el output gate.
5. **Inferencia.** Cadena de proveedores **groq → gemini → xai → ai-gateway**, con `assertIntelligenceRuntimeAuthority` y cada llamada saliente atravesando `SecuritySystem.fetchSafeUpstream` (allowlist de hosts, `redirect: "error"`, circuit breaker) precedido por `isSsrfDeniedHost` (`src/lib/security/ssrf-deny.ts`).
6. **Output gate sobre SSE.** `createOutputGateTracker`, `gateOpenAiSseStream` y `outputGateRefusalFrame` inspeccionan el stream incrementalmente: veredicto `ALLOW / FLAG / DENY`; ante `DENY` se enquadra un frame de rechazo y se **cancela el upstream**.
7. **Auditoría y evidencia.** `AutoAuditingSystem.auditExecutionFlow`, ledger de decisiones (Postgres, fail-closed si no hay `DATABASE_URL`) y `ObservabilityService` + `recordObservabilityEvent` para latencia y resultado por proveedor. Las operaciones económicas y de gobernanza persisten en BookPI (`src/lib/repositories/bookpi-postgres-repository.ts`).
8. **Fallback y degradación.** Sin claves de proveedor configuradas existe respuesta soberana local degradada (`generateSovereignLocalResponse`), siempre con las mismas cabeceras de seguridad.

---

## Funciones principales

### Conversación e inferencia

- Chat SSE con dos rutas de API (`/api/isabella`, `/api/v1/isabella`) protegidas por `withSovereignAuth`.
- Selección y fallback multi-proveedor (groq, gemini, xai, AI Gateway) bajo autoridad de runtime.
- Normalización de SSE de Gemini a formato OpenAI-compatible (`geminiSseToOpenAi`).
- Ejecución de skills conversacionales dentro del mismo stream, con gate de salida aplicado al stream de skills.
- Respuesta local degradada cuando no hay proveedor disponible.

### Gobernanza y autorización

- Policy engine versionado (`src/lib/policy-engine.ts`) con decisiones `allow/deny` y obligaciones.
- RBAC (`src/lib/rbac.ts`), ABAC (`src/lib/abac.ts`), matriz de permisos y autorización (`src/lib/authorization.ts`).
- Capability tokens y aislamiento de tenant (`src/lib/tenant-guard.ts`, tests en `test/unit/capability-tokens.test.ts` y `test/security/capability-token.test.ts`).
- Revisión humana (`src/lib/governance/human-approval`), kill-switch y registro de cambios (`src/lib/governance/change.ts`).
- Validación de entorno con Zod (`src/lib/env-schema.ts`), sin `process.env` directo fuera de la configuración.

### Seguridad

- `SecuritySystem` (`src/lib/security.ts`): sanitización, rate limiting distribuido, allowlist de egress, circuit breaker, cabeceras de seguridad y redacción de secretos.
- Bloqueo SSRF previo a la allowlist: deny CIDR, loopback e IMDS (`src/lib/security/ssrf-deny.ts`, `test/security/ssrf-deny.test.ts`).
- Veto de credenciales en el sandbox: `src/lib/security/credential-env.ts` usado por `src/lib/sovereign-sandbox.ts` (`test/security/sandbox-credential-isolation.test.ts`).
- Output gate `ALLOW/FLAG/DENY` con cancelación de upstream ante DENY, también en `test/security/output-gate.test.ts` y `test/unit/output-security-gate.test.ts`.
- Firewall de inyección, detección de PII en egress, escaneo de secretos (`scripts/secret-scan.mjs`) y SAST con `eslint-plugin-security`.

### Memoria, evidencia y procedencia

- Memoria jerárquica con scopes, tenant, consentimiento, expiración y hash de contenido (`src/lib/memory-engine.ts`, repositorios asociados).
- BookPI: ledger append-only de eventos con hashes encadenados y outbox de auditoría.
- IGDS: sellos y procedencia (`src/lib/igds/`), con consumidor en `src/lib/repositories/memory-repository.ts`.
- Decision ledger de decisiones firmadas, activo cuando existe `DATABASE_URL`.
- NCUA: taxonomía epistémica E0–E4 consumida por `src/lib/native-comprehension.ts` y `src/server-routes/api/ncua-load.ts`.

### Skills y herramientas

- Registro de skills en ejecución (`src/lib/skills/registry.ts`) con familias por dominio y packs especializados.
- Bridge y executor gobernados (`src/lib/skills/skill-bridge.ts`, `src/lib/isabella-skill-executor.ts`) con validación de `SkillResult` y telemetría.
- Catálogo ejecutable de herramientas (`src/domains/ai/infrastructure/tools-catalog.ts`) con dispatch autorizado (`src/core/runtime/tool-dispatch.ts`).
- Catálogo descriptor de herramientas (`src/lib/tool-registry.ts`) para permisos, riesgo y política (sin ejecutor propio).

### Inteligencia y ML nativo

- Transports de proveedor (anthropic, bedrock con AWS SigV4, responses, openai-compatible) con tests, aún sin call sites.
- MoE: `native-moe`, `tri-hepta`, `moe-unified` y `moe-engine` (45 tests); el router vive dentro de `invokeIntelligence`, sin call sites.
- ML clásico determinista: clasificación, regresión, clustering, drift y clasificador de riesgo de texto (`src/lib/native-ml/`).
- Fusionado nativo de skills (`createNativeFusedSkill`) aplicado al pack evolucionado.

### Datos, persistencia e interfaz

- PostgreSQL/Neon (pg + `@neondatabase/serverless`), Prisma 7, Drizzle, `better-sqlite3`; 10 migraciones en `supabase/migrations/`.
- Interfaz React 19 + Tailwind 4 + Radix + Framer Motion + Three.js + Recharts; dashboards de gobernanza, memoria, seguridad y trazabilidad.
- Rutas nuevas: `src/routes/ops/cockpit.tsx` y `src/routes/pake.tsx` **(A)\***: existen y compilan, sin test.
- Economía: Stripe SDK, ledger y settlement con controles adicionales (varios condicionados a configuración real; ver §11).

### Auditoría, gates y operación

- 50 scripts npm en `package.json`, de los cuales 16 se encadenan en `pnpm production:gate`.
- 44 scripts en `scripts/`: auditorías de imports, arquitectura, rutas, documentos y recetas, secretos, contrato de lockfile, preflight e integridad de producción, SBOM, backups y migraciones.
- 18 workflows de GitHub Actions (ci, fgais-gate, sast, secret-scan, security, dast-staging, release, deploy-production, supabase, dependabot, entre otros).
- Verificación de supply chain: `verify:lock`, `sbom`, `sbom:verify`, `k8s:image:pin`, `secret-scan`.
- Operación de datos: `db:backup`, `db:restore`, `db:verify`, `db:neon:preflight`, `db:migrate`.
- Evidencia NCUA: `ncua:benchmark`, `ncua:load`, `ncua:live` (carga y evidencia en vivo).

---

## Herramientas (tools)

Hay **tres catálogos distintos** y no son intercambiables. Confundirlos es el error documental más fácil de cometer en este repositorio.

### Catálogo 1 — `src/lib/tool-registry.ts` (`TOOL_REGISTRY_SEED`, 28 entradas) — **(B)**

`RegisteredTool` **no tiene campo `execute`**: son descriptores de política (propósito, riesgo, permisos, timeouts, aprobación humana, frontera territorial). Se consumen desde capas de política (`policy-engine`, `execution-authority`, `capability-registry`, `db-policy-gate`, `platform-capabilities`, `orion-engine`, `sovereign-pipeline`) y desde `src/lib/mcp-server/`, pero **no existe un ejecutor en el registro**.

|   # | Herramienta                     | Propósito declarado                                                          | Estado |
| --: | ------------------------------- | ---------------------------------------------------------------------------- | ------ |
|   1 | `memory.retrieve`               | Recuperar contexto de memoria dentro del scope y tenant autorizados.         | (B)    |
|   2 | `memory.record`                 | Persistir una pieza de memoria con consentimiento y procedencia.             | (B)    |
|   3 | `ledger.record`                 | Registrar un asiento inmutable en el libro mayor BookPI.                     | (B)    |
|   4 | `compute.sandbox`               | Ejecutar tarea aislada en contenedor/WASM bajo sandbox soberano.             | (B)    |
|   5 | `storage.read`                  | Leer datos de repositorio autorizado dentro de la frontera de tenant.        | (B)    |
|   6 | `identity.resolve`              | Resolver identidad, roles y scopes de un principal en el servidor.           | (B)    |
|   7 | `firecrawl.market_research`     | Investigación de mercado, tamaño de oportunidad y vectores de competencia.   | (B)    |
|   8 | `firecrawl.monitor`             | Monitoreo continuo de cambios web y diffing semántico de DOM.                | (B)    |
|   9 | `ckm.brand`                     | Arquitectura de identidad de marca, contraste WCAG AAA y guía de tono.       | (B)    |
|  10 | `ckm.banner_design`             | Banners multiformato (16:9, 1:1, 9:16) con márgenes y balance visual.        | (B)    |
|  11 | `tavily.search`                 | Búsqueda web fáctica optimizada para LLM con filtrado de granjas de spam.    | (B)    |
|  12 | `ckm.slides`                    | Diapositivas ejecutivas con arquetipos canónicos de presentación.            | (B)    |
|  13 | `flutter.add_widget_test`       | Generación de pruebas unitarias de widgets Flutter con `WidgetTester`.       | (B)    |
|  14 | `browser.testing_with_devtools` | Auditoría de Core Web Vitals, accesibilidad axe-core y consola.              | (B)    |
|  15 | `firecrawl.seo_audit`           | Auditoría SEO técnica: OpenGraph, JSON-LD schema y jerarquía de títulos.     | (B)    |
|  16 | `baoyu.infographic`             | Desglose visual de conocimiento en infografías conceptuales.                 | (B)    |
|  17 | `firecrawl.knowledge_base`      | Rastreo de documentación técnica y particionamiento semántico para RAG.      | (B)    |
|  18 | `cicd.automation`               | Pipelines CI/CD con análisis SAST y verificación de compuertas.              | (B)    |
|  19 | `firecrawl.workflows`           | Orquestación de flujos de extracción web multiciclo y webhooks.              | (B)    |
|  20 | `baoyu.markdown_to_html`        | Markdown a HTML semántico con sanitización frente a inyección XSS.           | (B)    |
|  21 | `firecrawl.dashboard_reporting` | Tableros ejecutivos a partir de métricas web extraídas.                      | (B)    |
|  22 | `swiftui.expert_skill`          | Desarrollo y optimización en SwiftUI moderno (macro `@Observable`, Swift 6). | (B)    |
|  23 | `source_driven.development`     | Desarrollo guiado por especificación: contratos y prevención de deriva.      | (B)    |
|  24 | `firecrawl.lead_gen`            | Descubrimiento de oportunidades B2B y prospección bajo normas éticas.        | (B)    |
|  25 | `shipping.launch`               | Checklist de preparación de despliegue a producción y reversión.             | (B)    |
|  26 | `firecrawl.lead_research`       | Dossier sobre organizaciones objetivo: tecnología, directivos y propuesta.   | (B)    |
|  27 | `flutter.add_integration_test`  | Pruebas de integración extremo a extremo para Flutter.                       | (B)    |
|  28 | `firecrawl.competitive_intel`   | Monitoreo de competidores y matrices de paridad de características.          | (B)    |

### Catálogo 2 — `src/domains/ai/infrastructure/tools-catalog.ts` (5 herramientas ejecutables) — **(A)\***

Único catálogo con `executeTool()` real. Cadena: `executeTool()` ← `src/core/runtime/tool-dispatch.ts` (`authorizeToolCall`) ← orchestrator/gateway, y también `src/lib/sovereign-engine.ts` + `processPerception` ← **`server.ts` (entrada Express/Vercel)**, que importa `REGISTERED_TOOLS` y `executeTool` directamente.

| Herramienta                 | Función                                                                                                  | Estado |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| `rdm_territory_query`       | Consulta entidades territoriales, puntos de interés y servicios turísticos/culturales de Real del Monte. | (A)\*  |
| `isabella_synthesize_voice` | Sintetiza modulación vocal femenina con parámetros de tono, ritmo y timbre.                              | (A)\*  |
| `crown_cognitive_arbitrate` | Ejecuta un ciclo de arbitraje de pesos y balanceo de carga entre ISA, SOPHIA, ORION y ARGUS.             | (A)\*  |
| `argus_security_audit`      | Inspecciona la integridad del contexto y genera hash de verificación criptográfica.                      | (A)\*  |
| `sovereign_ledger_commit`   | Registra un bloque de decisión inmutable en el registro de gobernanza comunitaria.                       | (A)\*  |

**(A)\*** = cableado a `server.ts` pero **sin suite unitaria propia**: `test/` no contiene tests que ejerciten estas cinco herramientas; solo aparecen referenciadas en la lista de rutas de `test/unit/env-contract.test.ts`.

### Catálogo 3 — `src/lib/mcp-server/tools.ts` (`buildMcpToolList()`) — **(B)**

Deriva la lista MCP del catálogo 1 (mismos 28 descriptores, expuestos como tools MCP con policy y capability tokens). Tres suites (`test/unit/mcp-server/{policy,protocol,tools}.test.ts`, **40 tests**) y **sin punto de entrada**: `src/lib/mcp-server/` no tiene consumidores fuera de su propio barrel ni bin/CLI registrado.

---

## Skills

Las skills son la superficie **cableada y ejecutable** del repositorio.

**Cadena verificada:** `src/routes/api/isabella.ts` / `src/routes/api/v1/isabella.ts` → `handleIsabellaChat` (`src/lib/isabella-chat-gateway.ts`) → `executeConversationalSkill` → `src/lib/isabella-skill-executor.ts` → `getRuntimeSkill` (`src/lib/skills/registry.ts`).

**Contratos:** `src/lib/skills/contracts.ts` (`IsabellaSkill`, `SkillContext`, `SkillResult`, `FederationId`, `SkillRisk`).

**Estado de la familia de skills: (A).** Todos los packs listados están importados por `registry.ts`. La cobertura de tests es desigual: existen suites para el bridge y el executor (`chat-skill-bridge`, `isabella-skill-executor`), la categoría TINA (`tina-category`, 25 tests) y la unificación de OsoPanda (`osopanda-skills-unification`), pero no hay una suite por familia.

### Familia core (`core-pack.ts`)

| Skill    | Función                                                                                   | Estado |
| -------- | ----------------------------------------------------------------------------------------- | ------ |
| `ORION`  | Recupera artefactos, reconstruye relaciones y detecta vacíos de memoria.                  | (A)    |
| `SOPHIA` | Construye síntesis verificables distinguiendo evidencia de hipótesis y detectando vacíos. | (A)    |
| `ARGUS`  | Detecta anomalías, degradación operativa, abuso y riesgos de infraestructura.             | (A)    |
| `HERMES` | Traduce información compleja en mensajes claros, responsables y contextuales.             | (A)    |
| `ATLAS`  | Simula impactos territoriales y detecta puntos de palanca para decisiones responsables.   | (A)    |
| `ANUBIS` | Verifica integridad, procedencia y trazabilidad de artefactos críticos.                   | (A)    |
| `GEMET`  | Evalúa decisiones contra principios de dignidad, consentimiento, equidad y soberanía.     | (A)    |

### Familia territorial (`territorial-pack.ts`)

| Skill       | Función                                                                                          | Estado |
| ----------- | ------------------------------------------------------------------------------------------------ | ------ |
| `AURORA`    | Orienta a usuarios dentro de RDM Digital con recomendaciones contextuales.                       | (A)    |
| `GAIA`      | Evalúa sostenibilidad integral de iniciativas con enfoque territorial y cultural.                | (A)    |
| `NODO_CERO` | Gestiona etapas, dependencias y acciones de iniciativas vinculadas al Nodo Cero.                 | (A)    |
| `PHAROS`    | Recomienda experiencias territoriales con criterios culturales, comunitarios y de accesibilidad. | (A)    |

### Familia infraestructura (`infrastructure-pack.ts`)

| Skill        | Función                                                                               | Estado |
| ------------ | ------------------------------------------------------------------------------------- | ------ |
| `CITEMESH`   | Evalúa salud federada, detecta particiones y propone acciones de resiliencia.         | (A)    |
| `HEPHAESTUS` | Deriva artefactos técnicos y criterios de aceptación desde requerimientos gobernados. | (A)    |

### Familia archivo (`archive-pack.ts`)

| Skill       | Función                                                                                 | Estado |
| ----------- | --------------------------------------------------------------------------------------- | ------ |
| `MNEMOSYNE` | Indexa, resume, etiqueta y versiona artefactos para la memoria del ecosistema.          | (A)    |
| `CHRONOS`   | Ordena eventos, preserva trazabilidad temporal y señala inconsistencias cronológicas.   | (A)    |
| `PROMETEO`  | Convierte documentos y repositorios en blueprints, contratos y unidades implementables. | (A)    |

### Familia ética (`ethics-pack.ts`)

| Skill    | Función                                                                               | Estado |
| -------- | ------------------------------------------------------------------------------------- | ------ |
| `VIGIA`  | Aplica protección ontológica, semántica y conductual a las interacciones.             | (A)    |
| `LYRA`   | Evalúa coherencia estética, respeto cultural, accesibilidad y calidad de experiencia. | (A)    |
| `EIRENE` | Facilita diálogo básico y deriva situaciones de riesgo hacia atención humana.         | (A)    |

### Familia soberanía (`sovereignty-pack.ts`)

| Skill      | Función                                                                                 | Estado |
| ---------- | --------------------------------------------------------------------------------------- | ------ |
| `THEMIS`   | Genera expedientes explicables de decisiones, evidencia y rutas de auditoría.           | (A)    |
| `SENTINEL` | Detecta abuso de interacción y recomienda control de tasa o bloqueo temporal auditable. | (A)    |

### Familias economía y educación

| Skill    | Archivo             | Función                                                                                  | Estado |
| -------- | ------------------- | ---------------------------------------------------------------------------------------- | ------ |
| `HELIOS` | `economy-pack.ts`   | Identifica tendencias, señales sistémicas y puntos de atención en series métricas.       | (A)    |
| `KAIROS` | `economy-pack.ts`   | Prioriza iniciativas por impacto, urgencia, riesgo y viabilidad con métricas explícitas. | (A)    |
| `UTAMV`  | `education-pack.ts` | Diseña rutas de aprendizaje y proyectos aplicados con evidencia de competencia.          | (A)    |

### Orquestación y categoría

| Skill                    | Archivo            | Función                                                                    | Estado |
| ------------------------ | ------------------ | -------------------------------------------------------------------------- | ------ |
| `HEPTA`                  | `hepta.skill.ts`   | Identifica la federación dominante y compone planes cognitivos gobernados. | (A)    |
| `TINA_CATEGORY` (`TINA`) | `tina-category.ts` | Expone la categoría canónica TINA de Isabella; suite propia de 25 tests.   | (A)    |

### Ecosistema OsoPanda (`osopanda-ecosystem-pack.ts`, 6 skills)

| Skill                     | Función                                                                                                                                                                                     | Estado |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `NODO_CERO_TWIN`          | Motor del Gemelo Digital Territorial de Real del Monte: telemetría, minas históricas, rutas patrimoniales y monitoreo ambiental. Marca `SIMULATED_TELEMETRY` hasta conectar fuentes reales. | (A)    |
| `RDM_SOVEREIGN_COMMERCE`  | Denominación de origen y comercio justo para artesanos, pastelerías y prestadores turísticos de Real del Monte.                                                                             | (A)    |
| `RDM_COMMUNITY_ASSEMBLY`  | Deliberación cívica, asamblea digital comunitaria y presupuestos participativos.                                                                                                            | (A)    |
| `FAST_PARALLEL_INGEST`    | Ingesta y descarga segmentada en paralelo para datasets territoriales masivos.                                                                                                              | (A)    |
| `QSTASH_EVENT_DISPATCHER` | Enrutador de eventos asíncronos entre nodos cognitivos y servicios satélite de TAMV.                                                                                                        | (A)    |
| `DOCS_INSTANT_SEARCH`     | Búsqueda instantánea indexada y semántica sobre la documentación canónica.                                                                                                                  | (A)    |

### Pack evolucionado (`evolved-skills-pack.ts`, 22 skills) — **(A)**

Re-registrados en `registry.ts` con fuse nativo (`createNativeFusedSkill`). Cada uno expone un `run()` determinista.

| Skill                           | Función                                                                            | Estado |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| `firecrawl-market-research`     | Investigación profunda de mercado y síntesis de inteligencia web.                  | (A)    |
| `firecrawl-monitor`             | Monitoreo de cambios web, diffing semántico de DOM y alertas de deriva.            | (A)    |
| `ckm-brand`                     | Identidad de marca, escala tipográfica y balance cromático contrastado.            | (A)    |
| `ckm-banner-design`             | Banners de alto impacto en 16:9, 1:1, 4:5 y 9:16.                                  | (A)    |
| `tavily-search`                 | Búsqueda web fáctica con filtrado de granjas SEO y reordenamiento de evidencias.   | (A)    |
| `ckm-slides`                    | Diapositivas ejecutivas con arquetipos Problema/Solución/Arquitectura/Tracción.    | (A)    |
| `flutter-add-widget-test`       | Pruebas de widgets Flutter con `WidgetTester` y aserciones semánticas.             | (A)    |
| `browser-testing-with-devtools` | Auditoría automatizada de Core Web Vitals, axe-core y errores de consola.          | (A)    |
| `firecrawl-seo-audit`           | Auditoría SEO: metadatos OpenGraph, JSON-LD y jerarquía de títulos.                | (A)    |
| `baoyu-infographic`             | Infografías estructuradas, esquemas SVG y modelos conceptuales.                    | (A)    |
| `firecrawl-knowledge-base`      | Rastreo de documentación, limpieza de markdown y partición semántica para RAG.     | (A)    |
| `ci-cd-and-automation`          | Pipelines CI/CD con análisis SAST y compresión de artefactos.                      | (A)    |
| `firecrawl-workflows`           | Flujos de extracción multiciclo: Crawl → Extract → Validate → Webhook.             | (A)    |
| `baoyu-markdown-to-html`        | Markdown a HTML semántico con soporte matemático y sin XSS.                        | (A)    |
| `firecrawl-dashboard-reporting` | Tableros ejecutivos con tendencias y resúmenes de KPI.                             | (A)    |
| `swiftui-expert-skill`          | SwiftUI experto: macro `@Observable`, concurrencia y `NavigationStack`.            | (A)    |
| `source-driven-development`     | Contratos tipados desde especificación e invariantes para evitar deriva.           | (A)    |
| `firecrawl-lead-gen`            | Descubrimiento B2B con extracción estructurada y calificación ética.               | (A)    |
| `shipping-and-launch`           | Checklist de lanzamiento, verificación de rollback y compuertas de despliegue.     | (A)    |
| `firecrawl-lead-research`       | Dossier de organización: tecnología, modelo de negocio, directivos y propuesta.    | (A)    |
| `flutter-add-integration-test`  | Pruebas de integración extremo a extremo con `integration_test`.                   | (A)    |
| `firecrawl-competitive-intel`   | Monitoreo de competidores: precios, paridad de funciones y contra-posicionamiento. | (A)    |

### Superficies de skills adicionales y código muerto

| Superficie                    | Ruta                                   | Contenido                                                                                                                                                                                                                                      | Estado            |
| ----------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Metadatos/UI de skills        | `src/lib/skill-registry.ts`            | `ISABELLA_SKILLS`, **42 entradas** (id, nombre, carpeta, capacidad, estado). Consumido por `isabella-skill-executor.ts` y por la UI (`RightRails.tsx`). Sin suite propia; cobertura indirecta vía `test/unit/isabella-skill-executor.test.ts`. | (A)\*             |
| Registro "canónico" histórico | `src/core/skills/skill-registry.ts`    | **0 importadores en `src/`** y sin suite. El README anterior lo llamaba "registro canónico": **es falso**.                                                                                                                                     | (C) código muerto |
| Native skills pack            | `src/lib/skills/native-skills-pack.ts` | 14 skills (frontend-design, web-design-guidelines, caveman, prisma-*, y 7 skills de media generados con `mediaSkill`). **0 importadores.**                                                                                                     | (C) código muerto |

---

## Sistemas nativos, protocolos y librerías

| Sistema / protocolo                                                                        | Dónde está                                                                                                                                                                                  | Estado            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Express 5 + Vercel catch-all                                                               | `server.ts`, `api/[...path].ts`                                                                                                                                                             | (A)               |
| TanStack Start file-routes                                                                 | `src/routes/` (8 archivos de ruta)                                                                                                                                                          | (A)               |
| Streaming SSE con output gate                                                              | `src/lib/isabella-chat-gateway.ts`                                                                                                                                                          | (A)               |
| Skills en runtime                                                                          | `src/lib/skills/registry.ts` → executor → gateway                                                                                                                                           | (A)               |
| Herramientas ejecutables                                                                   | `src/domains/ai/infrastructure/tools-catalog.ts` → `server.ts`                                                                                                                              | (A)\*             |
| Descriptor de herramientas (sin ejecutor)                                                  | `src/lib/tool-registry.ts` (28)                                                                                                                                                             | (B)               |
| Lista MCP derivada                                                                         | `src/lib/mcp-server/tools.ts` (40 tests)                                                                                                                                                    | (B)               |
| Servidor MCP stdio a mano (sin SDK)                                                        | `src/lib/mcp-server/` (policy + capability tokens)                                                                                                                                          | (B)               |
| Cliente/servidor LSP por stdio (JSON-RPC 2.0)                                              | `src/lib/lsp/` (7 archivos, 57 tests), **apagado por defecto** (`enabled === true` requerido)                                                                                               | (B)               |
| Pipeline de imágenes con `sharp`                                                           | `src/lib/media/*.server.ts` (40 tests)                                                                                                                                                      | (B)               |
| Ruta de imágenes real                                                                      | `src/server-routes/api/images/generate.ts` (`generateImage` de `ai`)                                                                                                                        | (A)               |
| Fuentes de secretos async (`env`/`command`/`bitwarden`)                                    | `src/lib/secret-sources/` (46 tests, TTL cache, sin cadena de fallback)                                                                                                                     | (B)               |
| API de secretos en uso                                                                     | `src/lib/secrets.ts`                                                                                                                                                                        | (A)               |
| Transports de inteligencia (anthropic, bedrock+SigV4, responses, openai-compatible)        | `src/lib/intelligence/transports/` (169 tests)                                                                                                                                              | (B)               |
| `initializeIntelligencePlane()`                                                            | `src/lib/intelligence/index.ts` — **0 call sites**                                                                                                                                          | (B)               |
| Ruta real de proveedores                                                                   | `src/lib/isabella-chat-gateway.ts` (groq → gemini → xai → ai-gateway)                                                                                                                       | (A)               |
| MoE unificado (contratos, expert registry, policy gate, telemetría)                        | `src/lib/intelligence/moe/` — router dentro de `invokeIntelligence` con 0 call sites; 45 tests MoE en total                                                                                 | (B)               |
| Egress seguro `fetchSafeUpstream`                                                          | `src/lib/security.ts`, usado por el hot path de inferencia                                                                                                                                  | (A)               |
| Denegación SSRF (CIDR/loopback/IMDS)                                                       | `src/lib/security/ssrf-deny.ts` → `src/lib/security.ts` (8 tests)                                                                                                                           | (A)               |
| Veto de credenciales en sandbox                                                            | `src/lib/security/credential-env.ts` → `src/lib/sovereign-sandbox.ts` (7 tests)                                                                                                             | (A)               |
| Policy engine + RBAC/ABAC + capability tokens                                              | `src/lib/policy-engine.ts`, `rbac.ts`, `abac.ts`, `authorization.ts`                                                                                                                        | (A)               |
| Validación de entorno con Zod                                                              | `src/lib/env-schema.ts`                                                                                                                                                                     | (A)               |
| BookPI (ledger append-only)                                                                | `src/lib/repositories/bookpi-postgres-repository.ts` (skills, rutas económicas)                                                                                                             | (A)               |
| IGDS (sellos/procedencia)                                                                  | `src/lib/igds/` → `memory-repository.ts`                                                                                                                                                    | (A)               |
| NCUA (E0–E4)                                                                               | `src/lib/native-comprehension.ts`, `server-routes/api/ncua-load.ts`                                                                                                                         | (A)               |
| Cabeceras de seguridad                                                                     | 8 en `vercel.json` (HSTS, CSP, XFO, XCTO, Referrer-Policy, Permissions-Policy, COOP, CORP) + inyección runtime en `SecuritySystem.injectSecureHeaders`                                      | (A)               |
| Rutas nuevas de UI                                                                         | `src/routes/ops/cockpit.tsx`, `src/routes/pake.tsx` (sin test)                                                                                                                              | (A)\*             |
| Registro de skills histórico                                                               | `src/core/skills/skill-registry.ts` (0 importadores)                                                                                                                                        | (C) código muerto |
| Native skills pack                                                                         | `src/lib/skills/native-skills-pack.ts` (14 skills, 0 importadores)                                                                                                                          | (C) código muerto |
| `ws`, `@modelcontextprotocol/sdk`, playwright, puppeteer, canvas, tree-sitter, WASM propio | **No son dependencias** (`package.json`): el servidor MCP y el LSP están implementados a mano                                                                                               | (C)               |
| SIGJ, "Aguijón Cero", PlantUML/ASTM como subsistemas                                       | **No existen en el repositorio.** Una búsqueda de texto arroja 0 coincidencias sustantivas (solo subcadenas accidentales dentro de un blob base64 y de palabras como `requestsLastMinute`). | (C)               |
| "ANSI codes" como subsistema                                                               | **No existe como subsistema.** Solo hay secuencias de color ANSI en la UI de terminal (`src/components/Terminal*`, estilos CSS), sin módulo ni capa que lo digne.                           | (C)               |

### Cobertura de tests por subsistema nuevo (corrida local del 2026-10-05)

Corrida aislada de `npx vitest run` sobre las suites de los subsistemas introducidos recientemente. Sirve para mostrar qué está probado **dentro** de su directorio; no demuestra que esté cableado.

| Subsistema                                              | Suites |   Tests | Consumidor fuera de su directorio                        | Estado |
| ------------------------------------------------------- | -----: | ------: | -------------------------------------------------------- | ------ |
| `src/lib/lsp/`                                          |      7 |      57 | ninguno (barrel interno)                                 | (B)    |
| `src/lib/mcp-server/`                                   |      3 |      40 | ninguno                                                  | (B)    |
| `src/lib/media/*.server.ts`                             |      4 |      40 | ninguno (la ruta real usa `generateImage` de `ai`)       | (B)    |
| `src/lib/secret-sources/`                               |      2 |      46 | ninguno (la API en uso es `src/lib/secrets.ts`)          | (B)    |
| `src/lib/intelligence/transports/`                      |      7 |     169 | ninguno (`initializeIntelligencePlane()` sin call sites) | (B)    |
| MoE (native-moe + tri-hepta + moe-unified + moe-engine) |      4 |      45 | router sin call sites                                    | (B)    |
| **Total**                                               | **27** | **397** | —                                                        | —      |

---

## Stack y dependencias

84 dependencias y 27 devDependencies (contado en `package.json`, 2026-10-05).

| Capa               | Tecnología                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Runtime            | Node.js 24.x (`engines`), Docker `node:24.11.0-alpine`                                               |
| Package manager    | pnpm 10.34.5 (`packageManager`)                                                                      |
| Framework web      | TanStack Start 1.168.60 + `@tanstack/react-router` 1.170.41 + `@tanstack/router-plugin` 1.168.40     |
| Servidor de build  | Nitro 3.0 beta (`nitro` 3.0.260603-beta)                                                             |
| Bundler / JSX      | Vite 8.3 con OXC                                                                                     |
| Lenguaje           | TypeScript 6.0.3 (`tsc --noEmit` sin errores)                                                        |
| UI                 | React 19.3 · Tailwind CSS 4 · Radix UI · Framer Motion · Three.js · Recharts · Lucide · shadcn-style |
| Backend HTTP       | Express 5 · h3 (adaptador `fromNodeMiddleware`)                                                      |
| Base de datos      | PostgreSQL/Neon (`pg`, `@neondatabase/serverless`) · Supabase · `better-sqlite3`                     |
| ORM / acceso       | Prisma 7 (client generado en `src/generated/prisma`) · Drizzle ORM                                   |
| Cache / rate limit | `@upstash/redis` + `@upstash/ratelimit`                                                              |
| IA                 | Vercel AI SDK `ai` ^7 · `@google/genai` · `@idlen/chat-sdk`                                          |
| Validación         | zod ^3                                                                                               |
| Pagos              | stripe ^22 (sin modo live verificado)                                                                |
| Imagen             | sharp ^0.35.5 (pipeline `src/lib/media/*.server.ts`)                                                 |
| Pruebas            | vitest 5 — 4 proyectos: `unit`, `security`, `bookpi`, `integration`                                  |
| Lint / formato     | ESLint 10 + `typescript-eslint` + `eslint-plugin-security` + Prettier 3                              |
| Despliegue         | Vercel (Nitro preset) · Docker multi-stage · 18 workflows de GitHub Actions                          |

---

## Gobernanza y soberanía digital

### Lo real, con ruta de archivo — (A)

| Control                                                                                                                             | Ruta / evidencia                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SecuritySystem`: rate limit distribuido, sanitización de payloads, egress con allowlist, cabeceras seguras y redacción de secretos | `src/lib/security.ts`, referenciado por 30 módulos de `src/`                                                                                                                             |
| Egress con allowlist, `redirect: "error"` y circuit breaker en el hot path de inferencia                                            | `SecuritySystem.fetchSafeUpstream`                                                                                                                                                       |
| Bloqueo SSRF previo a la allowlist (CIDR, loopback, IMDS)                                                                           | `src/lib/security/ssrf-deny.ts` + `test/security/ssrf-deny.test.ts` (8 tests)                                                                                                            |
| Veto de credenciales al hacer spawn en sandbox                                                                                      | `src/lib/security/credential-env.ts` → `src/lib/sovereign-sandbox.ts` + `test/security/sandbox-credential-isolation.test.ts` (7 tests)                                                   |
| Output gate `ALLOW/FLAG/DENY` con cancelación del upstream ante DENY sobre SSE                                                      | `src/lib/isabella-chat-gateway.ts`, `test/security/output-gate.test.ts`, `test/unit/output-security-gate.test.ts`                                                                        |
| Autenticación en las dos rutas de chat                                                                                              | `withSovereignAuth` en `src/routes/api/isabella.ts` y `src/routes/api/v1/isabella.ts`                                                                                                    |
| Capability tokens + RBAC + policy engine                                                                                            | `src/lib/policy-engine.ts`, `rbac.ts`, `abac.ts`, suites `test/unit/capability-tokens.test.ts`, `test/security/capability-token.test.ts`, `test/security/authorization-security.test.ts` |
| Validación Zod de variables de entorno; sin `process.env` fuera de config                                                           | `src/lib/env-schema.ts`, `src/lib/config.ts`                                                                                                                                             |
| Cabeceras de seguridad en el borde                                                                                                  | 8 cabeceras en `vercel.json` (HSTS con preload, CSP, XFO `DENY`, XCTO, Referrer-Policy, Permissions-Policy, COOP, CORP) + runtime                                                        |
| `.env.example` sin valores reales                                                                                                   | `.env.example`                                                                                                                                                                           |
| Regla de gobernanza citable                                                                                                         | `AGENTS.md`: _"Las inteligencias sugieren, calculan y evalúan; el humano decide, aprueba y ejecuta."_                                                                                    |

### Aspiracional / no demostrable — decláralo como tal

Lo siguiente **no está demostrado** y no debe presentarse como existente ni como certificado:

- **HSM / KMS físico o externo:** hay abstracciones y tests de firma de aplicación (`test/unit/kms.test.ts`, `attestation-signature`), no infraestructura de claves gestionada verificada.
- **RLS activo en producción:** existen migraciones y contratos, no evidencia de RLS corriendo contra una base viva.
- **Stripe en modo live:** el SDK está presente; no hay transacciones productivas verificadas.
- **GDPR / EU AI Act u otros marcos regulatorios:** `AGENTS.md` §22 declara explícitamente que **no afirma cumplimiento**; es un control técnico de repositorio, no una certificación.
- **Certificación de producción, auditoría externa o sellos de cumplimiento.**
- **CI de GitHub ejecutando gates:** los workflows existen pero están bloqueados por billing de la cuenta de GitHub (causa externa al código; ver §12).

### Qué no reclamamos

- No reclamamos AGI, consciencia, ni autoridad autónoma sobre personas.
- No reclamamos que un build verde certifique producción: los gates de este README son **locales**.
- No reclamamos capacidades de los subsistemas listados como **(B)** o **(C)** en las tablas anteriores.
- No reclamamos que SIGJ, "Aguijón Cero", PlantUML/ASTM ni "ANSI codes" existan como subsistemas: **no existen**.
- No reclamamos que el registro `src/core/skills/skill-registry.ts` sea canónico: **no lo es** (0 importadores).

---

## Estado y avance a producción

### Gates locales en verde (medidos el 2026-10-05)

Todos los resultados de esta tabla se ejecutaron en local sobre esta versión del documento. **Son gates locales: no sustituyen CI ni certificación.**

| Gate                      | Comando                                                     | Resultado                                                                                                |
| ------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Contrato de lockfile      | `pnpm verify:lock`                                          | PASS                                                                                                     |
| Typecheck                 | `pnpm typecheck`                                            | **0 errores**                                                                                            |
| Lint                      | `pnpm lint` (`eslint .`)                                    | **0 errores / 389 warnings**                                                                             |
| Tests                     | `pnpm test` (`vitest run`)                                  | **162 archivos** (161 pasados + 1 omitido) · **1211 tests** (1202 pasados + 9 omitidos) · **0 fallidos** |
| Contrato de imports       | `pnpm audit:imports`                                        | PASS (879 archivos)                                                                                      |
| Auditoría de arquitectura | `pnpm audit:architecture`                                   | PASS (1127 archivos)                                                                                     |
| Auditoría de repositorio  | `pnpm audit:repository`                                     | PASS                                                                                                     |
| Auditoría de rutas        | `pnpm audit:routes`                                         | PASS (0 hallazgos, 0 duplicados)                                                                         |
| Inventario de documentos  | `pnpm audit:documents`                                      | PASS                                                                                                     |
| Recetas / manifiesto      | `pnpm audit:recipes`                                        | PASS                                                                                                     |
| Matriz de capacidades     | `pnpm capabilities`                                         | PASS — **34 capacidades: 29 `real`, 3 `evidence-gated`, 2 `manual`**                                     |
| Seguridad                 | `pnpm security:scan`                                        | PASS (ESLint security: 0 errores / 14 warnings + `secret-scan` OK)                                       |
| Build                     | `pnpm build` (incluye `prebuild` y `generate-client-shell`) | OK (Vite 8 + Nitro)                                                                                      |
| Política como código      | `pnpm policy:check`                                         | OK                                                                                                       |

`pnpm production:gate` encadena **16 pasos** en una sola corrida. `ci.yml` delega en `fgais-gate.yml`.

### Qué prueban y qué no prueban estos gates

| Los gates locales **sí** prueban                                                    | Los gates locales **no** prueban                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Que `tsc` no detecta errores de tipos en el árbol completo                          | Que el código se comporte igual en Vercel o en Docker               |
| Que ESLint reporta 0 errores de reglas y de seguridad                               | Que no existan fallos desconocidos por ausencia de test             |
| Que 1.202 tests unitarios, de seguridad, BookPI e integración pasan en esta máquina | Rendimiento, carga, latencia real ni comportamiento bajo tráfico    |
| Contratos estáticos de imports, arquitectura, rutas, documentos y recetas           | Que RLS, Stripe, HSM/KMS o proveedores externos estén operativos    |
| Ausencia de secretos hardcodeados (`secret-scan`) y lockfile consistente            | Que la evidencia `evidence-gated` exista sin Postgres real          |
| Que el bundle compila con Vite + Nitro y genera el client shell                     | Que exista verificación continua en CI (bloqueo externo de billing) |

Un test verde significa que el código hace lo que ese test afirma, en este entorno y en este commit. No significa que la funcionalidad esté desplegada, certificada ni auditada de forma independiente.

### Superficie medida (2026-10-05)

| Métrica                                |                              Valor |
| -------------------------------------- | ---------------------------------: |
| Archivos `.ts`/`.tsx` en `src/`        |                                885 |
| Líneas en `src/`                       |                            176.860 |
| Suites de test                         | 162 (160 en `test/` + 2 en `src/`) |
| Tests descubiertos                     |                              1.211 |
| Scripts en `scripts/`                  |                                 44 |
| Scripts npm                            |                                 50 |
| Dependencias (producción / desarrollo) |                            84 / 27 |
| Documentos en `docs/`                  |                                154 |
| Workflows de GitHub Actions            |                                 18 |
| Migraciones Supabase                   |                                 10 |
| Archivos trackeados por git            |                              1.409 |

### Avance por capacidades

`pnpm capabilities` clasifica las 34 capacidades del manifiesto:

| Estado           | Cantidad | Porcentaje | Significado                                                          |
| ---------------- | -------: | ---------: | -------------------------------------------------------------------- |
| `real`           |   **29** |   **85 %** | Código ejecutable con tests verdes en esta corrida                   |
| `evidence-gated` |        3 |        9 % | Requiere Postgres real / `TEST_DATABASE_URL` para producir evidencia |
| `manual`         |        2 |        6 % | Requiere verificación humana                                         |

**85 % (29/34)** es el avance real medible hoy. Las 3 `evidence-gated` necesitan base de datos viva; las 2 `manual` necesitan revisión humana. Ninguna de ellas cuenta como PASS para una certificación.

### Bloqueos declarados

1. **CI de GitHub Actions bloqueado por billing de la cuenta.** Los jobs no llegan a ejecutar gates sobre `main`; es una causa externa al código y no un defecto del repositorio, pero deja el HEAD sin verificación continua.
2. **3 capacidades `evidence-gated`** sin evidencia hasta tener Postgres real configurado.
3. **Certificación de producción** exigiría además: migraciones aplicadas y verificadas en el ambiente, secretos reales, proveedor de inferencia autorizado, Stripe live, HSM/KMS externo, evidencia same-commit, smoke tests operacionales y rollback probado.

**Conclusión honesta:** los gates locales están en verde y el código es ejecutable y auditable; el proyecto **no** debe declararse certificado al 100 % para producción.

---

## Cómo se ejecuta: desarrollo y despliegue

### Desarrollo

```bash
pnpm install --frozen-lockfile
pnpm dev                 # Vite en 0.0.0.0:3000
```

### Gates y verificación

```bash
pnpm typecheck           # tsc --noEmit
pnpm lint                # eslint .
pnpm test                # vitest run (4 proyectos)
pnpm security:scan       # eslint security + secret-scan
pnpm capabilities        # matriz de capacidades
pnpm build               # prebuild + vite build + generate-client-shell
pnpm production:gate     # cadena completa de 16 pasos
pnpm production:gate:policy  # policy:check + production:gate
```

Comandos individuales de auditoría:

```bash
pnpm verify:lock
pnpm audit:imports
pnpm audit:architecture
pnpm audit:repository
pnpm audit:routes
pnpm audit:documents
pnpm audit:recipes
pnpm policy:check
pnpm db:verify
```

### Reproducir las cifras de este documento

```powershell
# superficie de src/ -> 885 archivos .ts/.tsx y 176.860 líneas no vacías
$f = Get-ChildItem src -Recurse -File |
  Where-Object { $_.Extension -eq ".ts" -or $_.Extension -eq ".tsx" }
$f.Count
($f | ForEach-Object { (Get-Content -LiteralPath $_.FullName | Measure-Object -Line).Lines } |
  Measure-Object -Sum).Sum

# suites de test -> 160 en test/ (159 .test.ts + 1 .test.tsx) + 2 en src/ = 162
(Where-TestFiles test).Count
(Where-TestFiles src).Count

# inventarios -> 50 scripts npm, 44 scripts, 154 docs, 1409 archivos trackeados
((Get-Content package.json -Raw | ConvertFrom-Json).scripts.PSObject.Properties | Measure-Object).Count
(Get-ChildItem scripts -File).Count
(Get-ChildItem docs -Recurse -File).Count
git ls-files | Measure-Object
```

donde `Where-TestFiles` es:

```powershell
function Where-TestFiles($dir) {
  (Get-ChildItem $dir -Recurse -File |
    Where-Object { $_.Name -like "*.test.ts" -or $_.Name -like "*.test.tsx" }).Count
}
```

Los gates se reproducen con `pnpm production:gate`; los resultados de la tabla de la sección 12 corresponden a una corrida local de esa cadena el 2026-10-05.

### Despliegue

- **Vercel** (`vercel.json`): `installCommand: pnpm install --frozen-lockfile`, `buildCommand: NITRO_PRESET=vercel pnpm run build`, `outputDirectory: .vercel/output`; despliegue automático solo en `main` (feat/repair/chore deshabilitados).
- **Docker** (`Dockerfile`): base `node:24.11.0-alpine`, build multi-stage, usuario no root `isabella`, `CMD ["node", ".output/server/index.mjs"]`, `HEALTHCHECK` contra `/api/health/live`.
- **Runtime local:** `pnpm start` (sirve `.output/server/index.mjs`).
- **CI:** `.github/workflows/` (18 archivos); `ci.yml` delega la puerta en `fgais-gate.yml`.

---

## Estructura del repositorio

```text
isabella-ai-tina/
├── api/
│   └── [...path].ts          # adaptador Express -> Vercel
├── server.ts                 # servidor Express 5 (entrada principal legacy)
├── src/
│   ├── routes/               # file-routes TanStack (chat, ops, pake, raíz)
│   ├── server-routes/        # handlers servidor (billing, images, ncua-load, ...)
│   ├── core/                 # kernel: orchestrator, gateway, tool-dispatch, ingress
│   ├── domains/              # dominios (ai: tools-catalog, processPerception, ...)
│   ├── lib/
│   │   ├── skills/           # registry + packs (core, territorial, evolved, ...)
│   │   ├── intelligence/     # transports, moe, router, providers
│   │   ├── security/         # ssrf-deny, credential-env, crypto
│   │   ├── lsp/              # cliente/servidor LSP (apagado por defecto)
│   │   ├── mcp-server/       # servidor MCP a mano (sin SDK)
│   │   ├── media/            # pipeline de imágenes con sharp (*.server.ts)
│   │   ├── secret-sources/   # fuentes async de secretos
│   │   ├── repositories/     # BookPI, decision ledger, auditoría
│   │   └── governance/       # human-approval, change, provenance
│   ├── components/           # interfaz React
│   └── generated/prisma/     # cliente Prisma generado (excluido de .prettierignore)
├── test/                     # 160 suites (unit, security, bookpi, integration)
├── scripts/                  # 44 scripts de gate/auditoría
├── supabase/migrations/      # 10 migraciones
├── docs/                     # 154 documentos
├── .github/workflows/        # 18 workflows
├── AGENTS.md                 # documento maestro (reglas de honestidad)
├── LICENSE* / LICENSES.md    # matriz de licencias
├── package.json              # 50 scripts npm, 84 + 27 dependencias
├── vercel.json / Dockerfile  # despliegue
└── vitest.config.ts          # 4 proyectos de test
```

---

## Estado del documento

| Campo                  | Valor                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Documento              | README canónico — Isabella Villaseñor AI / TINA                                                                                      |
| Versión del documento  | **5.0.0**                                                                                                                            |
| Fecha                  | **2026-10-05**                                                                                                                       |
| Versión del proyecto   | 4.3.3 (`package.json`)                                                                                                               |
| Regla aplicada         | `AGENTS.md`: _código existente ≠ capacidad verificada; un test local ≠ producción; build verde ≠ certificación_                      |
| Estados                | (A) cableado con tests · (A)\* cableado sin tests propios · (B) con tests sin consumidor · (C) documentado/inexistente/código muerto |
| Gates locales          | En verde el 2026-10-05 (ver §12)                                                                                                     |
| CI de GitHub           | Bloqueado por billing de la cuenta (externo)                                                                                         |
| Avance por capacidades | 85 % `real` (29/34), 3 `evidence-gated`, 2 `manual`                                                                                  |
| Estado                 | Ejecutable y auditable en local; **no certificado al 100 % para producción**                                                         |

---

## Licencias

La matriz completa está en `LICENSES.md`; los textos íntegros, en los archivos `LICENSE*` del repositorio.

| Categoría                 | Archivo                                       | Licencia                                      |
| ------------------------- | --------------------------------------------- | --------------------------------------------- |
| Software (raíz)           | `LICENSE`                                     | Apache-2.0 (o el texto indicado en `LICENSE`) |
| Textos Apache             | `LICENSE-APACHE`                              | Apache-2.0                                    |
| Contribuciones ISC        | `LICENSE-ISCL`                                | ISC                                           |
| Contenido y documentación | `LICENSE-CONTENT`                             | CC BY 4.0                                     |
| Marca e identidad         | `LICENSE-SOVEREIGN.md` + `LICENSE-CONTROL.md` | Control soberano (no open source)             |

Reglas declaradas en `LICENSES.md`: software, marca y docs tienen reglas distintas (Apache-2.0 no otorga derechos de marca); las dependencias conservan su propia licencia (ver inventario SBOM); ninguna licencia de código autoriza por sí sola el procesamiento de datos personales. `AGENTS.md` declara ORCID 0009-0008-5050-1539, DOI 10.5281/zenodo.20606361 y OSF 10.17605/OSF.IO/T3WMY para material declarado. Este documento no constituye asesoría legal.
