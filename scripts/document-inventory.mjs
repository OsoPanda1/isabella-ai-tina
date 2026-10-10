import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import mammoth from "mammoth";

const ROOT = process.cwd();
const OUTPUT = join(ROOT, "genesis/reports/document-inventory-latest.json");
const INCLUDED = new Set([".md", ".mdx", ".txt", ".docx"]);
const IGNORED = new Set(["node_modules", ".git", "dist", ".output", ".next", "coverage"]);
const KEYWORDS = [
  ["architecture", /arquitectura|architecture|blueprint|kernel|atlas/i],
  ["governance", /gobernanza|governance|policy|constituci[oó]n|oversight/i],
  ["security", /seguridad|security|blindaje|threat|crypto|secrets|harden/i],
  ["intelligence", /inteligencia|intelligence|moe|expert|modelo|machine learning|ml/i],
  ["operations", /operaci[oó]n|operations|deploy|producci[oó]n|slo|runbook/i],
  ["territory", /territorio|real del monte|atlas|patrimonio|hist[oó]rico/i],
  ["api", /\bapi\b|endpoint|route|sdk|librer[ií]a/i],
];

function walk(dir, result = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, result);
    else if (
      INCLUDED.has(join(".", entry.name).slice(-5)) ||
      /\.(md|mdx|txt|docx)$/.test(entry.name)
    )
      result.push(full);
  }
  return result;
}

function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function classify(text, file) {
  const categories = KEYWORDS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  if (file.includes("_archive")) categories.push("historical");
  if (file.endsWith(".docx")) categories.push("source-attachment");
  return [...new Set(categories)].sort();
}

async function summarize(file) {
  const ext = file.slice(file.lastIndexOf("."));
  if (ext !== ".docx") {
    const text = readFileSync(file, "utf8");
    return {
      characters: text.length,
      headings: (text.match(/^#{1,6}\s/gm) ?? []).length,
      categories: classify(text, file),
    };
  }
  const extracted = await mammoth.extractRawText({ path: file });
  const text = extracted.value.replace(/\s+/g, " ");
  return {
    characters: text.length,
    headings: 0,
    categories: classify(text, file),
    preview: text.slice(0, 280),
  };
}

const files = walk(ROOT).sort();
const records = [];
for (const file of files) {
  const relativePath = relative(ROOT, file).replaceAll("\\", "/");
  records.push({
    path: relativePath,
    bytes: statSync(file).size,
    sha256: hashFile(file),
    ...(await summarize(file)),
  });
}

const groups = new Map();
for (const record of records) {
  const list = groups.get(record.sha256) ?? [];
  list.push(record.path);
  groups.set(record.sha256, list);
}
const exactDuplicates = [...groups.values()].filter((paths) => paths.length > 1);
const report = {
  generatedAt: new Date().toISOString(),
  policy: "Inventory only: no file is deleted or promoted to canonical authority automatically.",
  files: records,
  exactDuplicates,
  counts: {
    total: records.length,
    markdown: records.filter((record) => /\.mdx?$/.test(record.path)).length,
    text: records.filter((record) => record.path.endsWith(".txt")).length,
    word: records.filter((record) => record.path.endsWith(".docx")).length,
    exactDuplicateGroups: exactDuplicates.length,
  },
};

writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.counts, null, 2));
if (exactDuplicates.length) {
  console.log("Exact duplicate groups:");
  for (const paths of exactDuplicates) console.log(`- ${paths.join(" | ")}`);
}
