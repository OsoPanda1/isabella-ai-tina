/**
 * Barrel público del subsistema LSP (`src/lib/lsp/`).
 *
 * **APAGADO POR DEFECTO**: este subsistema es un recurso de emergencia /
 * fallback. `LSPService` solo spawnea un language server si se construye con
 * `enabled: true`; sin esa opción ningún proceso se arranca, ningún binario se
 * sondea y todos los getters devuelven estado "inactivo". Ni este barrel ni
 * cualquier otro módulo del repo lo activan por su cuenta.
 *
 * El subsistema no descarga nada ni abre red: la localización de binarios es
 * probe-only (`install.ts`), el spawn real es inyectable (`LSPSpawnProcess`) y
 * la trama JSON-RPC vive en `protocol.ts`.
 *
 * Uso típico:
 *
 * ```ts
 * import { createLSPService, findServerForFile } from "@/lib/lsp";
 * ```
 */

export {
  /** Servicio LSP orquestador (un cliente por par servidor+workspace); úsalo solo como fallback y con `enabled: true`. */
  LSPService,
  /** Crea un `LSPService`; sin `enabled: true` en las opciones nace apagado y no spawnea nada. */
  createLSPService,
  /** Opciones de `LSPService`; `enabled` debe ser exactamente `true` para activar el servicio. */
  type LSPServiceOptions,
  /** Instantánea del servicio para reportes/CLI: clientes, broken-set, disabledServers y estado. */
  type LSPServiceStatus,
  /** Opciones de `getDiagnostics`: delta sobre baseline, timeout y remapeo de líneas. */
  type GetDiagnosticsOptions,
  /** Interfaz mínima de cliente LSP que el servicio consume, para inyectar dobles en tests. */
  type LSPClientLike,
  /** Especificación de spawn (comando + raíz + `spawnProcess`) que el servicio pasa a `clientFactory`. */
  type LSPClientSpawnSpec,
  /** Fábrica inyectable de clientes; se usa para sustituir el `LSPClient` real por un doble falso. */
  type LSPClientFactory,
  /** Función que remapea un número de línea pre-edición a post-edición; `null` si la línea se borró. */
  type LineShift,
  /** Devuelve el diagnóstico con el rango remapeado por `shift`, o `null` si la línea inicial ya no existe. */
  shiftDiagnosticRange,
  /** Aplica `shift` a toda una baseline y descarta los diagnósticos caídos en zonas borradas. */
  shiftBaseline,
  /** Timeout idle por defecto (10 min) antes de que el reaper cierre un cliente sin uso. */
  DEFAULT_IDLE_TIMEOUT_MS,
  /** Piso del timeout idle (30 s): por debajo se clampa para no spawnearear en bucle. */
  MIN_IDLE_TIMEOUT_MS,
} from "./service";

export {
  /** Cliente LSP asíncrono sobre stdio para un par `(language_server, workspace_root)`. */
  LSPClient,
  /** Opciones de `LSPClient`; `spawnProcess` permite inyectar un proceso falso en tests. */
  type LSPClientOptions,
  /** Ciclo de vida de un cliente: `stopped` → `starting` → `running` o `error`. */
  type LSPClientState,
  /** Diagnóstico LSP con campos opcionales tolerantes (lo que publica `textDocument/publishDiagnostics`). */
  type LSPDiagnostic,
  /** Abstracción de spawn inyectable: permite spawnearear procesos falsos y nunca binarios reales en tests. */
  type LSPSpawnProcess,
  /** Opciones que el cliente entrega al spawn: `cwd`, `env`, `stdio: "pipe"` y `windowsHide`. */
  type LSPSpawnOptions,
  /** Superficie mínima de un proceso hijo LSP, compatible estructuralmente con `ChildProcess`. */
  type LSPChildProcess,
  /** Superficie mínima de stream legible (stdout/stderr del hijo) usada por el cliente. */
  type LSPReadableLike,
  /** Superficie mínima de stream escribible (stdin del hijo) usada por el cliente. */
  type LSPWritableLike,
  /** Error fail-closed: se intentó spawnear con el LSP deshabilitado; nunca debe ocurrir en producción. */
  LSPDisabledError,
  /** Spawn real vía `child_process.spawn`; úsalo fuera de tests, nunca como camino automático. */
  defaultSpawnProcess,
  /** Envuelve un spawn en un gate fail-closed que solo lo invoca si `isEnabled()` devuelve `true`. */
  createGatedSpawn,
  /** Construye el entorno del hijo con claves de SO permitidas y overrides explícitos (nunca el env completo). */
  buildChildEnv,
  /** Devuelve el URI `file://` de una ruta absoluta, listo para los mensajes LSP. */
  fileUri,
  /** Inverso de `fileUri`: convierte un URI `file://` de vuelta en ruta de archivo. */
  uriToPath,
  /** Posición LSP final de un texto, para reemplazar el documento completo en `contentChanges`. */
  endPosition,
  /** Clave de identidad de un diagnóstico (rango+mensaje+codigo) usada para dedupe y filtrado delta. */
  diagnosticKey,
  /** Timeout de arranque + `initialize`; se usa al llamar `LSPClient.start()`. */
  INITIALIZE_TIMEOUT_MS,
  /** Presupuesto por defecto de espera de diagnósticos en modo `document`. */
  DIAGNOSTICS_DOCUMENT_WAIT_MS,
  /** Presupuesto por defecto de espera de diagnósticos en modo `full`. */
  DIAGNOSTICS_FULL_WAIT_MS,
  /** Timeout de cada request de pull de diagnósticos (`textDocument/diagnostic`). */
  DIAGNOSTICS_REQUEST_TIMEOUT_MS,
  /** Ventana de debounce tras un push de diagnósticos antes de declarar la espera satisfecha. */
  PUSH_DEBOUNCE_MS,
  /** Gracia de apagado (SIGTERM antes de SIGKILL) al cerrar el proceso hijo. */
  SHUTDOWN_GRACE_MS,
  /** Timeout del request `shutdown` en el apagado graceful del cliente. */
  SHUTDOWN_REQUEST_TIMEOUT_MS,
} from "./client";

export {
  /** Constante JSON-RPC `ContentModified` (-32801): el cliente la reintenta con backoff. */
  ERROR_CONTENT_MODIFIED,
  /** Constante JSON-RPC `RequestCancelled` (-32800) del protocolo LSP. */
  ERROR_REQUEST_CANCELLED,
  /** Constante JSON-RPC `MethodNotFound` (-32601) usada al responder requests del servidor no soportados. */
  ERROR_METHOD_NOT_FOUND,
  /** Error de framing o de sobre JSON-RPC; indica bytes malformados, no un fallo del servidor. */
  LSPProtocolError,
  /** Error JSON-RPC con forma válida devuelto por el servidor (`code`, `message`, `data`). */
  LSPRequestError,
  /** Error de operación agotada; su `name` es exactamente `"LSPTimeoutError"` para poder identificarlo. */
  LSPTimeoutError,
  /** Sobre de error JSON-RPC (`code`, `message`, `data?`) dentro de un mensaje LSP. */
  type LSPResponseError,
  /** Mensaje JSON-RPC 2.0 completo: request, response o notification. */
  type LSPMessage,
  /** Clasificación de un mensaje entrante: `request`, `response`, `notification` o `invalid`. */
  type LSPMessageKind,
  /** Resultado de `classifyMessage`: tipo de mensaje y su clave de correlación (id o método). */
  type LSPClassifiedMessage,
  /** Codifica un sobre JSON-RPC como bytes con cabecera `Content-Length` exacta en bytes UTF-8. */
  encodeMessage,
  /** Construye un sobre request JSON-RPC 2.0 con el `id` indicado. */
  makeRequest,
  /** Construye un sobre notification JSON-RPC 2.0 (sin `id`). */
  makeNotification,
  /** Construye un sobre de respuesta exitosa JSON-RPC 2.0. */
  makeResponse,
  /** Construye un sobre de respuesta con error JSON-RPC 2.0. */
  makeErrorResponse,
  /** Clasifica un mensaje recibido y devuelve su tipo y clave de correlación. */
  classifyMessage,
  /** Acumulador incremental de tramas `Content-Length` para el stdout del servidor LSP. */
  LSPFrameReader,
  /** Topes sanidad del `LSPFrameReader` (bytes de cabecera y de cuerpo). */
  type LSPFrameReaderOptions,
} from "./protocol";

export {
  /** Dominios ("sistema de dominios") que agrupan servidores por familia de lenguaje. */
  type LSPDomain,
  /** Comando, raíz, cwd, env y `initializationOptions` resultantes de resolver un servidor para un archivo. */
  type SpawnSpec,
  /** Contexto que el servicio entrega a `ServerDef.buildSpawn` (overrides y resolutor de binarios inyectable). */
  type ServerContext,
  /** Entrada del registro de servidores: match por extensión, raíz de proyecto y comando de spawn. */
  type ServerDef,
  /** Tabla extensión → `languageId` LSP que se envía en `textDocument/didOpen`. */
  LANGUAGE_BY_EXT,
  /** Extensión en minúsculas de un archivo, o su basename completo si no tiene extensión. */
  fileExtOrBasename,
  /** Registro completo de servidores LSP soportados, en orden de precedencia. */
  SERVERS,
  /** Devuelve el servidor del registro que maneja `filePath`, o `null` si ningún servidor hace match. */
  findServerForFile,
  /** Devuelve el `languageId` a enviar en `didOpen` para `filePath` (`"plaintext"` si es desconocido). */
  languageIdFor,
  /** Devuelve el dominio del archivo, o `null` si ningún servidor lo maneja. */
  domainForFile,
  /** IDs de los servidores registrados para un dominio dado. */
  serversInDomain,
} from "./servers";

export {
  /** Resuelve el workspace (raíz git + gate) para un archivo; es la puerta de entrada del LSP a un archivo. */
  resolveWorkspaceForFile,
  /** Limpia la caché de resolución de workspace; se llama en shutdown y entre tests. */
  clearCache,
  /** Normaliza una ruta (`~`, absoluta, `.`/`..`) usándola como clave de caché estable. */
  normalizePath,
  /** Camina hacia arriba buscando `.git` (archivo o directorio) y devuelve la raíz del worktree, o `null`. */
  findGitWorktree,
  /** `true` si `target` está dentro de (o es igual a) `workspaceRoot`, sin resolver symlinks. */
  isInsideWorkspace,
  /** Camina hacia arriba buscando marcadores de proyecto (p. ej. `pyproject.toml`) y devuelve su directorio. */
  nearestRoot,
  /** Opciones de `nearestRoot`: marcadores de exclusión y techo del caminado. */
  type NearestRootOptions,
  /** Resultado de `resolveWorkspaceForFile`: raíz detectada y si el LSP debe correr para el archivo. */
  type WorkspaceResolution,
} from "./workspace";

export {
  /** Estrategia de instalación declarada (`auto` | `manual` | `off`); todas se comportan como probe-only. */
  type InstallStrategy,
  /** Receta documental de instalación de un servidor (paquete, binario, extras); nunca se ejecuta. */
  type InstallRecipe,
  /** Registro paquete → pista de instalación; solo documenta cómo se instalaría a mano. */
  INSTALL_RECIPES,
  /** Opciones del sondeo de binarios: PATH, staging, plataforma y base. */
  type FindExecutableOptions,
  /** Resolutor de binarios inyectable, para forzar presencia/ausencia en tests. */
  type BinaryResolver,
  /** Devuelve la ruta del primer binario hallado en staging propio y PATH, o `null`; no instala nada. */
  findExecutable,
  /** Reporta `"installed"`, `"missing"` o `"manual-only"` para un paquete, sin spawnear ni descargar nada. */
  detectStatus,
  /** Directorio staging propio bajo `node_modules/.cache/isabella-lsp`; se sondea pero nunca se crea aquí. */
  lspStagingDir,
} from "./install";
