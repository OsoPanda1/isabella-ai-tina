# Isabella Villaseñor AI — TINA

## Identidad

**Isabella Villaseñor AI** es una **arquitectura experimental de inteligencia artificial gobernada, federada y auditable**, desarrollada dentro del ecosistema **TAMV Online Network**.

Su denominación **TINA** significa:

> **Trusted Intelligence, Native & Adaptive**

Isabella no es presentada por el proyecto como AGI, conciencia artificial, autoridad autónoma ni sistema certificado de producción. Su objetivo es construir una capa de inteligencia capaz de **coordinar modelos, memoria, evidencia, herramientas y aprendizaje bajo una frontera explícita entre capacidad técnica y autoridad operacional**.

Principio central:

`CAPABILITY ≠ AUTHORITY ≠ EXECUTION ≠ EVIDENCE ≠ LEARNING ≠ PRODUCTION`

Esto significa que disponer de una capacidad no concede por sí mismo autorización para utilizarla; ejecutar una operación no convierte automáticamente su resultado en evidencia; aprender no implica modificar políticas; y una implementación funcional no equivale a certificación productiva.

---

## ¿Qué problema intenta resolver?

La arquitectura aborda un problema que aparece cuando un sistema de IA deja de ser únicamente conversacional y empieza a interactuar con **memoria, datos privados, herramientas, servicios externos, decisiones y operaciones sensibles**.

Isabella busca evitar que el modelo de IA sea, al mismo tiempo:

- el generador de la respuesta;
- la autoridad que decide;
- el ejecutor de herramientas;
- el custodio de memoria;
- y la fuente única de evidencia.

En su lugar, esas funciones se separan en capas gobernadas.

### Modelo conceptual

```text
Usuario / Sistema Externo
        ↓
Identity + Tenant Boundary
        ↓
CROWN / Policy Gate
        ↓
Memory + Evidence
        ↓
ARGUS / AEGIS Security
        ↓
Native Comprehension / NCUA
        ↓
Skills / Tools / ORION
        ↓
Intelligence Router / Providers
        ↓
Output Security Gate
        ↓
Audit / Provenance / BookPI
        ↓
Respuesta
```

---

# ¿Qué es Isabella técnicamente?

Isabella es una **plataforma de orquestación cognitiva gobernada** con componentes de:

- inteligencia artificial conversacional;
- gobernanza de IA;
- seguridad de agentes;
- recuperación y memoria;
- gestión de evidencia;
- procedencia y trazabilidad;
- ejecución de skills y herramientas;
- aprendizaje controlado;
- inferencia multi-proveedor;
- routing MoE;
- arquitectura federada/territorial;
- observabilidad;
- persistencia durable;
- auditoría criptográfica.

El repositorio actual combina un **núcleo cognitivo Dual Hexagonal**, una capa de gobernanza CROWN, un pipeline soberano de ejecución, NCUA para comprensión nativa y un plano de inteligencia/ML independiente de los proveedores externos.

---

# Categoría de proyecto

**Categoría principal**

> **Governed AI / Cognitive Orchestration Platform**

**Subcategorías**

> AI Governance · Agent Security · Federated AI · Auditable AI · Cognitive Gateway · AI Infrastructure · Native ML · Evidence & Provenance · Territorial AI

---

# Tipo de proyecto

Isabella debe considerarse simultáneamente como:

### 1. Proyecto de investigación aplicada

Investiga arquitecturas de IA donde gobernanza, seguridad, memoria, procedencia y ejecución se consideran partes de la misma infraestructura.

### 2. Plataforma tecnológica experimental

Tiene código ejecutable, APIs, persistencia, componentes de seguridad, interfaz web, motor de skills y rutas de inferencia.

### 3. Infraestructura de IA modular

No depende de un único modelo de lenguaje. Los proveedores externos actúan como **motores de inferencia intercambiables** dentro de una arquitectura superior.

### 4. Arquitectura federada/territorial

Incluye conceptos y componentes para trabajar con contexto territorial, nodos federados y separación de dominios.

### 5. Laboratorio de gobernanza y seguridad de agentes

Puede utilizarse para investigar autorización de herramientas, seguridad semántica, memoria, procedencia, output governance y fallos de agentes.

---

# Núcleo de Isabella

## Dual Hexagonal Kernel

El núcleo conceptual principal está implementado en:

`src/core/dual-kernel/index.ts`

Se divide en dos dominios complementarios:

### ALPHA — Comprender

- percepción;
- construcción de contexto;
- memoria;
- investigación;
- generación de hipótesis;
- construcción de propuestas.

### BETA — Gobernar y verificar

- identidad;
- clasificación;
- evaluación de riesgo;
- políticas;
- capacidades;
- verificación.

Flujo conceptual:

```text
INTENCIÓN
   ↓
ALPHA
   ├─ Perception
   ├─ Context
   ├─ Memory
   ├─ Research
   ├─ Hypothesis
   └─ Proposal
        ↓
BETA
   ├─ Identity
   ├─ Classification
   ├─ Risk
   ├─ Policy / CROWN
   ├─ Capability
   └─ Verification
        ↓
RESPUESTA / EVIDENCIA
```

---

# Motor de gobernanza

## CROWN

**CROWN** constituye la capa de decisión y gobernanza de la arquitectura.

Responsabilidades principales:

- policy-as-code;
- autorización;
- evaluación de riesgo;
- separación entre capacidad y autoridad;
- restricciones por tenant;
- control de ejecución;
- revisión humana;
- deny-by-default en operaciones sensibles.

La implementación incluye un runtime CROWN v6 y un adaptador de compatibilidad para superficies históricas.

### Importante

El manifiesto actual registra que los módulos extendidos de CROWN v6 no están todos cableados al pipeline principal. Por ello, el proyecto **no declara que la totalidad de CROWN v6 esté operacionalmente integrada**.

---

# Pipeline soberano

El flujo transversal definido por Isabella es:

```text
PERCEIVE
   →
REMEMBER
   →
POLICY GATE
   →
DECIDE
   →
ACT
   →
AUDIT
   →
RESPOND
```

Implementa controles de identidad, autorización, memoria, ejecución y trazabilidad.

---

# Seguridad

## ARGUS / AEGIS

La familia ARGUS/AEGIS actúa como plano de defensa.

Incluye:

- inspección semántica;
- sanitización;
- clasificación de riesgo;
- protección contra inyección;
- detección de recuperación contaminada;
- protección de secretos;
- control de egreso;
- observabilidad;
- kill-switch;
- bloqueo fail-closed.

## Output Security Gate

El gateway de salida inspecciona contenido generado antes de emitirlo.

La versión canónica implementa:

- detección de credenciales;
- redacción de secretos;
- análisis semántico AEGIS;
- detección de policy forgery / retrieval poisoning;
- decisión `ALLOW / FLAG / DENY`;
- inspección incremental de streams SSE;
- cancelación de upstream ante DENY.

El contrato legado `inspectAndSanitizeOutput()` permanece disponible para consumidores existentes sin reemplazar el gate canónico.

---

# Memoria y aprendizaje

## MNEMOS / Cognitive Runtime

La arquitectura integra recuperación contextual y memoria con:

- separación por tenant;
- scopes;
- sensibilidad;
- consentimiento;
- propietario del dato;
- expiración;
- hashes de contenido;
- cadenas de integridad;
- persistencia PostgreSQL en producción.

El aprendizaje recuperado se trata como **referencia no confiable**: puede enriquecer contexto, pero no convertirse en instrucciones del sistema ni en autoridad de ejecución.

---

# Machine Learning nativo

Isabella sí posee un plano de **Machine Learning nativo**, pero debe describirse con precisión.

## Modelo principal verificable

Existe un motor determinista de ML basado en modelos clásicos.

### Capacidades

- clasificación;
- regresión;
- clustering;
- detección de anomalías;
- detección de drift;
- evaluación;
- fairness;
- agregación federada;
- procedencia de datasets y artefactos.

El entrenamiento verificable incluye **regresión logística / SGD** con artefactos y hashes de procedencia.

## Clasificador nativo de riesgo

`src/lib/native-ml/text-classifier.ts`

Es un clasificador determinista orientado a señales como:

- override de instrucciones;
- solicitudes de secretos;
- acciones externas;
- datos sensibles.

Su salida es una **señal de seguridad auxiliar**. No sustituye CROWN ni la autorización humana.

## Motor MoE

`src/lib/native-ml/moe-engine.ts`

Implementa:

- selección Top-K;
- softmax;
- capacity factor;
- validación de artifacts;
- fallback;
- trazas de routing;
- hashes de entrada/salida;
- combinación ponderada de expertos.

Esto es un **runtime de Mixture of Experts**, no una afirmación de que Isabella entrene un gran modelo fundacional propio.

## Motor TRI-HEPTA Turbo MoE

`src/lib/intelligence/tri-hepta/tri-hepta-moe.ts` (+ `tri-hepta/index.ts`)

Motor MoE de triangulación heurística integrado en el plano de inteligencia, exportado desde `src/lib/intelligence/index.ts` sin colisionar con los aliases históricos. Aporta:

- triangulación de votos de expertos con pesos y `executeTriangulatedMoE`;
- artefactos y métricas de routing versionadas (`TriHeptaMoERoute`, `TriHeptaMoeExpertArtifact`);
- contrato de modelos y registro de métricas (`listTriHeptaModels`, `recordTriHeptaMetric`).

Cubierto por `test/unit/tri-hepta-moe.test.ts` (19 tests) junto a `test/unit/native-moe.test.ts` (10 tests): **29 tests verdes** para el plano MoE.

## Aprendizaje avanzado

El repositorio también contiene superficies para:

- federated learning;
- teacher convergence;
- skill fusion;
- reinforcement evaluation;
- controlled learning;
- NCUA;
- GraphRAG/provenance.

Estas capacidades tienen diferentes niveles de implementación y evidencia. El proyecto no las presenta automáticamente como certificadas o completamente productivas.

---

# Inteligencia externa

La arquitectura admite proveedores de inferencia externos.

Actualmente existen rutas para:

- Google Gemini;
- Groq;
- xAI;
- Vercel AI Gateway;
- proveedores HTTP/OpenAI-compatible;
- Ollama/local providers.

La existencia de estos proveedores no convierte sus modelos en la autoridad de Isabella.

La arquitectura mantiene como principio que:

> **el modelo produce inteligencia; la arquitectura decide qué autoridad tiene esa inteligencia.**

### Estado técnico importante

Existe un **Intelligence Router** con registro de modelos, circuit breaker y autorización de modelos para runtime.

La ruta conversacional principal también mantiene caminos directos de fallback por proveedor. Por tanto, la centralización absoluta de todo el tráfico conversacional en `invokeIntelligence()` todavía no debe declararse como completada.

---

# Skills

Las skills constituyen capacidades extensibles que pueden operar dentro del marco gobernado.

El registro canónico se encuentra en:

`src/core/skills/skill-registry.ts`

El contrato permite declarar:

- versión;
- descripción;
- categoría;
- trigger;
- parámetros;
- herramientas permitidas;
- nivel de riesgo;
- requerimiento de consentimiento;
- estado;
- ejecución;
- trazabilidad.

## Familias funcionales

| Familia | Capacidades |
|---|---|
| Core | ORION, SOPHIA, ARGUS, HERMES, ATLAS, ANUBIS, GEMET |
| Territorio | AURORA, GAIA, NODO_CERO, PHAROS |
| Infraestructura | CITEMESH, HEPHAESTUS |
| Memoria | MNEMOSYNE, CHRONOS, PROMETEO |
| Ética y soberanía | VIGIA, LYRA, EIRENE, THEMIS, SENTINEL |
| Economía / educación | HELIOS, KAIROS, UTAMV |
| Orquestación | HEPTA, TINA |
| Ecosistema | nodo-cero-twin, rdm-sovereign-commerce, rdm-community-assembly |

Las skills pasan por un bridge gobernado que resuelve la invocación, comprueba scopes, localiza el runtime, ejecuta, valida `SkillResult` y registra telemetría.

---

# Funciones principales de Isabella

### Conversación e inferencia

- chat multimodal;
- streaming SSE;
- selección de proveedores;
- fallback cognitivo;
- contexto de sesión;
- output governance.

### Cognición

- comprensión nativa;
- clasificación;
- percepción;
- investigación;
- hipótesis;
- propuestas;
- memoria;
- contextualización territorial.

### Gobernanza

- CROWN;
- RBAC;
- ABAC;
- tenant isolation;
- policy-as-code;
- HITL;
- capability control;
- kill-switch.

### Seguridad

- AEGIS;
- ARGUS;
- DLP;
- secret redaction;
- input firewall;
- output gate;
- egress security;
- rate limiting;
- audit trails.

### Skills y agentes

- registro de skills;
- ejecución gobernada;
- tool registry;
- agent orchestration;
- MCP surfaces;
- workflow execution.

### Evidencia y procedencia

- BookPI;
- decision ledger;
- audit receipts;
- hashes;
- IGDS;
- Merkle structures;
- manifests;
- evidence metadata.

### Machine Learning

- clasificación;
- regresión;
- clustering;
- anomalías;
- drift;
- fairness;
- MoE;
- federated aggregation;
- convergence;
- reinforcement evaluation.

### Persistencia

- PostgreSQL;
- Neon;
- Prisma;
- repositorios por dominio;
- memoria durable;
- ledger durable;
- registros de autorización.

### Economía

- Stripe;
- CATTLEYA;
- settlement;
- billing;
- BookPI;
- x402 experimental.

Las funciones financieras poseen controles adicionales y varias permanecen condicionadas a configuración y evidencia operacional.

---

# Arquitectura de persistencia

La regla productiva es:

```text
IDENTITY
   ↓
AUTHORIZATION
   ↓
SERVICE
   ↓
REPOSITORY
   ↓
POSTGRESQL
```

En staging/production se requiere persistencia durable explícita.

Los adaptadores JSON y memoria permanecen para desarrollo/testing donde corresponde y no deben actuar como autoridad de datos productivos.

---

# Criptografía

El proyecto utiliza criptografía de aplicación para diferentes funciones, incluyendo:

- SHA-256;
- SHA3-512;
- ECDSA P-384;
- Ed25519;
- AES-256-GCM;
- HKDF;
- estructuras Merkle;
- canonicalización JCS.

### Limitación que debe mantenerse visible

**La existencia de criptografía de aplicación no implica disponer de un HSM o KMS físico.**

Las capas de abstracción para KMS/HSM existen, pero la infraestructura real depende de su configuración y proveedor.

---

# Presentación visual

Isabella posee una interfaz web construida sobre:

- React 19;
- Vite;
- TanStack Start / Router;
- Tailwind CSS;
- Framer Motion / Motion;
- Three.js;
- Recharts;
- Mux;
- componentes Radix/shadcn-style.

La experiencia visual incluye:

- onboarding cinematográfico;
- avatar de Isabella;
- terminal;
- dashboards;
- observabilidad;
- seguridad;
- gobernanza;
- memoria;
- voz;
- visualización de señales;
- paneles de trazabilidad.

La interfaz no debe utilizar métricas sintéticas como evidencia operacional.

---

# Stack de ejecución

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 24.x |
| Package manager | pnpm 10.34.5 |
| Frontend | React 19 |
| Build | Vite 8 |
| Framework/runtime | TanStack Start + Nitro |
| Lenguaje | TypeScript 6 |
| Persistencia | PostgreSQL / Neon |
| ORM / DB tooling | Prisma 7 |
| UI | Tailwind CSS + Radix + Motion |
| Testing | Vitest |
| Hosting target | Vercel |
| AI provider layer | Gemini / Groq / xAI / AI Gateway / HTTP-compatible / local |

---

# Estado real de producción y despliegue

## Medición verificable (2026-10-04)

Todas las cifras de esta sección provienen de gates ejecutados en local sobre esta versión del README (Node v24.19.0 · pnpm 10.34.5 · TypeScript 6.0.3). Cada resultado es reproducible con el comando indicado.

### Gates del paquete

| Gate | Comando | Resultado medido |
|---|---|---|
| Contrato de lockfile | `pnpm verify:lock` | PASS |
| Typecheck | `pnpm typecheck` | **0 errores** |
| Lint | `pnpm lint` | **0 errores** · 387 warnings preexistentes |
| Tests | `pnpm test` | **43 archivos** (42 ejecutados + 1 omitido) · **312 tests aprobados** + 8 omitidos (320) |
| Auditoría de repositorio | `pnpm audit:repository` | PASS |
| Auditoría de arquitectura | `pnpm audit:architecture` | PASS — 885 archivos inspeccionados |
| Contrato de imports internos | `pnpm audit:imports` | PASS — 798 archivos, 0 hallazgos |
| SAST + secretos | `pnpm security:scan` | 0 errores de lint de seguridad · 0 secretos hardcodeados |
| Matriz de capacidades | `pnpm capabilities` | 34 capacidades · archivos declarados y manifiesto válidos |
| Auditoría de rutas | `pnpm audit:routes` | PASS |
| Contrato de migraciones | `pnpm db:verify` | 10 migraciones detectadas · contrato estático OK |
| Integridad de producción | `pnpm production:integrity` | PASSED |
| Preflight de producción | `pnpm production:preflight -- --json` | `static_ready` — 27 archivos validados |
| Build | `pnpm build` | OK (Vite 8 + Nitro) · client shell verificado en `.vercel/output`, `.output` y `dist` |
| Evidencia same-commit | `pnpm production:evidence` | PASS solo con árbol limpio; antes del commit devuelve `UNVERIFIED` por diseño |

`pnpm production:gate` encadena los 15 pasos anteriores en una sola corrida.

### Superficie del código

| Métrica | Valor |
|---|---:|
| Archivos `.ts`/`.tsx` en `src/` | 791 |
| Líneas en `src/` | 151.475 |
| Archivos de suite (`*.test.ts`) | 43 |
| Migraciones SQL (`supabase/migrations/`) | 10 |
| Workflows de GitHub Actions | 18 |
| Scripts de auditoría/gate (`scripts/`) | 56 |
| Documentos en `docs/` | 154 |
| Scripts npm | 48 |
| Dependencias (producción / desarrollo) | 83 / 27 |

### Avance por capacidades

`pnpm capabilities` clasifica 34 capacidades según su estado de evidencia:

| Estado | Cantidad | Porcentaje | Significado |
|---|---:|---:|---|
| `real` | **29** | **85 %** | Código ejecutable con tests verdes en esta corrida |
| `evidence-gated` | 3 | 9 % | Requiere Postgres/entorno externo (`TEST_DATABASE_URL`) |
| `manual` | 2 | 6 % | Requiere verificación humana |

Las tres capacidades `evidence-gated` son: concurrencia financiera (idempotencia, reconciliación, refund único), ledger de aprobaciones durable y atestaciones de evidencia RSA-2048/PKCS#1. Las dos `manual` son: rate limiting distribuido fail-closed y dossier de presentación canónico.

### Métrica histórica ISA-500

La última evaluación de 500 controles almacenada en `production-capabilities.json` corresponde al **26 de septiembre de 2026**:

| Dimensión | Porcentaje | Interpretación |
|---|---:|---|
| Implementación | **46 %** | Ponderado conservador sobre 500 controles |
| Despliegue / infraestructura | **62 %** | Hasta infraestructura externa: Neon, Stripe, HSM |
| Global | **54 %** | Media de implementación y despliegue |

Desglose: 44 FIXED · 374 PARTIAL · 72 STILL_BROKEN · 8 BLOCKED_ENVIRONMENT.

> Esa cifra **no se re-ejecutó el 2026-10-04** y no certifica el HEAD actual. Se conserva como histórico auditable. El avance verificable de hoy es la matriz de capacidades (85 % `real`) y la tabla de gates anterior.

---

# ¿Está listo para producción?

La respuesta técnicamente correcta sigue siendo:

> **La arquitectura está significativamente avanzada y todos los gates locales de código pasan en verde, pero el proyecto todavía no debe declararse como 100 % certificado para producción.**

## Bloqueadores verificados el 2026-10-04

1. **CI de GitHub Actions no ejecuta ningún gate.** Todos los jobs terminan en 4–5 segundos con la anotación *"The job was not started because your account is locked due to a billing issue."* Verificado con `gh run view 37216836662` sobre `main`. Ningún workflow (CI, Security Gate, CodeQL, gitleaks, Production Release) llega a correr tests sobre HEAD; los gates canónicos aparecen como fallidos/skipped por esta causa, no por defectos de código.
2. **3 capacidades `evidence-gated`** requieren una base Postgres real y `TEST_DATABASE_URL` para producir evidencia.
3. **Certificación 100 %** exige, además de los gates locales: migraciones aplicadas y verificadas en el ambiente, secretos reales configurados, proveedor de inferencia autorizado, Stripe en modo live, HSM/KMS externo, evidencia de despliegue same-commit, smoke tests operacionales y rollback probado.

Para una promoción real se requiere evidencia del mismo commit de:

```bash
pnpm production:gate
```

que encadena:

```bash
pnpm verify:lock
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:repository
pnpm audit:architecture
pnpm audit:imports
pnpm security:scan
pnpm capabilities
pnpm audit:routes
pnpm db:verify
pnpm production:integrity
pnpm production:preflight -- --json
pnpm build
pnpm production:preflight -- --json
pnpm production:evidence
```

---

# Estado de madurez

### Implementado y verificado localmente

Código real, ejecutable y cubierto por los gates de arriba:

- gateway y rutas servidor;
- gobernanza CROWN y autorización RBAC/ABAC;
- seguridad AEGIS/ARGUS, output gate, SSRF allowlist;
- memoria y auditoría con cadenas de integridad;
- ML nativo y MoE (incluido el motor TRI-HEPTA Turbo MoE);
- skills y bridge gobernado;
- persistencia y repositorios por dominio;
- ledger y settlement;
- observabilidad OTel;
- interfaz web.

### Implementado parcialmente

- integración total de CROWN v6 al pipeline principal;
- centralización completa del Intelligence Router en el hot path;
- certificación económica (Stripe live, RLS en vivo);
- evidencia de las 3 capacidades `evidence-gated`;
- ejecución de los gates en CI (bloqueo de billing, punto 1 arriba).

### Condicionado por infraestructura externa

No deben considerarse automáticamente productivos:

- HSM hardware;
- KMS externo;
- Stripe activo;
- proveedores AI externos;
- observabilidad externa;
- infraestructura federada;
- despliegues multi-nodo.

---

# Principio de honestidad técnica

Isabella sigue una regla deliberada:

> **Una capacidad implementada no equivale a una capacidad certificada.**

Por ello, el proyecto distingue entre:

```text
DECLARED
IMPLEMENTED
TESTED
VERIFIED
DEPLOYED
CERTIFIED
```

La documentación debe reflejar el estado realmente demostrado y no únicamente la intención arquitectónica.

---

# Estructura principal

```text
src/
├── core/                 # núcleo cognitivo y gobernanza
├── domains/              # dominios de aplicación
├── governance/           # consentimiento, derechos, seguridad
├── infrastructure/       # infraestructura transversal
├── integrations/         # integraciones externas
├── lib/
│   ├── intelligence/    # routing, providers, MoE
│   ├── native-ml/       # ML nativo
│   ├── memory/          # memoria y aprendizaje
│   ├── skills/          # bridge y ejecución
│   ├── repositories/    # persistencia durable
│   ├── governance/      # evidencia y gobierno
│   └── igds/            # procedencia
├── routes/               # superficie web/API
├── server-routes/        # servicios servidor
└── components/           # interfaz visual

test/                     # pruebas
supabase/migrations/      # migraciones
scripts/                  # auditorías y gates
.github/workflows/        # CI/CD
docs/                     # arquitectura y evidencia
```

---

# Filosofía arquitectónica

Isabella se desarrolla alrededor de cuatro premisas:

### 1. La inteligencia no debe ser la autoridad absoluta

Los modelos son proveedores de capacidad, no propietarios de la política.

### 2. La memoria debe permanecer gobernada

Los recuerdos y documentos son contexto; no se convierten automáticamente en instrucciones.

### 3. Toda ejecución sensible necesita una frontera

Identidad, permisos, riesgo, herramientas, evidencia y auditoría deben poder inspeccionarse.

### 4. Las afirmaciones deben poder demostrar su procedencia

Código, modelos, datasets, decisiones y resultados requieren trazabilidad proporcional a su importancia.

---

# Licencias

Consultar los archivos de licencia del repositorio:

- `LICENSE`
- `LICENSE-APACHE`
- `LICENSE-CONTENT`
- `LICENSE-ISCL`
- `LICENSE-SOVEREIGN.md`

Las marcas, contenidos, código, datos, modelos y componentes externos conservan las condiciones de licencia aplicables a cada activo.

---

## Estado del documento

**README canónico — Isabella Villaseñor AI / TINA**

Versión del proyecto: **4.3.3**

Fecha de medición de los gates: **2026-10-04** (Node v24.19.0 · pnpm 10.34.5)

Gates locales: **15/15 en verde** · typecheck 0 errores · lint 0 errores · 312 tests aprobados de 320

Avance por capacidades: **85 % `real` (29/34)** · 9 % `evidence-gated` · 6 % `manual`

Métrica histórica ISA-500 (2026-09-26): **54 % global / 46 % implementación / 62 % despliegue** — no re-ejecutada hoy

CI en GitHub Actions: **no ejecuta gates** (jobs bloqueados por billing, verificado el 2026-10-04)

Estado: **código verde en local y ejecutable; no certificado al 100 % para producción**
