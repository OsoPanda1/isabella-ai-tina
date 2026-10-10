#!/usr/bin/env node
/**
 * scripts/verify-recipe.mjs — run-recipe estático y manifiesto de entorno
 * -----------------------------------------------------------------------
 * Detecta, sin ejecutar nada, el run-recipe de verificación del repo:
 * gestor de paquetes (por lockfile), runtime/framework declarado en
 * package.json y los scripts reales de install/typecheck/lint/test/build/
 * verify. El resultado se persiste como manifiesto de entorno determinista.
 *
 *   node scripts/verify-recipe.mjs           # regenera e imprime el manifiesto
 *   node scripts/verify-recipe.mjs --check   # exit 1 si el manifiesto versionado no coincide
 *
 * El manifiesto solo contiene hechos no secretos: nombres de scripts,
 * versiones declaradas, gestor de paquetes y hashes de contenido. Nunca
 * escribe valores de entorno, credenciales ni rutas absolutas.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "isabella.verify.environment-manifest";
export const SCHEMA_VERSION = 1;
export const MANIFEST_RELATIVE_PATH = "genesis/reports/environment-manifest-latest.json";

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
];

const FRAMEWORK_MARKERS = [
  ["@tanstack/react-start", "tanstack-react-start"],
  ["@tanstack/react-router", "tanstack-react-router"],
  ["@tanstack/react-query", "tanstack-react-query"],
  ["next", "next"],
  ["react-dom", "react-dom"],
  ["react", "react"],
  ["vite", "vite"],
];

const FRAMEWORK_KINDS = [
  ["@tanstack/react-start", "tanstack-start", "TanStack Start"],
  ["next", "nextjs", "Next.js"],
  ["vite", "vite", "Vite"],
  ["react", "react", "React"],
];

const ROLE_CANDIDATES = {
  typecheck: ["typecheck", "check:types"],
  lint: ["lint", "lint:check"],
  test: ["test", "tests"],
  build: ["build"],
  verify: ["verify"],
};

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJson(path) {
  const text = readText(path);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(path) {
  return sha256(readFileSync(path));
}

function parsePackageManagerSpec(spec) {
  if (typeof spec !== "string" || spec.trim() === "") return null;
  const value = spec.trim();
  const at = value.lastIndexOf("@");
  if (at <= 0) return { name: value, version: null };
  const version = value.slice(at + 1).split("+")[0];
  return { name: value.slice(0, at), version: version === "" ? null : version };
}

/**
 * Detecta el gestor de paquetes por los lockfiles presentes en `root`
 * (mismos candidatos y orden que SupplyChainScanner.findLockfiles) y la
 * versión declarada en `package.json#packageManager`.
 */
export function detectPackageManager(root) {
  const lockfiles = LOCKFILES.map(([file]) => file).filter((file) => existsSync(join(root, file)));
  const lockfile = lockfiles[0] ?? null;
  const primary = LOCKFILES.find(([file]) => file === lockfile);
  const declared = parsePackageManagerSpec(readJson(join(root, "package.json"))?.packageManager);
  return {
    name: primary ? primary[1] : (declared?.name ?? null),
    version: declared?.version ?? null,
    lockfile,
    lockfiles,
  };
}

/**
 * Detecta el framework declarado a partir de las dependencias de
 * `package.json`. `markers` son las marcas presentes, ordenadas
 * alfabéticamente para que la serialización sea estable.
 */
export function detectFramework(pkg) {
  const source = pkg !== null && typeof pkg === "object" ? pkg : {};
  const dependencies = { ...(source.dependencies ?? {}), ...(source.devDependencies ?? {}) };
  const markers = FRAMEWORK_MARKERS.filter(([dependency]) => dependency in dependencies)
    .map(([, marker]) => marker)
    .sort();
  const match = FRAMEWORK_KINDS.find(([dependency]) => dependency in dependencies);
  return {
    kind: match ? match[1] : "node",
    label: match ? match[2] : "Node.js",
    markers,
  };
}

function scriptRunner(packageManager, script) {
  if (packageManager === "pnpm") return `pnpm ${script}`;
  if (packageManager === "yarn") return `yarn ${script}`;
  if (packageManager === "bun") return `bun run ${script}`;
  return `npm run ${script}`;
}

function resolveScriptName(scripts, role) {
  for (const candidate of ROLE_CANDIDATES[role]) {
    if (typeof scripts[candidate] === "string" && scripts[candidate].trim() !== "")
      return candidate;
  }
  if (role === "verify") {
    const prefixed = Object.keys(scripts)
      .filter((name) => name.startsWith("verify:"))
      .sort();
    if (prefixed.length > 0) return prefixed[0];
  }
  return null;
}

function resolveInstall(root, packageManager) {
  const declared = readJson(join(root, "vercel.json"))?.installCommand;
  const command = typeof declared === "string" ? declared.trim() : "";
  if (command !== "" && (command === packageManager || command.startsWith(`${packageManager} `)))
    return { script: null, command };
  return { script: null, command: `${packageManager} install` };
}

/**
 * Resuelve, por rol, el script real de `package.json` y su invocación con
 * el gestor de paquetes detectado. Un rol sin script declarado queda en
 * `null`: nunca se asume el nombre de un script que no existe.
 */
export function resolveScripts(root, pkg, packageManager) {
  const source = pkg !== null && typeof pkg === "object" ? pkg : {};
  const scripts =
    source.scripts !== null && typeof source.scripts === "object" ? source.scripts : {};
  const pm = packageManager ?? "npm";
  const resolve = (role) => {
    const script = resolveScriptName(scripts, role);
    return { script, command: script === null ? null : scriptRunner(pm, script) };
  };
  return {
    install: resolveInstall(root, pm),
    typecheck: resolve("typecheck"),
    lint: resolve("lint"),
    test: resolve("test"),
    build: resolve("build"),
    verify: resolve("verify"),
  };
}

/**
 * Construye el manifiesto de entorno del repositorio en `root`.
 * Lanza si `package.json` está ausente o no es JSON válido.
 */
export function buildEnvironmentManifest(root) {
  const pkg = readJson(join(root, "package.json"));
  if (pkg === null)
    throw new Error("package.json ausente o ilegible: no se puede derivar el run-recipe.");
  const packageManager = detectPackageManager(root);
  const packageJsonSha256 = fileSha256(join(root, "package.json"));
  const lockfileSha256 = packageManager.lockfile
    ? fileSha256(join(root, packageManager.lockfile))
    : null;
  const nvmrc = readText(join(root, ".nvmrc"));
  return {
    schema: SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    project: {
      name: typeof pkg.name === "string" ? pkg.name : null,
      version: typeof pkg.version === "string" ? pkg.version : null,
    },
    packageManager,
    runtime: {
      node: typeof pkg.engines?.node === "string" ? pkg.engines.node : null,
      nvmrc: nvmrc === null ? null : nvmrc.trim() === "" ? null : nvmrc.trim(),
    },
    framework: detectFramework(pkg),
    scripts: resolveScripts(root, pkg, packageManager.name),
    integrity: {
      packageJsonSha256,
      lockfileSha256,
      contentHash: sha256(`${packageJsonSha256}\n${lockfileSha256 ?? ""}`),
    },
  };
}

/** Serializa el manifiesto con formato estable (2 espacios + newline final). */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Ruta absoluta del manifiesto de entorno del proyecto en `root`. */
export function manifestPath(root) {
  return join(root, MANIFEST_RELATIVE_PATH);
}

/**
 * Carga el manifiesto versionado tolerando archivos ausentes o corruptos:
 * cualquier problema de lectura o forma devuelve `null` en lugar de lanzar.
 */
export function loadManifest(root) {
  const text = readText(manifestPath(root));
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function diffManifest(committedText, expected) {
  let committed;
  try {
    committed = JSON.parse(committedText);
  } catch {
    return ["el manifiesto versionado no es JSON válido"];
  }
  if (committed === null || typeof committed !== "object" || Array.isArray(committed))
    return ["el manifiesto versionado no es un objeto JSON"];
  const differences = [];
  for (const key of Object.keys(expected)) {
    if (!(key in committed) || JSON.stringify(committed[key]) !== JSON.stringify(expected[key])) {
      const actual = key in committed ? JSON.stringify(committed[key]) : "<ausente>";
      differences.push(`${key}: ${actual} != ${JSON.stringify(expected[key])}`);
    }
  }
  if (differences.length === 0)
    differences.push("serialización no canónica: mismo contenido, bytes distintos");
  return differences;
}

/**
 * Compara el manifiesto versionado con el que se deriva del estado actual
 * del repo. `differences` lista las claves de primer nivel discordantes.
 */
export function checkManifest(root) {
  const expected = buildEnvironmentManifest(root);
  const committed = readText(manifestPath(root));
  if (committed === null)
    return { ok: false, differences: [`manifiesto ausente: ${MANIFEST_RELATIVE_PATH}`] };
  if (committed === serializeManifest(expected)) return { ok: true, differences: [] };
  return { ok: false, differences: diffManifest(committed, expected) };
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    if (argv.includes("--check")) {
      const result = checkManifest(root);
      if (!result.ok) {
        console.error(
          `RECIPE-MANIFEST: FAILED — ${MANIFEST_RELATIVE_PATH} no coincide con el repositorio.`,
        );
        for (const difference of result.differences) console.error(`- ${difference}`);
        console.error("Regenera con: node scripts/verify-recipe.mjs");
        process.exit(1);
      }
      console.log(
        `RECIPE-MANIFEST: PASS — ${MANIFEST_RELATIVE_PATH} refleja el estado actual del repositorio.`,
      );
      return;
    }
    const manifest = buildEnvironmentManifest(root);
    const text = serializeManifest(manifest);
    mkdirSync(dirname(manifestPath(root)), { recursive: true });
    writeFileSync(manifestPath(root), text);
    console.log(`RECIPE-MANIFEST: manifiesto escrito en ${MANIFEST_RELATIVE_PATH}`);
    console.log(text);
  } catch (error) {
    console.error(`RECIPE-MANIFEST: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2));
}
