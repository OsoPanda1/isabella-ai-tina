/**
 * Registro de servidores LSP por lenguaje.
 *
 * Cada `ServerDef` sabe: cómo hacer match de un archivo (extensión o
 * basename para archivos sin extensión como `Dockerfile`), cómo resolver
 * la raíz de proyecto, cómo armar el comando de spawn y qué
 * `initializationOptions` computar.
 *
 * La localización de binarios vive en `install.ts` (probe-only); este
 * módulo describe **qué** spawnearear, `install.ts` responde si el binario
 * existe. El registro completo se declara en frío: ningún binario se sondea
 * hasta que alguien edita un archivo de ese lenguaje.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { createLogger } from "../logger";
import { findExecutable, type BinaryResolver, type InstallStrategy } from "./install";
import { nearestRoot } from "./workspace";

const log = createLogger("lsp.servers");

/**
 * Dominios ("sistema de dominios") agrupan servidores para poder apagar o
 * consultar por familia completa en lugar de uno por uno.
 */
export type LSPDomain =
  "python" | "web" | "native" | "jvm" | "scripting" | "infra" | "functional" | "scientific";

/** Resultado de resolver un servidor para un archivo concreto. */
export interface SpawnSpec {
  command: string[];
  workspaceRoot: string;
  cwd: string;
  env: Record<string, string>;
  initializationOptions: Record<string, unknown>;
  seedDiagnosticsOnFirstPush: boolean;
}

export interface ServerContext {
  workspaceRoot: string;
  installStrategy: InstallStrategy;
  binaryOverrides: Record<string, string[]>;
  envOverrides: Record<string, Record<string, string>>;
  initOverrides: Record<string, Record<string, unknown>>;
  /** Resolutor de binarios inyectable (por defecto el probe de `install.ts`). */
  findExecutable?: BinaryResolver;
}

export interface ServerDef {
  serverId: string;
  extensions: readonly string[];
  domain: LSPDomain;
  description: string;
  seedFirstPush: boolean;
  resolveRoot: (filePath: string, workspaceRoot: string) => string | null;
  buildSpawn: (root: string, ctx: ServerContext) => SpawnSpec | null;
  matches: (filePath: string) => boolean;
}

/** Language IDs según la spec LSP; se envían en `textDocument/didOpen.languageId`. */
export const LANGUAGE_BY_EXT: Readonly<Record<string, string>> = Object.freeze({
  ".py": "python",
  ".pyi": "python",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  ".ru": "ruby",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hh": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".cs": "csharp",
  ".csx": "csharp",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".swift": "swift",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".jsonc": "jsonc",
  ".lua": "lua",
  ".php": "php",
  ".prisma": "prisma",
  ".dart": "dart",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".tex": "latex",
  ".bib": "bibtex",
  ".gleam": "gleam",
  ".clj": "clojure",
  ".cljs": "clojurescript",
  ".cljc": "clojure",
  ".edn": "clojure",
  ".nix": "nix",
  ".typ": "typst",
  ".typc": "typst",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".jl": "julia",
  ".ex": "elixir",
  ".exs": "elixir",
  ".zig": "zig",
  ".zon": "zig",
  ".dockerfile": "dockerfile",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".psd1": "powershell",
});

/**
 * Extensión en minúsculas, o el basename completo para archivos sin
 * extensión (`Dockerfile`, `Makefile`). El basename se devuelve tal cual,
 * igual que `path.parse(file).ext || file` del origen.
 */
export function fileExtOrBasename(filePath: string): string {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  if (ext) return ext.toLowerCase();
  return base;
}

interface RootSpec {
  markers?: readonly string[];
  excludes?: readonly string[];
  /** `workspace` devuelve la raíz del workspace sin buscar marcadores. */
  mode?: "markers" | "workspace" | "nix";
}

/**
 * Patrón común: intenta `nearestRoot` y cae a la raíz del workspace.
 *
 * Si hay `excludes` y el marcador de exclusión aparece primero, devuelve
 * `null` (servidor apagado para ese archivo), distinguiendo así "sin
 * marcador" de "excluido".
 */
function rootOrWorkspace(filePath: string, workspaceRoot: string, spec: RootSpec): string | null {
  if (spec.mode === "workspace") return workspaceRoot;
  const markers = spec.markers ?? [];
  const ceiling = workspaceRoot ? path.dirname(workspaceRoot) : undefined;
  if (spec.mode === "nix") {
    const found = nearestRoot(filePath, markers);
    return found ?? workspaceRoot;
  }
  const excludes = spec.excludes ?? [];
  const found = nearestRoot(filePath, markers, { excludes, ceiling });
  if (found === null && excludes.length > 0) {
    const recheck = nearestRoot(filePath, markers, { ceiling });
    if (recheck !== null) return null;
    return workspaceRoot;
  }
  return found ?? workspaceRoot;
}

/** Detecta el intérprete del proyecto (`.venv`/`venv` locales; nunca lee env). */
function detectPythonInterpreter(root: string): string | null {
  const candidates = [path.join(root, ".venv"), path.join(root, "venv")];
  const subpaths = ["bin/python", "bin/python3", "Scripts/python.exe"];
  for (const candidate of candidates) {
    for (const subpath of subpaths) {
      const target = path.join(candidate, subpath);
      if (existsSync(target)) return target;
    }
  }
  return null;
}

interface ServerRecipe {
  serverId: string;
  domain: LSPDomain;
  extensions: readonly string[];
  /** Nombres de binario en orden de preferencia. */
  binaryNames: readonly string[];
  /** Clave de overrides (`command`/`env`/`initializationOptions`). */
  overrideKey?: string;
  /** Deriva `pyright` → `pyright-langserver` cuando se halló el CLI. */
  siblingLangServer?: boolean;
  /** Avisa una sola vez si falta una dependencia runtime del servidor. */
  warnMissingDeps?: readonly string[];
  args: readonly string[];
  root: RootSpec;
  init?: Record<string, unknown>;
  seedFirstPush?: boolean;
  description: string;
}

let bashShellcheckWarned = false;

function buildSpawn(recipe: ServerRecipe, root: string, ctx: ServerContext): SpawnSpec | null {
  const overrideKey = recipe.overrideKey ?? recipe.serverId;
  const override = ctx.binaryOverrides[overrideKey];
  let binary = override && override[0] && existsSync(override[0]) ? override[0] : null;
  if (binary === null) {
    const resolver = ctx.findExecutable ?? findExecutable;
    binary = resolver(recipe.binaryNames);
    if (binary === null) return null;
  }
  if (recipe.siblingLangServer) {
    const base = path.basename(binary);
    if (base === "pyright" || base === "pyright.exe") {
      const sibling = path.join(path.dirname(binary), "pyright-langserver");
      if (existsSync(sibling)) binary = sibling;
    }
  }
  if (recipe.warnMissingDeps && !bashShellcheckWarned) {
    const resolver = ctx.findExecutable ?? findExecutable;
    const missing = recipe.warnMissingDeps.filter((dep) => resolver([dep]) === null);
    if (missing.length > 0) {
      bashShellcheckWarned = true;
      log.warn("lsp_server_dependency_missing", {
        server_id: recipe.serverId,
        missing: missing.join(","),
        detail: "el servidor arranca pero no reportará diagnósticos sin esta dependencia",
      });
    }
  }

  const initializationOptions: Record<string, unknown> = { ...(recipe.init ?? {}) };
  if (recipe.serverId === "pyright") {
    const interpreter = detectPythonInterpreter(root);
    if (interpreter) initializationOptions.python = { pythonPath: interpreter };
  }
  Object.assign(initializationOptions, ctx.initOverrides[overrideKey] ?? {});

  return {
    command: [binary, ...recipe.args],
    workspaceRoot: root,
    cwd: root,
    env: ctx.envOverrides[overrideKey] ?? {},
    initializationOptions,
    seedDiagnosticsOnFirstPush: recipe.seedFirstPush ?? false,
  };
}

const RECIPES: readonly ServerRecipe[] = [
  {
    serverId: "pyright",
    domain: "python",
    extensions: [".py", ".pyi"],
    binaryNames: ["pyright-langserver", "pyright"],
    siblingLangServer: true,
    args: ["--stdio"],
    root: {
      markers: [
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "requirements.txt",
        "Pipfile",
        "pyrightconfig.json",
      ],
    },
    description: "Python — Microsoft pyright",
  },
  {
    serverId: "typescript",
    domain: "web",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    binaryNames: ["typescript-language-server"],
    args: ["--stdio"],
    root: {
      markers: [
        "package-lock.json",
        "bun.lockb",
        "bun.lock",
        "pnpm-lock.yaml",
        "yarn.lock",
        "package.json",
        "tsconfig.json",
      ],
      excludes: ["deno.json", "deno.jsonc"],
    },
    seedFirstPush: true,
    description: "JavaScript/TypeScript — typescript-language-server",
  },
  {
    serverId: "vue-language-server",
    domain: "web",
    extensions: [".vue"],
    binaryNames: ["vue-language-server"],
    args: ["--stdio"],
    root: {
      markers: [
        "package-lock.json",
        "bun.lockb",
        "bun.lock",
        "pnpm-lock.yaml",
        "yarn.lock",
        "package.json",
        "tsconfig.json",
      ],
      excludes: ["deno.json", "deno.jsonc"],
    },
    description: "Vue.js — @vue/language-server",
  },
  {
    serverId: "svelte-language-server",
    domain: "web",
    extensions: [".svelte"],
    binaryNames: ["svelteserver", "svelte-language-server"],
    args: ["--stdio"],
    root: {
      markers: [
        "package-lock.json",
        "bun.lockb",
        "bun.lock",
        "pnpm-lock.yaml",
        "yarn.lock",
        "package.json",
        "tsconfig.json",
      ],
      excludes: ["deno.json", "deno.jsonc"],
    },
    description: "Svelte — svelte-language-server",
  },
  {
    serverId: "astro-language-server",
    domain: "web",
    extensions: [".astro"],
    binaryNames: ["astro-ls", "astro-language-server"],
    args: ["--stdio"],
    root: {
      markers: [
        "package-lock.json",
        "bun.lockb",
        "bun.lock",
        "pnpm-lock.yaml",
        "yarn.lock",
        "package.json",
        "tsconfig.json",
      ],
      excludes: ["deno.json", "deno.jsonc"],
    },
    description: "Astro — @astrojs/language-server",
  },
  {
    serverId: "gopls",
    domain: "native",
    extensions: [".go"],
    binaryNames: ["gopls"],
    args: [],
    root: { markers: ["go.work", "go.mod", "go.sum"] },
    description: "Go — gopls",
  },
  {
    serverId: "rust-analyzer",
    domain: "native",
    extensions: [".rs"],
    binaryNames: ["rust-analyzer"],
    args: [],
    root: { markers: ["Cargo.toml", "Cargo.lock"] },
    description: "Rust — rust-analyzer",
  },
  {
    serverId: "clangd",
    domain: "native",
    extensions: [".c", ".cpp", ".cc", ".cxx", ".h", ".hh", ".hpp", ".hxx"],
    binaryNames: ["clangd"],
    args: ["--background-index", "--clang-tidy"],
    root: { markers: ["compile_commands.json", "compile_flags.txt", ".clangd"] },
    description: "C/C++ — clangd",
  },
  {
    serverId: "bash-language-server",
    domain: "scripting",
    extensions: [".sh", ".bash", ".zsh", ".ksh"],
    binaryNames: ["bash-language-server"],
    args: ["start"],
    warnMissingDeps: ["shellcheck"],
    root: { mode: "workspace" },
    description: "Bash — bash-language-server",
  },
  {
    serverId: "yaml-language-server",
    domain: "scripting",
    extensions: [".yaml", ".yml"],
    binaryNames: ["yaml-language-server"],
    args: ["--stdio"],
    root: { mode: "workspace" },
    description: "YAML — yaml-language-server",
  },
  {
    serverId: "lua-language-server",
    domain: "scripting",
    extensions: [".lua"],
    binaryNames: ["lua-language-server"],
    args: [],
    root: {
      markers: [
        ".luarc.json",
        ".luarc.jsonc",
        ".luacheckrc",
        ".stylua.toml",
        "stylua.toml",
        "selene.toml",
        "selene.yml",
      ],
    },
    description: "Lua — lua-language-server",
  },
  {
    serverId: "intelephense",
    domain: "web",
    extensions: [".php"],
    binaryNames: ["intelephense"],
    args: ["--stdio"],
    root: { markers: ["composer.json", "composer.lock", ".php-version"] },
    init: { telemetry: { enabled: false } },
    description: "PHP — intelephense",
  },
  {
    serverId: "ocaml-lsp",
    domain: "functional",
    extensions: [".ml", ".mli"],
    binaryNames: ["ocamllsp"],
    overrideKey: "ocaml-lsp",
    args: [],
    root: { markers: ["dune-project", "dune-workspace", ".merlin", "opam"] },
    description: "OCaml — ocaml-lsp",
  },
  {
    serverId: "dockerfile-ls",
    domain: "infra",
    extensions: [".dockerfile", "Dockerfile"],
    binaryNames: ["docker-langserver"],
    args: ["--stdio"],
    root: { mode: "workspace" },
    description: "Dockerfile — dockerfile-language-server-nodejs",
  },
  {
    serverId: "terraform-ls",
    domain: "infra",
    extensions: [".tf", ".tfvars"],
    binaryNames: ["terraform-ls"],
    args: ["serve"],
    root: { markers: [".terraform.lock.hcl", "terraform.tfstate"] },
    init: { experimentalFeatures: { prefillRequiredFields: true, validateOnSave: true } },
    description: "Terraform — terraform-ls",
  },
  {
    serverId: "dart",
    domain: "web",
    extensions: [".dart"],
    binaryNames: ["dart"],
    args: ["language-server", "--lsp"],
    root: { markers: ["pubspec.yaml", "analysis_options.yaml"] },
    description: "Dart — built-in language server",
  },
  {
    serverId: "haskell-language-server",
    domain: "functional",
    extensions: [".hs", ".lhs"],
    binaryNames: ["haskell-language-server-wrapper", "haskell-language-server"],
    args: ["--lsp"],
    root: { markers: ["stack.yaml", "cabal.project", "hie.yaml"] },
    description: "Haskell — haskell-language-server",
  },
  {
    serverId: "julia",
    domain: "scientific",
    extensions: [".jl"],
    binaryNames: ["julia"],
    args: ["--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"],
    root: { markers: ["Project.toml", "Manifest.toml"] },
    description: "Julia — LanguageServer.jl",
  },
  {
    serverId: "clojure-lsp",
    domain: "functional",
    extensions: [".clj", ".cljs", ".cljc", ".edn"],
    binaryNames: ["clojure-lsp"],
    args: ["listen"],
    root: { markers: ["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"] },
    description: "Clojure — clojure-lsp",
  },
  {
    serverId: "nixd",
    domain: "infra",
    extensions: [".nix"],
    binaryNames: ["nixd"],
    args: [],
    root: { markers: ["flake.nix"], mode: "nix" },
    description: "Nix — nixd",
  },
  {
    serverId: "zls",
    domain: "native",
    extensions: [".zig", ".zon"],
    binaryNames: ["zls"],
    args: [],
    root: { markers: ["build.zig"] },
    description: "Zig — zls",
  },
  {
    serverId: "gleam",
    domain: "functional",
    extensions: [".gleam"],
    binaryNames: ["gleam"],
    args: ["lsp"],
    root: { markers: ["gleam.toml"] },
    description: "Gleam — built-in language server",
  },
  {
    serverId: "elixir-ls",
    domain: "functional",
    extensions: [".ex", ".exs"],
    binaryNames: ["elixir-ls", "language_server.sh"],
    args: [],
    root: { markers: ["mix.exs", "mix.lock"] },
    description: "Elixir — elixir-ls",
  },
  {
    serverId: "prisma",
    domain: "infra",
    extensions: [".prisma"],
    binaryNames: ["prisma"],
    args: ["language-server"],
    root: { markers: ["schema.prisma", "prisma/schema.prisma"] },
    description: "Prisma — built-in language server",
  },
  {
    serverId: "kotlin-language-server",
    domain: "jvm",
    extensions: [".kt", ".kts"],
    binaryNames: ["kotlin-language-server"],
    args: [],
    root: {
      markers: [
        "settings.gradle",
        "settings.gradle.kts",
        "build.gradle",
        "build.gradle.kts",
        "pom.xml",
      ],
    },
    description: "Kotlin — kotlin-language-server",
  },
  {
    serverId: "jdtls",
    domain: "jvm",
    extensions: [".java"],
    binaryNames: ["jdtls"],
    args: [],
    root: {
      markers: [
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        ".project",
        ".classpath",
        "settings.gradle",
      ],
    },
    description: "Java — Eclipse JDT Language Server",
  },
];

function toServerDef(recipe: ServerRecipe): ServerDef {
  const extensionSet = new Set(recipe.extensions);
  return {
    serverId: recipe.serverId,
    extensions: recipe.extensions,
    domain: recipe.domain,
    description: recipe.description,
    seedFirstPush: recipe.seedFirstPush ?? false,
    resolveRoot: (filePath, workspaceRoot) => rootOrWorkspace(filePath, workspaceRoot, recipe.root),
    buildSpawn: (root, ctx) => buildSpawn(recipe, root, ctx),
    matches: (filePath) => extensionSet.has(fileExtOrBasename(filePath)),
  };
}

/** Registro completo de servidores, en orden de precedencia. */
export const SERVERS: readonly ServerDef[] = Object.freeze(RECIPES.map(toServerDef));

/** Devuelve la entrada del registro que maneja `filePath`, o `null`. */
export function findServerForFile(filePath: string): ServerDef | null {
  for (const server of SERVERS) {
    if (server.matches(filePath)) return server;
  }
  return null;
}

/** Devuelve el LSP `languageId` a enviar en didOpen para `filePath`. */
export function languageIdFor(filePath: string): string {
  return LANGUAGE_BY_EXT[fileExtOrBasename(filePath)] ?? "plaintext";
}

/** Dominio del archivo, o `null` si ningún servidor lo maneja. */
export function domainForFile(filePath: string): LSPDomain | null {
  return findServerForFile(filePath)?.domain ?? null;
}

/** IDs de los servidores de un dominio, en orden de registro. */
export function serversInDomain(domain: LSPDomain): string[] {
  return SERVERS.filter((server) => server.domain === domain).map((server) => server.serverId);
}
