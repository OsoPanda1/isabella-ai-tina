import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const root = process.cwd();
const checks = [
  {
    file: "src/lib/isabella-skill-executor.ts",
    required: [
      /resolveSkillInvocation/,
      /getIsabellaSkill/,
      /requiredScopes/,
      /runtime\.run/,
      /isValidSkillResult/,
      /SkillInvocationCompleted/,
    ],
    forbidden: [/Math\.random\s*\(/],
    label:
      "Conversational skill bridge must resolve, authorize, execute, validate and audit registered skills",
  },
  {
    file: "src/components/isabella/SystemMonitor.tsx",
    forbidden: [/Math\.random\s*\(/, /Simulated node/i, /Escalar K8s/i, /tamv-worker-[0-9]+/i],
    label: "SystemMonitor must not fabricate infrastructure telemetry",
  },
  {
    file: "src/lib/telemetry/observability.ts",
    forbidden: [/Math\.random\s*\(/, /startSimulation/i, /generateInitialSnapshot/i],
    label: "Observability must not generate synthetic runtime metrics",
  },
  {
    file: "src/lib/isabella/ml/reinforcement.ts",
    forbidden: [/Math\.random\s*\(/, /simulated/i, /system-auto-evaluator/i],
    label: "Production evaluation must not fabricate metrics or approval",
  },
  {
    file: "src/lib/genesis/cli/index.ts",
    forbidden: [/Not yet implemented/i, /Implementation would go here/i],
    label: "Genesis production CLI must not contain implementation stubs",
  },
  {
    file: "src/lib/genesis/engines/claim-engine.ts",
    forbidden: [/dependencyLockHash\s*:\s*[\"']0[\"']\.repeat\(128\)/],
    label: "Genesis claim evidence must not use a placeholder dependency lock hash",
  },
  {
    file: "src/components/isabella/QuantumBridgeMonitor.tsx",
    forbidden: [
      /Math\.random\s*\(/,
      /simulat(?:e|ed|ion)/i,
      /fake telemetry/i,
      /QNodes Activos.*[0-9]/i,
    ],
    label: "QuantumBridgeMonitor must not fabricate runtime quantum telemetry",
  },
  {
    file: "src/components/isabella/QuantumBridgeStatus.tsx",
    forbidden: [/Math\.random\s*\(/, /setInterval\s*\(/, /QNodes.*42/i],
    label: "QuantumBridgeStatus must not fabricate bridge status",
  },
  {
    file: "src/components/isabella/CognitiveStatusDashboard.tsx",
    forbidden: [
      /Math\.random\s*\(/,
      /Simulating live metric/i,
      /hyper-threading.*completado/i,
      /2026-09-04.*CROWN/i,
    ],
    label: "CognitiveStatusDashboard must not fabricate operational evidence",
  },
  {
    file: "src/server.ts",
    required: [
      // Acepta el acceso centralizado via config.ts (passthroughEnv) o el
      // directo process.env: la condicion es detectar production para CSP estricto.
      /production\s*=\s*(?:passthroughEnv\(\s*["']NODE_ENV["']\s*\)|process\.env\.NODE_ENV)\s*===\s*["']production["']/,
      /script-src \$\{scriptSource\}/,
    ],
    label: "Production server boundary must enforce strict script CSP",
  },
];

const errors = [];
for (const check of checks) {
  const path = resolve(root, check.file);
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    errors.push(`${check.label}: missing/unreadable ${check.file}: ${error.message}`);
    continue;
  }
  for (const pattern of check.forbidden ?? []) {
    if (pattern.test(content))
      errors.push(`${check.label}: forbidden pattern ${pattern} in ${check.file}`);
  }
  for (const pattern of check.required ?? []) {
    if (!pattern.test(content))
      errors.push(`${check.label}: required pattern ${pattern} missing from ${check.file}`);
  }
}

// ---------------------------------------------------------------------------
// Global scan: literales que afirman verificacion, salud o consentimiento sin
// comprobacion en runtime. Aplica a TODO src/**, no a una lista de archivos,
// para que ninguna ruta nueva pueda reintroducirlos. La lista es corta a
// proposito: solo lo que ya se corrigio una vez y no debe volver.
// ---------------------------------------------------------------------------
const FABRICATED_CLAIMS = [
  [/Zero-risk/i, "afirma riesgo cero sin evaluacion"],
  [/Invarianza \u00e9tica y sincron\u00eda/i, "afirma verificacion etica inexistente"],
  [/TEE attestation mock/i, "presenta atestacion TEE simulada como operativa"],
  [/Audit chain integrity verified/i, "afirma integridad de cadena verificada sin comprobarla"],
  [/consentGranted\s*:\s*[^,\n]*\?\?\s*true/i, "consentimiento por defecto concedido (fail-open)"],
  [/biometricVerified\s*:\s*[^,\n]*\|\|\s*true/i, "verificacion biometrica forzada a true"],
];

for (const file of walk(resolve(root, "src"))) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const rel = relative(root, file);
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    errors.push(`Global claim scan: unreadable ${rel}: ${error.message}`);
    continue;
  }
  for (const [pattern, why] of FABRICATED_CLAIMS) {
    if (pattern.test(content)) errors.push(`Fabricated claim (${why}): ${pattern} in ${rel}`);
  }
}

// Generated Genesis manifests are evidence, not fixtures. Reject zero/empty lock
// hashes in committed manifests so stale fake evidence cannot be certified.
const manifestsRoot = resolve(root, "genesis/manifests");
if (statSafe(manifestsRoot)?.isDirectory()) {
  for (const file of walk(manifestsRoot)) {
    if (!file.endsWith("manifest.json")) continue;
    try {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      const hash =
        manifest?.context?.environment?.dependencyLockHash ??
        manifest?.environment?.dependencyLockHash;
      if (typeof hash !== "string" || !/^[0-9a-f]{128}$/i.test(hash) || /^0{128}$/i.test(hash)) {
        errors.push(`Genesis manifest has invalid dependencyLockHash: ${relative(root, file)}`);
      }
    } catch (error) {
      errors.push(
        `Genesis manifest is unreadable/invalid JSON: ${relative(root, file)}: ${error.message}`,
      );
    }
  }
}

if (errors.length) {
  console.error("PRODUCTION INTEGRITY GATE FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "PRODUCTION INTEGRITY GATE PASSED: no known P0 synthetic-runtime, CLI-stub, placeholder-evidence or fabricated-claim patterns detected.",
);

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
