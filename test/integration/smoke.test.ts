import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SMOKE DE DESPLIEGUE (test/integration/smoke.test.ts)
 * -----------------------------------------------------------------
 * Verificaciones estáticas rápidas de que el artefacto es desplegable:
 * superficie de rutas con endpoints críticos, autoridades completas,
 * toolchain canónica y matriz de capabilities verificada.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("smoke de despliegue", () => {
  it("la superficie de rutas expone los endpoints críticos", () => {
    // Este repo no genera `src/routeTree.gen.ts` (ver types/tanstack-file-routes.d.ts):
    // la superficie efectiva vive en `src/routes/**` (capa activa) y
    // `src/server-routes/**` (canónica), con la misma raíz que genesis-route-audit.
    const criticalRoutes: Record<string, string> = {
      "/api/isabella": "src/routes/api/isabella.ts",
      "/api/billing": "src/server-routes/api/billing.ts",
      "/api/health": "src/server-routes/api/health.ts",
      "/api/db": "src/server-routes/api/db.ts",
      "/api/catalog": "src/server-routes/api/catalog.ts",
    };
    for (const [route, file] of Object.entries(criticalRoutes)) {
      expect(existsSync(resolve(root, file)), `ruta ausente: ${route} (${file})`).toBe(true);
    }
  });

  it("las 6 autoridades de producción están definidas", async () => {
    const { evaluateProductionAuthorities } = await import("@/lib/production-authority");
    const report = evaluateProductionAuthorities();
    expect(report.authorities).toHaveLength(6);
    for (const authority of report.authorities) {
      expect(authority.name.length).toBeGreaterThan(0);
      expect(authority.details.length).toBeGreaterThan(0);
    }
  });

  it("toolchain canónica: packageManager pnpm 10 y workflows sin pnpm 11", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      packageManager?: string;
      engines?: { node?: string };
    };
    expect(pkg.packageManager).toMatch(/^pnpm@10\./);
    expect(pkg.engines?.node).toMatch(/^(>=22|24)/);
    for (const workflow of ["ci.yml", "release.yml", "security.yml"]) {
      const content = readFileSync(resolve(root, `.github/workflows/${workflow}`), "utf8");
      expect(content.includes("version: 11"), `${workflow} usa pnpm 11`).toBe(false);
    }
  });

  it("la matriz de capabilities está generada y verificada", () => {
    const matrix = resolve(root, "docs/operations/CAPABILITY_MATRIX.md");
    expect(existsSync(matrix)).toBe(true);
    const content = readFileSync(matrix, "utf8");
    expect(content.includes("Payment full-loop")).toBe(true);
    expect(content.includes("manual")).toBe(true);
  });

  it("RLS declarada para economic_events y webhook_events (economic_contract)", () => {
    // La migración nombrada `20260906090000_economic_contract_rls.sql` se
    // consolidó en `20260913210000_billing_security_contract.sql`: lo que
    // importa es que el contrato RLS exista en el set de migraciones.
    const migrationsDir = resolve(root, "supabase/migrations");
    const allSql = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(resolve(migrationsDir, file), "utf8"))
      .join("\n");
    for (const table of ["economic_events", "webhook_events"]) {
      const declared = new RegExp(
        `alter\\s+table\\s+[^;]*\\b${table}\\b[^;]*enable\\s+row\\s+level\\s+security`,
        "i",
      ).test(allSql);
      expect(declared, `RLS no declarada para ${table}`).toBe(true);
    }
  });

  it("configuración de deploy Vercel: Nitro + pnpm + output prebuilt", () => {
    // Nitro auto-detecta el preset Vercel (el build local emite .vercel/output);
    // el override de `functions` fue retirado por ser rechazado por el proveedor.
    const viteConfig = readFileSync(resolve(root, "vite.config.ts"), "utf8");
    expect(viteConfig.includes("nitro/vite"), "falta plugin nitro en vite.config").toBe(true);
    expect(viteConfig.includes("nitro()"), "falta nitro() canónico en vite.config").toBe(true);
    expect(viteConfig.includes("vercel: { functions"), "no debe haber override de functions").toBe(
      false,
    );

    const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as {
      installCommand?: string;
      outputDirectory?: string;
    };
    expect(vercel.installCommand).toContain("pnpm");
    expect(vercel.outputDirectory).toBe(".vercel/output");

    // Nitro debe estar resoluble en el closure instalado (lockfile).
    // Nota: es dep directa pineada; si pasa a import directo,
    // fijar también package.json + importers del lockfile.
    const lockfile = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
    expect(lockfile.includes("nitro@3.0.260603-beta"), "nitro ausente del lockfile").toBe(true);
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(pkg.devDependencies?.nitro, "nitro debe ser dependencia directa").toBeDefined();
  });

  it("registro IGDS: migración append-only y repositorio Postgres", async () => {
    const migration = resolve(root, "supabase/migrations/20260917120000_igds_genesis_registry.sql");
    expect(existsSync(migration)).toBe(true);
    const sql = readFileSync(migration, "utf8");
    for (const fragment of [
      "CREATE TABLE IF NOT EXISTS public.igds_entries",
      "CREATE TABLE IF NOT EXISTS public.igds_checkpoints",
      "CREATE TABLE IF NOT EXISTS public.igds_revocations",
      "trg_prevent_igds_entries_update",
      "trg_prevent_igds_entries_delete",
      "ENABLE ROW LEVEL SECURITY",
    ]) {
      expect(sql.includes(fragment), `migración IGDS sin: ${fragment}`).toBe(true);
    }
    const { createPostgresGenesisRegistry } =
      await import("@/lib/repositories/igds-genesis-repository");
    const registry = createPostgresGenesisRegistry();
    expect(typeof registry.appendSeal).toBe("function");
    expect(typeof registry.appendRevocation).toBe("function");
    expect(typeof registry.leafHashes).toBe("function");
  });
});
