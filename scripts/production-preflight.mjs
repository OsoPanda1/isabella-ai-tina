import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Nitro auto-detects the Vercel preset and already emits the effective
 * `runtime: "nodejs24.x"` pin into each `.vercel/output/functions/<name>/.vc-config.json`.
 * Validating the built artifact is stronger than matching a config string and
 * keeps the gate working when the adapter is configured implicitly.
 */
function builtVercelRuntime24(root) {
  const functionsDir = resolve(root, ".vercel/output/functions");
  if (!existsSync(functionsDir)) return false;
  for (const entry of readdirSync(functionsDir)) {
    const vcConfig = resolve(functionsDir, entry, ".vc-config.json");
    if (!existsSync(vcConfig)) continue;
    try {
      const config = JSON.parse(readFileSync(vcConfig, "utf8"));
      if (config.runtime === "nodejs24.x") return true;
    } catch {
      continue;
    }
  }
  return false;
}

const root = process.cwd();
const jsonOutput = process.argv.includes("--json");
const phases = {
  STATIC_PREFLIGHT: "running",
  EXTERNAL_DEPENDENCY_PREFLIGHT: "not-run",
  RUNTIME_PREFLIGHT: "not-run",
};
const required = [
  "package.json",
  "pnpm-lock.yaml",
  "vercel.json",
  "vite.config.ts",
  ".nvmrc",
  "src/routes/index.tsx",
  "app/api/isabella/chat/route.ts",
  "src/server.ts",
  "src/lib/isabella-chat-gateway.ts",
  "src/lib/api-contracts.ts",
  "src/lib/config.ts",
  "src/lib/principal-context.ts",
  "src/lib/production-authority.ts",
  "src/lib/runtime-integrity.ts",
  "src/lib/persistence/repository-factory.ts",
  "docs/architecture/RUNTIME-AUTHORITY-MAP.md",
  "src/server-routes/api/health.ts",
  "src/lib/intelligence/router.ts",
  "src/lib/intelligence/durable-model-registry.ts",
  "src/lib/intelligence/production-model-gate.ts",
  "src/lib/ai-governance.ts",
  "src/server-routes/api/ai-transparency.ts",
  "src/routes/api/ai/transparency.ts",
  "supabase/migrations/20260908123000_fgais_model_runtime_registry.sql",
  "supabase/migrations/20260912220000_align_bookpi_runtime_contract.sql",
  ".env.example",
  "scripts/db-neon-preflight.mjs",
  "scripts/db-migrate.mjs",
];
const errors = [];
for (const file of required) if (!existsSync(resolve(root, file))) errors.push(`missing:${file}`);
if (existsSync(resolve(root, "src/server-routes/api/isabella.ts")))
  errors.push("legacy duplicate src/server-routes/api/isabella.ts must not exist");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (!/^pnpm@10\.(15\.4|34\.5)$/.test(pkg.packageManager))
  errors.push("packageManager must be pnpm@10.15.4 or pnpm@10.34.5 (Vercel latest-10)");
const nodeEnginePinOk =
  pkg.engines?.node === "24.x" ||
  pkg.engines?.node === "^24.0.0" ||
  pkg.engines?.node === ">=22 <25";
if (!nodeEnginePinOk)
  errors.push(
    "engines.node must pin Node 24.x (or legacy >=22 <25) for deterministic production runtime",
  );
for (const script of [
  "build",
  "start",
  "typecheck",
  "lint",
  "test",
  "db:migrate",
  "db:neon:preflight",
  "db:verify",
  "production:preflight",
  "production:gate",
])
  if (!pkg.scripts?.[script]) errors.push(`missing npm script:${script}`);
const nvm = readFileSync(resolve(root, ".nvmrc"), "utf8").trim();
if (nvm !== "24.11.0") errors.push(".nvmrc must pin Node 24.11.0");
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
const vercelUsesNitroPreset =
  vercel.framework === null &&
  typeof vercel.buildCommand === "string" &&
  vercel.buildCommand.includes("NITRO_PRESET=vercel");
const vercelUsesTanStackPreset = vercel.framework === "tanstack-start";
if (!vercelUsesNitroPreset && !vercelUsesTanStackPreset)
  errors.push(
    "vercel.json must use either tanstack-start framework or the canonical Nitro Vercel preset",
  );
if (vercel.installCommand !== "pnpm install --frozen-lockfile")
  errors.push(
    "Vercel installCommand must use pnpm install --frozen-lockfile for deterministic production installs",
  );
const viteConfig = readFileSync(resolve(root, "vite.config.ts"), "utf8");
if (!viteConfig.includes("tanstackStart("))
  errors.push("vite.config must use TanStack Start plugin");
if (!viteConfig.includes("nitro(")) errors.push("vite.config must use the Nitro output adapter");
const nodeEnginePinsVercel24 = pkg.engines?.node === "24.x" || pkg.engines?.node === "^24.0.0";
if (
  !nodeEnginePinsVercel24 &&
  !viteConfig.includes('runtime: "nodejs24.x"') &&
  !builtVercelRuntime24(root)
)
  errors.push(
    "Production runtime must pin Node 24.x via package.json engines, vite config, or built .vercel/output artifact",
  );
const server = readFileSync(resolve(root, "src/server.ts"), "utf8");
if (/public-chat/i.test(server))
  errors.push("server.ts must not expose the emergency public-chat demo gateway");
if (/GEMINI_API_KEY.*generateContent/s.test(server))
  errors.push("server.ts must not contain a direct demo Gemini implementation");
const route = readFileSync(resolve(root, "src/routes/index.tsx"), "utf8");
if (route.includes("CROWN-SSR-01"))
  errors.push("root route must not be the emergency recovery page");
const gateway = readFileSync(resolve(root, "src/lib/isabella-chat-gateway.ts"), "utf8");
for (const [pattern, label] of [
  ["createSovereignPipeline", "sovereign governance"],
  ["checkRateLimitDistributed", "distributed rate limiting"],
  ['isKilled("inference")', "inference kill-switch"],
  ["GEMINI_API_KEY", "Gemini provider contract"],
  ["GROQ_API_KEY", "Groq provider contract"],
  ["XAI_API_KEY", "xAI provider contract"],
])
  if (!gateway.includes(pattern)) errors.push(`canonical Isabella gateway missing ${label}`);
const principal = readFileSync(resolve(root, "src/lib/principal-context.ts"), "utf8");
if (principal.includes('cfg.ALLOW_GUEST_CHAT === true || cfg.NODE_ENV === "development"'))
  errors.push("principal-context contains an unsafe development guest bypass");
if (!principal.includes("isExplicitDevelopmentAuth"))
  errors.push("principal-context must centralize explicit development auth");
if (!principal.includes("canUseGuestChat"))
  errors.push("principal-context must centralize guest-chat policy");
const config = readFileSync(resolve(root, "src/lib/config.ts"), "utf8");
for (const [pattern, label] of [
  ["assertProductionStorageProvider", "explicit production storage provider"],
  ["ALLOW_GUEST_CHAT", "production guest-chat prohibition"],
  ['NODE_ENV !== "production"', "runtime/node environment consistency"],
])
  if (!config.includes(pattern)) errors.push(`config missing ${label}`);
const runtimeIntegrity = readFileSync(resolve(root, "src/lib/runtime-integrity.ts"), "utf8");
if (runtimeIntegrity.includes("resolveRuntimeMode(config().NODE_ENV)"))
  errors.push("runtime-integrity must not derive mode from NODE_ENV");
if (!runtimeIntegrity.includes("cfg.ISABELLA_RUNTIME_MODE"))
  errors.push("runtime-integrity must report ISABELLA_RUNTIME_MODE");
const repositoryFactory = readFileSync(
  resolve(root, "src/lib/persistence/repository-factory.ts"),
  "utf8",
);
const memoryPostgres = readFileSync(
  resolve(root, "src/lib/repositories/memory-postgres-repository.ts"),
  "utf8",
);
const authVerification = readFileSync(
  resolve(root, "src/lib/auth-verification-layer.ts"),
  "utf8",
);

for (const [pattern, label] of [
  ["ISABELLA_STORAGE_PROVIDER", "explicit storage provider enforcement"],
  ["JSON persistence is forbidden", "production JSON persistence prohibition"],
  ["not implemented for production", "unsupported adapter fail-closed behavior"],
])
  if (!repositoryFactory.includes(pattern)) errors.push(`repository factory missing ${label}`);

if (/private\s+fallback\s*=\s*memoryRepository/.test(memoryPostgres))
  errors.push("production memory repository must not contain an in-memory fallback");
if (!memoryPostgres.includes("DATABASE_URL is required for PostgreSQL memory persistence"))
  errors.push("production memory repository must fail closed without DATABASE_URL");
if (/sovereign-default/.test(authVerification))
  errors.push("auth verification must not synthesize sovereign-default tenant identities");
if (!authVerification.includes('reasonCode: "TENANT_MISSING"'))
  errors.push("auth verification must reject missing tenant claims explicitly");
const migrationRunner = readFileSync(resolve(root, "scripts/db-migrate.mjs"), "utf8");
for (const [pattern, label] of [
  ["--single-transaction", "atomic migration transaction"],
  ["pg_advisory_xact_lock", "migration concurrency lock"],
  ["checksum_sha256", "migration checksum ledger"],
  ["POST-MIGRATION INVARIANT FAILED", "post-migration invariant gate"],
  ["Automatic baseline is disabled", "unknown-baseline fail-closed gate"],
])
  if (!migrationRunner.includes(pattern)) errors.push(`Neon migration runner missing ${label}`);
const governance = readFileSync(resolve(root, "src/lib/ai-governance.ts"), "utf8");
for (const [pattern, label] of [
  ["humanOversight: true", "human oversight disclosure"],
  ["shutdownCapability: true", "shutdown capability disclosure"],
  ["auditability: true", "auditability disclosure"],
  ["failClosedOnCriticalConfiguration: true", "fail-closed safety disclosure"],
  ["legalNotice", "non-certification legal notice"],
])
  if (!governance.includes(pattern)) errors.push(`AI governance profile missing ${label}`);
const transparencyRoute = readFileSync(
  resolve(root, "src/server-routes/api/ai-transparency.ts"),
  "utf8",
);
if (!transparencyRoute.includes("getAIGovernanceProfile"))
  errors.push("AI transparency route must serve the canonical governance profile");
const catalog = readFileSync(resolve(root, "src/lib/api-catalog.ts"), "utf8");
if (!catalog.includes('"/api/ai/transparency"'))
  errors.push("AI transparency endpoint missing from API catalog");
phases.STATIC_PREFLIGHT = errors.length ? "failed" : "passed";
if (errors.length) {
  const result = { status: "failed", phases, errors };
  if (jsonOutput) console.log(JSON.stringify(result));
  else {
    console.error("Production preflight FAILED");
    for (const error of errors) console.error(`- ${error}`);
  }
  process.exit(1);
}
phases.EXTERNAL_DEPENDENCY_PREFLIGHT = "not-configured";
phases.RUNTIME_PREFLIGHT = "not-configured";
const result = {
  status: "static_ready",
  phases,
  validatedFiles: required.length,
  note: "Static validation passed; external dependencies and runtime smoke checks were not executed.",
};
if (jsonOutput) console.log(JSON.stringify(result));
else {
  console.log("Production preflight OK (static validation only)");
  console.log(
    `Validated ${required.length} production-critical files and canonical runtime/database/governance contracts.`,
  );
  console.log("External dependency and runtime readiness require explicit environment checks.");
}
