# Isabella V6 — fuente madre integrada

Este directorio contiene los artefactos V6 promovidos al runtime actual sin reemplazar silenciosamente la aplicación 4.3.3.

## Autoridad

- **Fuente madre arquitectónica:** Isabella Version Terminus V6.
- **Runtime ejecutable actual:** `package.json` versión 4.3.3 y sus rutas TanStack/Nitro.
- **Regla de integración:** un artefacto V6 solo se considera operativo cuando existe un adaptador TypeScript, una ruta o comando que lo consume y evidencia reproducible.
- **No equivalencia:** documentación, SQL y manifiestos importados son diseño/evidencia; no implican migración aplicada, despliegue ni certificación.

## Artefactos promovidos

- `GENESIS-V6-ARCHITECTURE.md`: modelo de arquitectura y fronteras.
- `GENESIS-V6.1-RUNTIME.md`: requisitos de runtime.
- `GENESIS-V6-THREAT-MODEL.md`: amenazas y controles.
- `ISOLATION.md`: aislamiento multi-tenant.
- `DURABLE-LEDGER.md`: principios BookPI.
- `openapi.yaml`: contrato API de referencia V6.
- `../ige-omega/migrations/`: migraciones iniciales de memoria, world model, decisiones ABX y eventos BookPI.

## Estado de migraciones

Las migraciones SQL se conservan como **PLANNED/REVIEW_REQUIRED** hasta validarlas contra el adaptador Prisma/Neon actual, el esquema conectado y una ventana de migración aprobada. No se ejecutan automáticamente durante `build`.

## Próximos adaptadores

1. Mapear tablas V6 a Prisma sin duplicar BookPI/outbox existente.
2. Añadir validación de tenant y actor a cada comando de memoria/decisión.
3. Generar pruebas de compatibilidad contra el contrato OpenAPI V6.
4. Promover cada capacidad con evidencia `IMPLEMENTED`, `TESTED`, `VERIFIED` o `DEPLOYED`.

La integración conserva el principio rector: la inteligencia sugiere y evalúa; la autoridad humana aprueba y ejecuta.
