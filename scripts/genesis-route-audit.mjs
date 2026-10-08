import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const roots = ["src/routes", "src/server-routes"];
const entries = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (/\.(ts|tsx)$/.test(name) && !name.startsWith("README")) entries.push(file);
  }
};
roots.forEach((dir) => walk(path.join(root, dir)));

const normalize = (file) => {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const layer = rel.startsWith("src/server-routes/") ? "internal" : "active";
  const route = rel
    .replace(/^src\/(routes|server-routes)\//, "")
    .replace(/\.(tsx?|jsx?)$/, "")
    .replace(/\/index$/, "");
  return {
    layer,
    route:
      route
        .split("/")
        .map((part) => (part.startsWith("$") ? `:${part.slice(1)}` : part))
        .join("/") || "/",
    file: rel,
  };
};

const PUBLIC_EXCEPTIONS = [
  /^api\/health$/,
  /^api\/health\/.*$/,
  /^api\/webhooks?\//,
  /^api\/auth\/callback$/,
];
const AUTH_SIGNALS = [
  "withSovereignAuth",
  "getAuthenticatedUser",
  "requireAuth",
  "requireAuthenticated",
  "authMiddleware",
  "verifyJwt",
  "principal-context",
  "authorization",
];
const RATE_SIGNALS = [
  "checkRateLimitDistributed",
  "checkRateLimit",
  "rateLimit",
  "withRateLimit",
  "@upstash/ratelimit",
];
const VALIDATION_SIGNALS = [
  "safeParse",
  "parseSafeJsonBody",
  "z.object(",
  "zod",
  "Schema.parse",
  "Schema.safeParse",
  "requestSchema",
];
const SIGNATURE_SIGNALS = [
  "stripe-signature",
  "webhook signature",
  "verifySignature",
  "verifyWebhook",
  "constructEvent",
];
const SENSITIVE =
  /(^|\/)(api-keys|billing|db|admin|generate|voice|upload|chat|execute|run|tools?|monetization|payments?|withdrawal|memory|learning)(\/|$)/i;

const findings = [];
const routes = entries.map((file) => {
  const meta = normalize(file);
  const source = fs.readFileSync(file, "utf8");
  // Los archivos de src/routes/ son shells de delegación (ADR-001): la lógica
  // canónica vive en src/server-routes/. Para auditar la señal efectiva hay que
  // seguir el import del ServerRoute; si no, todo shell "carece" de controles
  // que sí aplican en el manejador real.
  const delegated = [...source.matchAll(/from\s+"([^"]*server-routes[^"]+)"/g)]
    .map((match) => {
      const spec = match[1];
      // Alias del proyecto ("@/...") y rutas relativas ("../../...").
      if (spec.startsWith("@/")) return path.join(root, "src", spec.slice(2));
      return path.resolve(path.dirname(file), spec);
    })
    .flatMap((target) => [`${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")])
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => fs.readFileSync(candidate, "utf8"));
  const effectiveSource = [source, ...delegated].join("\n");
  const methods = [
    ...new Set([...source.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s*:/g)].map((m) => m[1])),
  ];
  const mutation = methods.some((method) => method !== "GET");
  const publicException = PUBLIC_EXCEPTIONS.some((pattern) => pattern.test(meta.route));
  const sensitive = !publicException && (mutation || SENSITIVE.test(meta.route));
  const hasAuth = AUTH_SIGNALS.some((signal) => effectiveSource.includes(signal));
  const hasRate = RATE_SIGNALS.some((signal) => effectiveSource.includes(signal));
  const hasValidation = VALIDATION_SIGNALS.some((signal) => effectiveSource.includes(signal));
  const hasSignature = SIGNATURE_SIGNALS.some((signal) =>
    effectiveSource.toLowerCase().includes(signal.toLowerCase()),
  );
  const rateRequired = sensitive && !publicException;
  const validationRequired = sensitive && mutation;
  const authRequired = sensitive && !publicException;
  const effectiveRate = hasRate || effectiveSource.includes("withSovereignAuth");
  const effectiveValidation = hasValidation || effectiveSource.includes("withSovereignAuth");
  const effectiveAuth = hasAuth || effectiveSource.includes("withSovereignAuth");
  const missing = [];
  if (authRequired && !effectiveAuth) missing.push("auth");
  if (rateRequired && !effectiveRate) missing.push("rate-limit");
  if (validationRequired && !effectiveValidation && !hasSignature) missing.push("input-validation");
  if (publicException && meta.route.includes("webhook") && !hasSignature)
    missing.push("webhook-signature");
  if (missing.length) findings.push({ ...meta, methods, sensitive, missing });
  return {
    ...meta,
    methods,
    sensitive,
    auth: effectiveAuth,
    rateLimit: effectiveRate,
    validation: effectiveValidation || hasSignature,
    publicException,
  };
});

const duplicates = routes.reduce((map, route) => {
  const key = `${route.layer}:${route.route}`;
  const list = map.get(key) ?? [];
  list.push(route.file);
  map.set(key, list);
  return map;
}, new Map());
const duplicateRoutes = [...duplicates.entries()].filter(([, files]) => files.length > 1);

const report = {
  generatedAt: new Date().toISOString(),
  canonicalDeployment: "https://isabella-ai.visitarealdelmonte.online",
  summary: {
    total: routes.length,
    sensitive: routes.filter((r) => r.sensitive).length,
    findings: findings.length,
    duplicates: duplicateRoutes.length,
  },
  routes,
  findings,
  duplicates: duplicateRoutes,
};

console.log(JSON.stringify(report, null, 2));
if (findings.length || duplicateRoutes.length) process.exitCode = 2;
