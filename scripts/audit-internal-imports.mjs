#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const sourceRoots = ["src", "app", "api"];
// Ordered: plain extensions first (they win over multi-dot pseudo-extensions),
// then the compound extensions this repo actually uses (*.server.ts, *.schema.ts,
// *.skill.ts) which `path.extname()` would otherwise mistake for a real extension.
const sourceExtensions = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".server.ts",
  ".schema.ts",
  ".skill.ts",
];
const ignoredSegments = new Set([
  "node_modules",
  "dist",
  ".output",
  ".vercel",
  ".vinxi",
  "coverage",
  "contrib",
]);
// Generated output is not authored source: never treat it as an import contract.
const excludedDirs = [join(root, "src", "generated")];

function isExcludedDir(dir) {
  return excludedDirs.some(
    (excluded) =>
      dir === excluded || dir.startsWith(excluded + "\\") || dir.startsWith(excluded + "/"),
  );
}

function walk(dir) {
  if (!existsSync(dir) || isExcludedDir(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(file));
    else if (!file.endsWith(".d.ts")) result.push(file);
  }
  return result;
}

function stripQuery(value) {
  return value.split("?")[0].split("#")[0];
}

function resolveInternal(importer, specifier) {
  const clean = stripQuery(specifier);
  const base = clean.startsWith("@/")
    ? resolve(root, "src", clean.slice(2))
    : clean.startsWith(".")
      ? resolve(dirname(importer), clean)
      : null;

  if (!base) return null;

  // Try the specifier as-is, then every extension (including the compound
  // .server.ts / .schema.ts / .skill.ts ones), then index files in a directory.
  // Never strip an extension first: `extname("./x.server")` is ".server", and
  // stripping it would drop the compound suffix and report a false positive.
  const candidates = [base];
  for (const extension of sourceExtensions) candidates.push(base + extension);
  for (const extension of sourceExtensions) candidates.push(join(base, "index" + extension));

  const hit = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (hit) return hit;
  return base;
}

const importPattern =
  /(?:import|export)(?:[\s\S]*?from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const errors = new Map();
const files = sourceRoots
  .flatMap((dir) => walk(resolve(root, dir)))
  .filter((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file));

for (const file of files) {
  const content = readFileSync(file, "utf8");
  importPattern.lastIndex = 0;
  let match;
  while ((match = importPattern.exec(content))) {
    const specifier = match[1] ?? match[2];
    const target = resolveInternal(file, specifier);
    if (!target) continue;
    if (!existsSync(target)) {
      const importer = relative(root, file).replaceAll("\\", "/");
      const key = `${importer} -> ${specifier}`;
      if (!errors.has(key)) {
        errors.set(key, {
          importer,
          specifier,
          expected: relative(root, target).replaceAll("\\", "/"),
        });
      }
    }
  }
}

const findings = [...errors.values()];

if (findings.length) {
  console.error("INTERNAL IMPORT CONTRACT: FAILED");
  for (const error of findings) {
    console.error(`- ${error.importer} -> ${error.specifier} (expected ${error.expected})`);
  }
  process.exit(1);
}

console.log(`INTERNAL IMPORT CONTRACT: PASS — ${files.length} source files inspected.`);
