# Isabella Villaseñor AI — TINA

**Trusted Intelligence, Native & Adaptive** — arquitectura de inteligencia artificial gobernada, federada y auditable del ecosistema **TAMV Online Network** (RDM Digital Hub · Nodo Cero · Real del Monte + LATAM community partners).

- Versión del proyecto (`package.json`): **4.3.3**
- Versión de este documento: **5.0.0** — fecha **2026-10-06** (auditoría y hardening)
- Medición de gates y métricas: **2026-10-06**, en local (ver [Estado y avance a producción](#estado-y-avance-a-producción))

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

## Estado de producción (2026-10-06)

### ✅ Verificado
- Typecheck: `tsc --noEmit --strict` PASS (0 errores)
- Lint: `eslint .` PASS (0 errores críticos)
- Tests: 545+ tests en suite completa
- Build: `vite build` SUCCESS
- Production gates: todos los scripts npm listados en `package.json` están implementados
- Documentación: 60+ archivos, estado vigente

### 🔴 Bloqueantes
- **6 PRs de dependabot** abiertos sin mergear (Node 24 + ESM breaking changes)
- **2 PRs críticos** (#455, #449) en reparación de arquitectura, sin gates verdes completados
- **README.md y SECURITY.md** truncados (2026-10-05) — **FIJO 2026-10-06**
- **Script `production:gate` incompleto** — **FIJO 2026-10-06**
- **7 branches de reparación** proliferadas, requieren limpieza post-merge

### 🟡 Pendiente
- CI en GitHub (billing account bloqueados)
- Ejecución de gates automatizados en CI
- Pruebas de carga en producción

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

## Roadmap verificable

### Corto plazo (próximas 2 semanas)
- [ ] Mergear PRs dependabot en orden (#473 → #474 → #475 → #476 → #477 → #472)
- [ ] Verificar gates verdes en #455 y #449
- [ ] Limpiar branches `repair/*` post-merge
- [ ] Ejecutar `pnpm production:gate` full locally

### Mediano plazo (próximo mes)
- [ ] Activar CI en GitHub Actions (resolver billing)
- [ ] SBOM verificado en cada release
- [ ] Attestations SLSA L3 en todos los artefactos
- [ ] ADR para branch protection policy

### Largo plazo
- [ ] Auditoría externa de seguridad
- [ ] Certificación de gobernanza de IA
- [ ] Despliegue multi-región con replicación de ledger

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

**Última auditoría:** 2026-10-06 | **Estado:** En reparación (post-cleanup wave) | **Certificación:** NO (es código en evolución, no producto certificado)
