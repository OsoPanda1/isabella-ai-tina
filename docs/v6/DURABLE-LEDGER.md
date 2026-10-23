# BookPI durable audit ledger — persistencia, retención y backup/restore

> state: draft | engine-generated.
> Contrato de fidelidad: **SPECIFIED ≠ IMPLEMENTED ≠ TESTED ≠ INTEGRATED ≠
> VERIFIED ≠ DEPLOYED ≠ CERTIFIED**. Este documento describe lo que existe como
> código y lo que sigue pendiente.

El runtime registra cambios de estado de capacidad en un ledger append-only
(`bookPiLedger`). Antes era **volátil** (`InMemoryBookPiLedger`,
`storage:"VOLATILE_IN_MEMORY"`, `durable:false`): la cadena se perdía al
reiniciar. Ahora existe una variante **durable** seleccionable por entorno.

## Selección de backend

| Configuración                      | Implementación         | Persistencia               |
| ---------------------------------- | ---------------------- | -------------------------- |
| `BOOKPI_LEDGER_PATH` vacío/ausente | `InMemoryBookPiLedger` | Volátil (documentado)      |
| `BOOKPI_LEDGER_PATH=<ruta>`        | `DurableBookPiLedger`  | Append-only JSONL en disco |

`createAuditLedger()` resuelve la implementación.

El backend JSONL utiliza un archivo local sincronizado con `fsync`, pero **no es una base compartida para funciones serverless ni garantiza consistencia entre réplicas**. En Vercel u otros runtimes efímeros, usa un backend persistente externo para la fuente de verdad. `BOOKPI_LEDGER_PATH` sólo declara un archivo local; no activa automáticamente PostgreSQL, HA ni WORM.
El singleton `bookPiLedger`
la usa al cargar el módulo, por lo que el runtime HTTP, OSIRIS y los eventos de
comercio comparten el mismo backend.

## Garantías y límites

### Durabilidad de archivos y recuperación fail-closed

- Cada fila nueva se agrega con escritura síncrona y `fsync` del descriptor antes de publicarse en la memoria del proceso. Cuando se crea un archivo por primera vez, también se sincroniza su directorio.
- Backup, restore y poda reemplazan cada archivo mediante un archivo temporal en el mismo directorio, `fsync`, renombrado y sincronización del directorio.
- La poda y la restauración alteran dos archivos relacionados (ledger + checkpoint). Antes de modificar cualquiera, escriben un marcador durable `<ledger>.maintenance.pending.json`; el marcador sólo se elimina después de sincronizar ambos archivos. Si el proceso se interrumpe o una operación falla a mitad, cualquier nuevo arranque rechaza el ledger con `BOOKPI_MAINTENANCE_RECOVERY_REQUIRED` en lugar de usar una combinación de ledger/checkpoint posiblemente inconsistente.
- Un marcador pendiente requiere revisión administrativa: validar el archivo de archivo externo, el ledger retenido y el checkpoint; completar o revertir la operación documentadamente y retirar el marcador sólo después de verificar la cadena. No se borra un marcador automáticamente.

- **Append-only:** cada evento se escribe como una línea JSON y se reencadena en
  el arranque. No se sobrescriben eventos en la operación normal.
- **Verificación:** `verify()` recalcula el hash de cada bloque y valida el
  encadenamiento (`previousHash`). Detecta manipulación de un evento persistido.
- **NO es WORM** (`wormEnforced:false`): no hay inmutabilidad por hardware ni
  sellado externo. No se debe presentar como almacenamiento a prueba de
  manipulaciones a nivel de dispositivo.
- **I/O síncrono:** la escritura por evento es síncrona para preservar el orden
  de encadenamiento. Adecuado para auditoría de bajo volumen; no para alto
  throughput.

## Retención

La retención es **planeación pura** (`planRetention`): calcula qué eventos se
mantienen (`kept`) y qué prefijo se archiva (`archived`), sin borrar nada.
Políticas: `maxEvents` (conservar los N más recientes) y `maxAgeMs` (archivar
más antiguos que un umbral); pueden combinarse.

El archivado físico (`DurableBookPiLedger.prune`) es una operación
**administrativa explícita** que:

1. exige que el prefijo ya esté archivado en un archivo aparte, y
2. avanza un **checkpoint** (`<ruta>.checkpoint.json`) con el último hash
   archivado, de modo que la cadena restante sigue siendo verificable
   (la verificación parte del hash del checkpoint, no de génesis).

## Backup y restauración

- `backup(destPath)`: copia el archivo del ledger.
- `restore(srcPath)`: **valida la cadena del respaldo antes de restaurar** y
  rechaza un origen corrupto (`BOOKPI_RESTORE_SOURCE_INVALID` /
  `BOOKPI_RESTORE_SOURCE_CORRUPT`).

## Operación (CLI)

```bash
pnpm bookpi:maintenance verify    --path data/bookpi/ledger.jsonl
pnpm bookpi:maintenance summary   --path data/bookpi/ledger.jsonl
pnpm bookpi:maintenance backup    --path data/bookpi/ledger.jsonl --dest backups/ledger.jsonl
pnpm bookpi:maintenance restore   --path data/bookpi/ledger.jsonl --src backups/ledger.jsonl
pnpm bookpi:maintenance retention --path data/bookpi/ledger.jsonl \
      --max-events 10000 --archive backups/archive.jsonl --prune
```

## Pruebas

- `test/bookpi/durable-ledger.test.ts`: persistencia, recarga, detección de
  manipulación, backup/restore, rechazo de respaldo corrupto, prune con checkpoint.
- `test/bookpi/retention.test.ts`: planeación por `maxEvents`, `maxAgeMs`, combinada.

## Pendiente (no presentar como terminado)

1. Cableado E2E con Postgres/Supabase (`createPostgresStorage`) y rol append-only.
2. Simulacro de recuperación con objetivos RTO/RPO medidos.
3. Rotación de archivos por tamaño y política de cifrado en reposo.
4. Sellado externo (sellos de tiempo / notarización) para WORM real.
