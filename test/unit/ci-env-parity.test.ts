import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PARIDAD CI ↔ PRODUCCIÓN (test/unit/ci-env-parity.test.ts)
 * -----------------------------------------------------------------
 * CI == Production Readiness: el conjunto de secretos que validan los
 * jobs env-check (ci.yml, release.yml) debe ser EXACTAMENTE el conjunto
 * requiredEnvKeys("production") de src/lib/env-schema.ts, menos NODE_ENV
 * (tiene default y no es secreto). Ni más (APP_URL) ni menos
 * (CROWN/AEGIS/BookPI/Stripe). Cualquier deriva rompe este test.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function checkedVars(workflow: string): Set<string> {
  const content = readFileSync(resolve(root, workflow), "utf8");
  const vars = new Set<string>();
  // Captura `for VAR in A B C` y `REQUIRED_VARS=(A B C)`.
  for (const match of content.matchAll(/for VAR in ([A-Z_ ]+);/g)) {
    for (const name of match[1].trim().split(/\s+/)) vars.add(name);
  }
  for (const match of content.matchAll(/REQUIRED_VARS=\(([^)]+)\)/g)) {
    for (const name of match[1].trim().split(/\s+/)) vars.add(name);
  }
  return vars;
}

describe("paridad CI ↔ producción", () => {
  it("release.yml exige el conjunto canónico de producción", async () => {
    const { requiredEnvKeys } = await import("@/lib/env-schema");
    const canonical: string[] = (requiredEnvKeys("production") as string[]).filter(
      (key) => key !== "NODE_ENV",
    );

    for (const workflow of [".github/workflows/release.yml"]) {
      const checked = checkedVars(workflow);
      const missing = canonical.filter((key) => !checked.has(key));
      const extra = [...checked].filter((key) => !canonical.includes(key));
      expect(missing, `${workflow} omite: ${missing.join(", ")}`).toEqual([]);
      expect(extra, `${workflow} exige de más: ${extra.join(", ")}`).toEqual([]);
    }
  });

  it("todo secreto CI tiene mapeo env: desde secrets", () => {
    for (const workflow of [".github/workflows/release.yml"]) {
      const content = readFileSync(resolve(root, workflow), "utf8");
      const checked = checkedVars(workflow);
      for (const name of checked) {
        expect(
          content.includes(`${name}: \${{ secrets.${name} }}`),
          `${workflow}: ${name} sin mapeo env desde secrets`,
        ).toBe(true);
      }
    }
  });
});
