/**
 * Localización de binarios de servidores LSP (probe-only).
 *
 * Este módulo **no instala nada**: no hay `tryInstall`, ni subprocess, ni
 * red. Solo declara las recetas (`INSTALL_RECIPES`) que describirían cómo
 * instalar un servidor y expone el sondeo usado por `detectStatus()` y por
 * la resolución de binarios en `servers.ts`.
 *
 * Política del repositorio: instalación manual por defecto
 * (`installStrategy: "manual"`). La estrategia `"auto"` se acepta por
 * paridad de configuración con el origen, pero se comporta exactamente
 * igual que `"manual"`/`"off"`: probe y nada más.
 */
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

export type InstallStrategy = "auto" | "manual" | "off";

export interface InstallRecipe {
  /** Estrategia descrita (solo documental; ninguna ejecuta instalación). */
  strategy: "npm" | "go" | "pip" | "manual";
  /** Paquete que habría que instalar. */
  pkg: string;
  /** Nombre del ejecutable resultante. */
  bin: string;
  /** Paquetes hermanos que npm no arrastra solo (p. ej. `typescript`). */
  extraPkgs?: string[];
}

/**
 * Registro paquete → pista de instalación.
 *
 * `extra_pkgs` del origen se conserva como documentación de la dependencia
 * runtime que npm no auto-descarga (typescript-language-server necesita
 * `typescript` importable desde el mismo árbol node_modules).
 */
export const INSTALL_RECIPES: Readonly<Record<string, InstallRecipe>> = Object.freeze({
  pyright: { strategy: "npm", pkg: "pyright", bin: "pyright-langserver" },
  "typescript-language-server": {
    strategy: "npm",
    pkg: "typescript-language-server",
    bin: "typescript-language-server",
    extraPkgs: ["typescript"],
  },
  "@vue/language-server": {
    strategy: "npm",
    pkg: "@vue/language-server",
    bin: "vue-language-server",
  },
  "svelte-language-server": {
    strategy: "npm",
    pkg: "svelte-language-server",
    bin: "svelteserver",
  },
  "@astrojs/language-server": {
    strategy: "npm",
    pkg: "@astrojs/language-server",
    bin: "astro-ls",
  },
  "yaml-language-server": {
    strategy: "npm",
    pkg: "yaml-language-server",
    bin: "yaml-language-server",
  },
  "bash-language-server": {
    strategy: "npm",
    pkg: "bash-language-server",
    bin: "bash-language-server",
  },
  intelephense: { strategy: "npm", pkg: "intelephense", bin: "intelephense" },
  "dockerfile-language-server-nodejs": {
    strategy: "npm",
    pkg: "dockerfile-language-server-nodejs",
    bin: "docker-langserver",
  },
  gopls: { strategy: "go", pkg: "golang.org/x/tools/gopls@latest", bin: "gopls" },
  // Demasiado pesado para arrancar de forma remota: instalación manual vía rustup.
  "rust-analyzer": { strategy: "manual", pkg: "", bin: "rust-analyzer" },
  // clangd llega con LLVM: instalación manual.
  clangd: { strategy: "manual", pkg: "", bin: "clangd" },
  // LuaLS son binarios de GitHub releases con plataforma específica.
  "lua-language-server": { strategy: "manual", pkg: "", bin: "lua-language-server" },
});

const WINDOWS_WRAPPER_SUFFIXES = [".cmd", ".exe", ".bat"] as const;

/** Único shell de sufijos nativos que se sondea en Windows. */
function suffixesFor(platform: NodeJS.Platform): readonly string[] {
  return platform === "win32" ? WINDOWS_WRAPPER_SUFFIXES : [""];
}

/**
 * Directorio staging propio del repositorio para binarios LSP.
 *
 * Vive dentro de `node_modules/` (ya ignorado por git); se sondea pero
 * **nunca se crea** desde este módulo.
 */
export function lspStagingDir(baseDir: string = process.cwd()): string {
  return path.join(baseDir, "node_modules", ".cache", "isabella-lsp");
}

export interface FindExecutableOptions {
  /** Entradas PATH explícitas; por defecto la PATH del proceso. */
  pathEntries?: string | readonly string[];
  /** Directorio staging propio; por defecto `lspStagingDir()`. */
  stagingDir?: string;
  /** Plataforma objetivo; por defecto la plataforma real. */
  platform?: NodeJS.Platform;
  /** Base para derivar el staging; por defecto `process.cwd()`. */
  baseDir?: string;
}

/** Resolutor de binarios inyectable (permite forzar ausencia en tests). */
export type BinaryResolver = (
  names: readonly string[],
  options?: FindExecutableOptions,
) => string | null;

function isExecutableFile(candidate: string, platform: NodeJS.Platform): boolean {
  try {
    const stats = statSync(candidate);
    if (!stats.isFile()) return false;
    if (platform === "win32") return true;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultPathEntries(): string[] {
  const raw = process.env.PATH;
  if (!raw) return [];
  return raw.split(path.delimiter).filter((entry) => entry.length > 0);
}

/**
 * Devuelve la ruta completa del primer binario hallado entre `names`.
 *
 * Orden: staging propio (con sufijos `.cmd`/`.exe`/`.bat` en Windows),
 * luego PATH. `null` si ninguno existe y es ejecutable.
 */
export function findExecutable(
  names: readonly string[],
  options: FindExecutableOptions = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const stagingDir = options.stagingDir ?? lspStagingDir(options.baseDir);
  const suffixes = suffixesFor(platform);

  for (const name of names) {
    for (const suffix of suffixes) {
      const staged = path.join(stagingDir, `${name}${suffix}`);
      if (isExecutableFile(staged, platform)) return staged;
    }
  }

  const entries =
    options.pathEntries === undefined
      ? defaultPathEntries()
      : typeof options.pathEntries === "string"
        ? options.pathEntries.split(path.delimiter).filter((entry) => entry.length > 0)
        : [...options.pathEntries];

  for (const entry of entries) {
    for (const name of names) {
      for (const suffix of suffixes) {
        const candidate = path.join(entry, `${name}${suffix}`);
        if (isExecutableFile(candidate, platform)) return candidate;
      }
    }
  }
  return null;
}

/**
 * Devuelve `"installed"`, `"missing"` o `"manual-only"` para un paquete.
 *
 * Es el reporte de `status` sin spawnear nada.
 */
export function detectStatus(pkg: string, options: FindExecutableOptions = {}): string {
  const recipe = INSTALL_RECIPES[pkg];
  const binName = recipe ? recipe.bin : pkg;
  if (findExecutable([binName], options)) return "installed";
  if (recipe && recipe.strategy === "manual") return "manual-only";
  return "missing";
}
