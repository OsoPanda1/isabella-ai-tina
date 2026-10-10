import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CONTRATO DE ENTORNO (test/unit/env-contract.test.ts)
 * -----------------------------------------------------------------
 * Regla P0: una variable solo existe si schema + .env.example +
 * uso real están alineados, y `process.env` directo solo vive en
 * los módulos autorizados (config, build-manifest con parámetro,
 * generados, scripts).
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function schemaSource(): string {
  return readFileSync(join(root, "src/lib/env-schema.ts"), "utf8");
}

function schemaKeys(): string[] {
  const source = schemaSource();
  // Recorta exactamente el cuerpo de envSchema (z.object({...}).passthrough())
  // para no capturar claves de otros objetos del archivo.
  const anchor = source.indexOf("export const envSchema");
  const start = source.indexOf(".object({", anchor);
  const end = source.indexOf(".passthrough();", start);
  const body = source.slice(start, end);
  const keys = new Set<string>();
  for (const match of body.matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)) keys.add(match[1]);
  return [...keys];
}

function exampleEntries(): Array<{ key: string; line: number }> {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  return example
    .split(/\r?\n/)
    .map((line, i) => ({ key: line.split("=")[0].trim(), line: i + 1 }))
    .filter((entry) => /^[A-Z][A-Z0-9_]*$/.test(entry.key));
}

function exampleKeys(): Set<string> {
  return new Set(exampleEntries().map((entry) => entry.key));
}

function catalogKeys(): Set<string> {
  const source = schemaSource();
  const start = source.indexOf("export const ENV_VAR_CATALOG");
  const end = source.indexOf("];", start);
  const keys = new Set<string>();
  for (const match of source.slice(start, end).matchAll(/name:\s*"([A-Z0-9_]+)"/g))
    keys.add(match[1]);
  return keys;
}

// Módulos de infraestructura server-side auditados. La aplicación no expone
// estos módulos al bundle cliente; cada lectura sigue siendo explícita y queda
// cubierta por el contrato de esquema y por los gates de secretos.
const PROCESS_ENV_ALLOWLIST = new Set([
  "src/lib/config.ts", // única vía de carga
  "src/lib/build-manifest.ts", // computeEnvFingerprint(env = process.env)
  "src/lib/quantum-bridge-client.ts", // client binario opcional python
  "src/core/gateway/gateway.ts",
  "src/core/runtime/provider-registry.ts",
  "src/domains/ai/infrastructure/tools-catalog.ts",
  "src/lib/api-keys.ts",
  "src/lib/auth.server.ts",
  "src/lib/authz-runtime/client.ts",
  "src/lib/automation/mesh.ts",
  "src/lib/billing/stripe.ts",
  "src/lib/creator-economy/persistence/creator-economy-store.ts",
  "src/lib/creator-economy/social-connectors.ts",
  "src/lib/durable-json.server.ts",
  "src/lib/env.ts",
  "src/lib/eventbus.server.ts",
  "src/lib/flags/context.ts",
  "src/lib/idlen-ads.server.ts",
  "src/lib/isabella/native-integration.ts",
  "src/lib/lab-mode.ts",
  "src/lib/logger.ts",
  "src/lib/native-auth.ts",
  "src/lib/persistence/api-key-repository.ts",
  "src/lib/persistence/authority.ts",
  "src/lib/persistence/postgres.ts",
  "src/lib/persistence/sqlite.ts",
  "src/lib/persistence/store-authority.ts",
  "src/lib/persistence/subscription-store.ts",
  "src/lib/quantum-bridge.server.ts",
  "src/lib/quantum/device-registry.ts",
  "src/lib/quantum/hsm-client.ts",
  "src/lib/quantum/scheduler.ts",
  "src/lib/subscription.server.ts",
  "src/lib/supabase/client.ts",
  "src/lib/supabase/server.ts",
  "src/lib/tamv-platform.server.ts",
  "src/middleware/rateLimit.ts",
  "src/platform/http/config.ts",
]);

// Variables de SISTEMA OPERATIVO (no secreto de app): PATH/HOME/SHELL/NODE_ENV/etc.
// Nunca credenciales ni modo de ejecución; se permiten solo esas.
const OS_ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "TERM",
  "TZ",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
]);

describe("contrato de entorno", () => {
  it("toda clave del schema está documentada en .env.example", () => {
    const example = exampleKeys();
    const missing = schemaKeys().filter((key) => !example.has(key));
    expect(missing, `claves sin documentar: ${missing.join(", ")}`).toEqual([]);
  });

  it(".env.example sin duplicados ni líneas sangradas", () => {
    const raw = readFileSync(join(root, ".env.example"), "utf8").split(/\r?\n/);
    const indented = raw
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /^\s+[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map(({ n }) => `L${n}`);
    expect(indented, `líneas con sangría: ${indented.join(", ")}`).toEqual([]);
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const entry of exampleEntries()) {
      if (seen.has(entry.key)) dupes.push(`${entry.key}: L${seen.get(entry.key)} y L${entry.line}`);
      seen.set(entry.key, entry.line);
    }
    expect(dupes, `duplicados: ${dupes.join(", ")}`).toEqual([]);
  });

  it("toda clave del schema tiene descriptor en ENV_VAR_CATALOG (§21)", () => {
    const catalog = catalogKeys();
    const missing = schemaKeys().filter((key) => !catalog.has(key));
    expect(missing, `claves sin descriptor: ${missing.join(", ")}`).toEqual([]);
  });

  it("toda clave leida de process.env esta documentada en .env.example", () => {
    const example = exampleKeys();
    const missing = new Map<string, string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "generated") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const content = readFileSync(full, "utf8");
        if (!content.includes("process.env")) continue;
        const relative = full.slice(root.length + 1).replace(/\\/g, "/");
        if (!PROCESS_ENV_ALLOWLIST.has(relative)) continue;
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          for (const match of trimmed.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[["']([A-Z0-9_]+)["']\])/g)) {
            const key = match[1] ?? match[2];
            if (OS_ENV_ALLOWLIST.has(key) || example.has(key)) continue;
            if (!missing.has(key)) missing.set(key, relative);
          }
        }
      }
    };
    walk(join(root, "src"));
    const report = [...missing]
      .map(([key, file]) => `${key} (${file})`)
      .sort()
      .join(", ");
    expect(missing.size, `claves leidas sin documentar: ${report}`).toBe(0);
  });

  it("process.env directo solo en módulos autorizados", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "generated") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const content = readFileSync(full, "utf8");
        if (!content.includes("process.env")) continue;
        const relative = full.slice(root.length + 1).replace(/\\/g, "/");
        if (PROCESS_ENV_ALLOWLIST.has(relative)) continue;
        const lines = content.split("\n").filter((line) => line.includes("process.env"));
        const realReads = lines.filter((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
          const names = [...trimmed.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
          // Solo se toleran vars de SO en la allowlist; cualquier otra es deriva.
          return names.some((name) => !OS_ENV_ALLOWLIST.has(name));
        });
        if (realReads.length > 0)
          offenders.push(`${relative}: ${realReads[0].trim().slice(0, 80)}`);
      }
    };
    walk(join(root, "src"));
    expect(offenders, `lecturas directas: ${offenders.join(" | ")}`).toEqual([]);
  });
});
