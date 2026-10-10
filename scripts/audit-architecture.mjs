#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = process.cwd();
const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs"]);
const ignored = new Set(["node_modules", ".git", "dist", ".output", ".vercel", "coverage"]);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (codeExtensions.has(extname(entry.name))) files.push(full);
  }
  return files;
}

function resolveImport(fromFile, rawSpecifier) {
  const specifier = rawSpecifier.split("?", 1)[0];
  let base;
  if (specifier.startsWith("@/")) base = join(root, "src", specifier.slice(2));
  else if (specifier.startsWith("./") || specifier.startsWith("../"))
    base = resolve(join(fromFile, ".."), specifier);
  else return true;
  return [
    base,
    base + ".ts",
    base + ".tsx",
    base + ".js",
    base + ".jsx",
    base + ".mjs",
    base + ".mts",
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.js"),
    join(base, "index.mjs"),
  ].some(existsSync);
}

const files = walk(root);
const errors = [];
const hashes = new Map();

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const relative = file.slice(root.length + 1).replaceAll("\\", "/");
  const digest = createHash("sha256").update(content).digest("hex");
  const group = hashes.get(digest) ?? [];
  group.push(relative);
  hashes.set(digest, group);

  if (relative.startsWith("src/generated/prisma/")) continue;

  for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (!resolveImport(file, match[1]))
      errors.push("BROKEN_LOCAL_IMPORT: " + relative + " -> " + match[1]);
  }
  for (const match of content.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    if (!resolveImport(file, match[1]))
      errors.push("BROKEN_LOCAL_IMPORT: " + relative + " -> " + match[1]);
  }
}

for (const group of hashes.values()) {
  if (group.length < 2) continue;
  const contents = group.map((relative) => readFileSync(join(root, relative), "utf8").trim());
  const allFacades = contents.every((value) =>
    value.split("\n").every((line) => !line.trim() || line.trim().startsWith("export ")),
  );
  if (!allFacades) errors.push("DUPLICATE_IMPLEMENTATION: " + group.join(" <-> "));
}

if (errors.length) {
  console.error("ARCHITECTURE-AUDIT: FAILED");
  for (const error of [...new Set(errors)]) console.error("- " + error);
  process.exit(1);
}
console.log("ARCHITECTURE-AUDIT: PASS — " + files.length + " code files scanned.");
