/**
 * Resolución de workspace y de raíz de proyecto para el capa LSP.
 *
 * Dos preocupaciones viven aquí:
 *
 * 1. **Workspace gate** — el chequeo de alto nivel "¿este directorio es un
 *    proyecto?". El LSP solo corre cuando el cwd (o el archivo editado)
 *    cae dentro de un worktree git. Archivos fuera de toda raíz git nunca
 *    disparan LSP, aunque exista un servidor configurado; así los usuarios
 *    con cwd en su home no levantan daemons.
 *
 * 2. **nearestRoot** — la búsqueda de raíz de proyecto por servidor. Cada
 *    servidor distinto busca un marcador distinto (`pyproject.toml` para
 *    Python, `Cargo.toml` para Rust, etc.) y quiere el directorio que
 *    contiene ese marcador.
 */
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Límite defensivo del caminado hacia arriba (monorepos reales < 64 niveles). */
const MAX_WALK_DEPTH = 64;

/** Caché cwd → raíz del worktree (o `null` si no hay git). Se limpia en shutdown. */
const workspaceCache = new Map<string, string | null>();

function expandHome(target: string): string {
  if (target === "~") return os.homedir();
  if (target.startsWith("~/") || target.startsWith("~\\")) {
    return path.join(os.homedir(), target.slice(2));
  }
  return target;
}

/**
 * Normaliza una ruta para usarla como clave de mapa estable.
 *
 * Resuelve `~`, la hace absoluta y colapsa `.`/`..`. NO resuelve symlinks:
 * la estabilidad de symlinks importa para algunos servidores (rust-analyzer
 * identifica el workspace de Cargo por la ruta canónica).
 */
export function normalizePath(target: string): string {
  return path.resolve(expandHome(target));
}

/**
 * Camina hacia arriba desde `start` buscando una entrada `.git` (archivo o
 * directorio). Devuelve el directorio que contiene `.git` o `null`.
 *
 * Un `.git` *archivo* (no directorio) significa un worktree creado con
 * `git worktree add`; ambas formas cuentan.
 */
export function findGitWorktree(start: string): string | null {
  const raw = normalizePath(start);
  let current = raw;
  try {
    if (existsSync(current) && statSync(current).isFile()) {
      current = path.dirname(current);
    }
  } catch {
    return null;
  }

  const cacheKey = current;
  const cached = workspaceCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result: string | null = null;
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    let found: boolean;
    try {
      found = existsSync(path.join(current, ".git"));
    } catch {
      break;
    }
    if (found) {
      result = current;
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  workspaceCache.set(cacheKey, result);
  return result;
}

/**
 * Devuelve `true` si `target` está dentro de (o es igual a) `workspaceRoot`.
 *
 * Usa rutas absolutas sin resolver symlinks: un archivo accedido vía un
 * symlink que apunta fuera del workspace sigue contando como fuera — la
 * interpretación conservadora, la misma que usan los servidores LSP.
 */
export function isInsideWorkspace(target: string, workspaceRoot: string): boolean {
  const filePath = normalizePath(target);
  const root = normalizePath(workspaceRoot);
  if (filePath === root) return true;
  let relative: string;
  try {
    relative = path.relative(root, filePath);
  } catch {
    return false;
  }
  if (relative === "") return true;
  return !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export interface NearestRootOptions {
  /** Marcadores: si alguno aparece *primero* en el caminado, se descarta el servidor. */
  excludes?: readonly string[];
  /** Directorio máximo al que subir (inclusive). */
  ceiling?: string;
}

/**
 * Camina hacia arriba desde `start` buscando cualquiera de los marcadores.
 *
 * Devuelve el **directorio que contiene** el primer marcador hallado, o
 * `null` si no hay marcador antes de `ceiling` (o de la raíz del sistema).
 * Si `excludes` está presente y un marcador de exclusión aparece *antes*,
 * devuelve `null`: el servidor queda apagado para ese archivo.
 */
export function nearestRoot(
  start: string,
  markers: readonly string[],
  options: NearestRootOptions = {},
): string | null {
  const excludes = options.excludes ?? [];
  let current = normalizePath(start);
  try {
    if (existsSync(current) && statSync(current).isFile()) current = path.dirname(current);
  } catch {
    return null;
  }
  const ceiling = options.ceiling ? normalizePath(options.ceiling) : null;

  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    for (const exclude of excludes) {
      if (safeExists(path.join(current, exclude))) return null;
    }
    for (const marker of markers) {
      if (safeExists(path.join(current, marker))) return current;
    }
    if (ceiling !== null && current === ceiling) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function safeExists(target: string): boolean {
  try {
    return existsSync(target);
  } catch {
    return false;
  }
}

export interface WorkspaceResolution {
  /** Raíz del worktree git, o `null` si no se detectó ninguna. */
  root: string | null;
  /** `true` cuando el LSP debe correr para este archivo. */
  gated: boolean;
}

/**
 * Resuelve el workspace para un archivo.
 *
 * El cwd manda: si el agente arrancó en un proyecto git, ese worktree es el
 * workspace y cualquier edición dentro de él está en scope. Si el cwd no
 * está en un worktree, se intenta la ubicación propia del archivo como
 * ancla secundaria (útil en monorepos con checkouts no relacionados).
 */
export function resolveWorkspaceForFile(
  filePath: string,
  options: { cwd?: string } = {},
): WorkspaceResolution {
  const cwd = options.cwd ?? process.cwd();
  const cwdRoot = findGitWorktree(cwd);
  if (cwdRoot !== null) {
    if (isInsideWorkspace(filePath, cwdRoot)) return { root: cwdRoot, gated: true };
  }
  const fileRoot = findGitWorktree(filePath);
  if (fileRoot !== null) return { root: fileRoot, gated: true };
  return { root: null, gated: false };
}

/** Limpia la caché de resolución de workspace (se llama en shutdown). */
export function clearCache(): void {
  workspaceCache.clear();
}
