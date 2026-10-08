# Isabella Villaseñor AI

**Versión canónica:** 4.3.3
**Ecosistema:** TAMV ONLINE NETWORK · RDM Digital Hub · Nodo Cero · Real del Monte, Hidalgo, México
**Runtime:** Vite 8 + TanStack Router + Nitro/Vercel
**Persistencia:** Prisma 7 sobre PostgreSQL/Neon cuando `DATABASE_URL` está configurado
**Estado:** código operativo en desarrollo; cada capacidad debe considerarse IMPLEMENTED, TESTED, VERIFIED o DEPLOYED únicamente cuando exista evidencia reproducible.

## Propósito

Isabella es una arquitectura cognitiva híbrida y gobernada. Coordina interacción, memoria, recuperación, políticas, herramientas, persistencia, seguridad y trazabilidad. No es AGI, consciencia artificial, persona, autoridad jurídica ni sustituto de la decisión humana.

Principio rector: las inteligencias sugieren, calculan y evalúan; el humano decide, aprueba y ejecuta.

## Arquitectura

El flujo canónico es:

```text
PERCEIVE → REMEMBER → POLICY GATE → DECIDE → ACT → AUDIT → RESPOND
```

Los dominios principales son:

- **CROWN:** arbitraje, routing, contexto y estado.
- **ISA:** presencia, tono y presentación de Isabella.
- **SOPHIA:** evidencia, epistemología, síntesis y clasificación de confianza.
- **ORION:** herramientas, workflows y ejecución autorizada.
- **ARGUS:** seguridad, veto, redacción, cuotas y auditoría.
- **BookPI/outbox:** registro de decisiones, hashes, eventos y evidencia operacional.

Las mutaciones, operaciones económicas, cambios de permisos y herramientas con efectos laterales deben fallar de forma cerrada cuando identidad, tenant, policy, capability, cuota, validación o evidencia no estén disponibles.

## Estructura del repositorio

```text
src/
  components/       UI y superficies de producto
  context/          estado de sesión y CROWN
  lib/              dominios, seguridad, auth, persistencia y engines
  routes/           shells de rutas TanStack activas
  server-routes/    handlers canónicos de servidor
  generated/        artefactos generados; no editar manualmente
prisma/             esquema y configuración Prisma
scripts/             auditorías, gates, migración y preflight
test/                pruebas unitarias, seguridad y contratos
docs/                ADRs, RFCs, evidencia y gobernanza
hypercore-runtime/  runtime auxiliar y sus pruebas
```

`src/routes/` delega la lógica en `src/server-routes/`. Las rutas sensibles deben conservar autenticación, rate limiting y validación apropiados al riesgo.

## Desarrollo

Requisitos: Node.js compatible con el proyecto, pnpm 10.34.5 y una instancia PostgreSQL si se desea persistencia real.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

La aplicación local se sirve en `http://localhost:3000`.

## Validación

Comandos existentes y verificables:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify:lock
pnpm audit:routes
pnpm audit:repository
pnpm audit:dependencies
pnpm security:scan
pnpm db:verify
pnpm production:gate
```

No todos los gates son equivalentes: un build verde no certifica seguridad, producción ni exactitud epistemológica. Los comandos que requieran credenciales, servicios externos o una base de datos deben reportarse como no verificados si el entorno no los proporciona.

## Persistencia y datos

Prisma genera el cliente desde `prisma/schema.prisma` durante `postinstall`. La aplicación debe recibir `DATABASE_URL` mediante el entorno de ejecución; nunca se deben commitear credenciales, dumps o tokens. Las consultas de datos de usuario deben estar acotadas por identidad y tenant. Las operaciones de migración se ejecutan con revisión explícita:

```bash
pnpm db:migrate
pnpm db:verify
pnpm db:backup
```

BookPI y el outbox son evidencia operativa, no equivalen por sí mismos a WORM regulatorio, firma criptográfica certificada o certificación independiente.

## Seguridad

- No incluir secretos en código, logs, fixtures, documentación ni artefactos.
- Usar autenticación OIDC/JWT configurada para el entorno; una sesión de desarrollo no es una identidad de producción.
- Validar MIME, tamaño, encoding, entrada, salida y correlación de cada request sensible.
- Aplicar scopes autorizados, resolución de tenant, RBAC/ABAC, cuotas y capacidades antes de actuar.
- Verificar firmas de webhooks y mantener idempotencia en mutaciones externas.
- Preferir fail-closed para operaciones con side effects.

## Estado de capacidades

La clasificación operativa es:

- **CONCEPTUAL:** diseño sin implementación verificable.
- **PLANNED:** pendiente de issue/RFC.
- **IMPLEMENTED:** código existente y conectado.
- **TESTED:** pruebas automatizadas aprobadas.
- **VERIFIED:** evidencia reproducible en un ambiente definido.
- **DEPLOYED:** desplegado en un ambiente identificable.
- **HARDENED/CERTIFIED:** solo con evaluación y evidencia formal.
- **SIMULATED/BLOCKED:** mock, placeholder o deliberadamente inhabilitado.

No se deben convertir claims conceptuales en capacidades productivas sin evidencia.

## Convenciones de contribución

1. Leer `AGENTS.md`, `SECURITY.md`, `CODEOWNERS`, `LICENSES.md`, ADRs y contratos afectados.
2. Hacer el cambio mínimo completo y preservar evidencia existente.
3. No usar `localStorage` como persistencia de datos de negocio.
4. No editar archivos generados manualmente.
5. Ejecutar los gates relevantes y documentar los bloqueos reales.
6. No reescribir historia remota ni hacer force-push.
7. Usar commits pequeños, descriptivos y reversibles.

## Límites y deuda conocida

El repositorio contiene superficies históricas amplias, componentes experimentales y señales de deuda técnica. Los conteos de auditoría son indicadores, no pruebas de vulnerabilidad: deben revisarse con contexto. Todo módulo que no tenga evidencia de integración real debe permanecer marcado como experimental, simulado o bloqueado.

## Licencia y gobernanza

La documentación y el contenido conservan la licencia declarada por el proyecto. El código y sus dependencias conservan sus licencias específicas. Las referencias de autoría, ORCID, DOI, OSF y gobernanza presentes en los documentos canónicos no constituyen certificación legal, financiera, de seguridad o regulatoria.

## Contacto operativo

Para cambios de arquitectura, seguridad, datos, identidad, economía o permisos, registrar primero un ADR o RFC y conservar la trazabilidad en Git. La revisión humana es obligatoria para cualquier acción con efectos externos o irreversibles.
