#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, dirname, join, resolve } from "node:path";

const root = process.cwd();
const sourceRoots = ["src", "app", "api"];
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"];
const ignoredSegments = new Set(["node_modules", "dist", ".output", ".vercel", ".vinxi", "coverage", "contrib"]);

function walk(dir) {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(file));
    else result.push(file);
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

  const candidates = [base];
  const ext = extname(base);
  if (!ext) {
    for (const extension of sourceExtensions) candidates.push(base + extension);
    for (const extension of sourceExtensions) candidates.push(join(base, "index" + extension));
  } else if (existsSync(base)) {
    return base;
  } else {
    const withoutExt = base.slice(0, -ext.length);
    for (const extension of sourceExtensions) candidates.push(withoutExt + extension);
    for (const extension of sourceExtensions) candidates.push(join(withoutExt, "index" + extension));
  }

  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? base;
}

const importPattern = /(?:import|export)(?:[\s\S]*?from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const errors = [];
const files = sourceRoots.flatMap((dir) => walk(resolve(root, dir)))
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
      errors.push({
        importer: file.replace(root + "/", "").replaceAll("\\", "/"),
        specifier,
        expected: target.replace(root + "/", "").replaceAll("\\", "/"),
      });
    }
  }
}

if (errors.length) {
  console.error("INTERNAL IMPORT CONTRACT: FAILED");
  for (const error of errors) {
    console.error(`- ${error.importer} -> ${error.specifier} (expected ${error.expected})`);
  }
  process.exit(1);
}

console.log(`INTERNAL IMPORT CONTRACT: PASS — ${files.length} source files inspected.`);
