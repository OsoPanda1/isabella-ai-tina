import { createHash, randomUUID } from "node:crypto";
import { embed, cosine } from "../ncua/embed";
import { classifyTextRisk } from "./text-classifier";
import type { IsabellaSkill, SkillContext, SkillResult } from "../skills/contracts";

export type NativeSkillDomain =
  | "frontend_design"
  | "agent_development"
  | "skill_engineering"
  | "knowledge_work"
  | "documentation"
  | "presentation"
  | "visual_media"
  | "code_engineering"
  | "security"
  | "financial"
  | "legal"
  | "healthcare"
  | "life_sciences"
  | "education"
  | "commerce"
  | "research"
  | "devops"
  | "automation"
  | "mcp_integrations"
  | "general_reasoning";
export type NativeSkillExecutionStatus = "SUCCESS" | "PARTIAL" | "BLOCKED" | "FAILED";
export interface NativeSkillSource {
  id: string;
  repository: string;
  family: string;
  capabilityDomains: readonly NativeSkillDomain[];
  native: true;
  externalSideEffectsRequireAdapter: true;
}
export interface NativeSkillRequest {
  skillId: string;
  source?: string;
  task?: string;
  input?: Record<string, unknown>;
  locale?: string;
  actorId?: string;
  tenantId?: string;
  requestId?: string;
}
export interface NativeSkillExecution {
  requestId: string;
  skillId: string;
  source: string;
  domain: NativeSkillDomain;
  status: NativeSkillExecutionStatus;
  native: true;
  externallyExecutable: boolean;
  summary: string;
  plan: readonly string[];
  features: readonly number[];
  risk: { score: number; labels: readonly string[] };
  semanticVector: readonly number[];
  evidence: readonly {
    id: string;
    type: "native-analysis" | "input-provenance";
    hash: string;
    source: string;
  }[];
  provenanceHash: string;
  warnings: readonly string[];
  missingAdapters: readonly string[];
}

export const NATIVE_SKILL_SOURCES: readonly NativeSkillSource[] = [
  {
    id: "anthropics-skills",
    repository: "anthropics/skills",
    family: "general-agent-skills",
    capabilityDomains: [
      "frontend_design",
      "skill_engineering",
      "documentation",
      "presentation",
      "visual_media",
      "mcp_integrations",
    ],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "knowledge-work-plugins",
    repository: "anthropics/knowledge-work-plugins",
    family: "knowledge-work",
    capabilityDomains: [
      "knowledge_work",
      "documentation",
      "research",
      "presentation",
      "automation",
    ],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "claude-code",
    repository: "anthropics/claude-code",
    family: "agent-development",
    capabilityDomains: ["agent_development", "code_engineering", "automation", "devops"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "claude-plugins-official",
    repository: "anthropics/claude-plugins-official",
    family: "agent-tooling",
    capabilityDomains: [
      "skill_engineering",
      "agent_development",
      "mcp_integrations",
      "automation",
      "security",
    ],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "financial-services",
    repository: "anthropics/financial-services",
    family: "financial-services",
    capabilityDomains: ["financial", "research", "knowledge_work"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "claude-for-legal",
    repository: "anthropics/claude-for-legal",
    family: "legal-services",
    capabilityDomains: ["legal", "documentation", "research"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "defending-code-reference-harness",
    repository: "anthropics/defending-code-reference-harness",
    family: "defensive-security",
    capabilityDomains: ["security", "code_engineering", "research"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "claude-plugins-community",
    repository: "anthropics/claude-plugins-community",
    family: "community-agent-skills",
    capabilityDomains: [
      "general_reasoning",
      "frontend_design",
      "documentation",
      "code_engineering",
    ],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "healthcare",
    repository: "anthropics/healthcare",
    family: "healthcare",
    capabilityDomains: ["healthcare", "research", "documentation"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "claude-cookbooks",
    repository: "anthropics/claude-cookbooks",
    family: "applied-analysis",
    capabilityDomains: ["financial", "knowledge_work", "research"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "claude-agent-sdk-demos",
    repository: "anthropics/claude-agent-sdk-demos",
    family: "agent-sdk",
    capabilityDomains: ["agent_development", "documentation", "code_engineering"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "life-sciences",
    repository: "anthropics/life-sciences",
    family: "life-sciences",
    capabilityDomains: ["life_sciences", "research", "documentation"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "claude-tag-plugins",
    repository: "anthropics/claude-tag-plugins",
    family: "tool-connectors",
    capabilityDomains: ["automation", "mcp_integrations", "knowledge_work"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "cwc-workshops",
    repository: "anthropics/cwc-workshops",
    family: "business-workshops",
    capabilityDomains: ["commerce", "financial", "knowledge_work", "research"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "k12-teacher-skills",
    repository: "anthropics/k12-teacher-skills",
    family: "education",
    capabilityDomains: ["education", "documentation", "knowledge_work"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "launch-your-agent",
    repository: "anthropics/launch-your-agent",
    family: "agent-launch",
    capabilityDomains: ["agent_development", "devops", "automation"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "claude-quickstarts",
    repository: "anthropics/claude-quickstarts",
    family: "agent-onboarding",
    capabilityDomains: ["agent_development", "documentation"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "commerce-agents",
    repository: "anthropics/commerce-agents",
    family: "commerce-agents",
    capabilityDomains: ["commerce", "agent_development", "automation", "research"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "code-migration-kit-with-claude-code",
    repository: "anthropics/code-migration-kit-with-claude-code",
    family: "code-migration",
    capabilityDomains: ["code_engineering", "devops", "research"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
  {
    id: "claude-agent-sdk-python",
    repository: "anthropics/claude-agent-sdk-python",
    family: "python-agent-sdk",
    capabilityDomains: ["agent_development", "code_engineering", "automation"],
    native: true,
    externalSideEffectsRequireAdapter: true,
  },
];

const DOMAIN_RULES: ReadonlyArray<{ domain: NativeSkillDomain; terms: readonly string[] }> = [
  {
    domain: "frontend_design",
    terms: ["frontend", "design", "ui", "ux", "web", "css", "react", "accessibility", "a11y"],
  },
  {
    domain: "agent_development",
    terms: ["agent", "claude", "orchestration", "loop", "tool", "sdk"],
  },
  {
    domain: "skill_engineering",
    terms: ["skill", "plugin", "prompt", "capability", "eval", "benchmark"],
  },
  {
    domain: "knowledge_work",
    terms: ["knowledge", "research", "brief", "summary", "memo", "analysis"],
  },
  {
    domain: "documentation",
    terms: ["readme", "documentation", "docs", "manual", "guide", "api-doc"],
  },
  { domain: "presentation", terms: ["pptx", "powerpoint", "slides", "deck", "presentation"] },
  {
    domain: "visual_media",
    terms: ["image", "video", "graphics", "infographic", "motion", "avatar", "caption"],
  },
  {
    domain: "code_engineering",
    terms: [
      "code",
      "coding",
      "refactor",
      "test",
      "typescript",
      "javascript",
      "python",
      "flutter",
      "swift",
    ],
  },
  {
    domain: "security",
    terms: [
      "security",
      "threat",
      "vuln",
      "vulnerability",
      "audit",
      "defense",
      "secure",
      "incident",
    ],
  },
  {
    domain: "financial",
    terms: [
      "finance",
      "financial",
      "earnings",
      "equity",
      "valuation",
      "forecast",
      "statement",
      "market",
    ],
  },
  { domain: "legal", terms: ["legal", "law", "contract", "compliance", "clause", "litigation"] },
  {
    domain: "healthcare",
    terms: ["healthcare", "clinical", "fhir", "patient", "prior-auth", "medical"],
  },
  {
    domain: "life_sciences",
    terms: ["life-science", "single-cell", "rna", "nextflow", "bioinformatics", "genomics"],
  },
  {
    domain: "education",
    terms: ["teacher", "lesson", "classroom", "curriculum", "k12", "education"],
  },
  {
    domain: "commerce",
    terms: ["commerce", "merchant", "order", "catalog", "checkout", "sales", "customer"],
  },
  {
    domain: "research",
    terms: ["research", "literature", "hypothesis", "evidence", "scientific", "study"],
  },
  {
    domain: "devops",
    terms: ["devops", "deploy", "deployment", "ci", "cd", "pipeline", "rollback", "release"],
  },
  {
    domain: "automation",
    terms: ["automation", "workflow", "cron", "scheduled", "webhook", "orchestration"],
  },
  {
    domain: "mcp_integrations",
    terms: ["mcp", "connector", "github", "slack", "linear", "tool-server", "integration"],
  },
];
const EXTERNAL_SIDE_EFFECT_TERMS = [
  "browser",
  "crawl",
  "scrape",
  "deploy",
  "publish",
  "send",
  "email",
  "payment",
  "stripe",
  "github",
  "slack",
  "linear",
  "upload",
  "delete",
  "execute",
  "shell",
  "video generation",
  "image generation",
] as const;
const DOMAIN_PLANS: Record<NativeSkillDomain, readonly string[]> = {
  frontend_design: [
    "Interpretar objetivo y audiencia",
    "Definir jerarquía visual",
    "Aplicar tokens y accesibilidad",
    "Validar responsive e interacción",
  ],
  agent_development: [
    "Definir objetivo",
    "Separar modelo, herramientas, memoria y política",
    "Establecer límites",
    "Diseñar pruebas",
  ],
  skill_engineering: [
    "Formalizar intención",
    "Definir contrato",
    "Construir evaluación",
    "Medir regresiones",
  ],
  knowledge_work: [
    "Extraer entidades",
    "Separar hechos de inferencias",
    "Sintetizar",
    "Conservar provenance",
  ],
  documentation: [
    "Identificar audiencia",
    "Estructurar conceptos",
    "Especificar ejemplos",
    "Verificar código y docs",
  ],
  presentation: [
    "Definir narrativa",
    "Diseñar estructura",
    "Aplicar composición",
    "Validar legibilidad",
  ],
  visual_media: [
    "Definir formato",
    "Diseñar composición",
    "Preparar recursos",
    "Validar derechos y accesibilidad",
  ],
  code_engineering: [
    "Inspeccionar contratos",
    "Modelar cambio reversible",
    "Implementar con pruebas",
    "Ejecutar gates",
  ],
  security: [
    "Clasificar amenaza",
    "Identificar autoridad",
    "Aplicar fail-closed",
    "Probar abuso y aislamiento",
  ],
  financial: [
    "Identificar instrumento",
    "Normalizar datos",
    "Separar observación y supuesto",
    "Calcular escenarios con provenance",
  ],
  legal: [
    "Identificar jurisdicción",
    "Separar fuente e interpretación",
    "Construir documento",
    "Marcar revisión profesional",
  ],
  healthcare: [
    "Identificar contexto y estándar",
    "Normalizar entidades",
    "Aplicar privacidad",
    "Marcar decisión clínica",
  ],
  life_sciences: [
    "Definir pregunta",
    "Establecer datos y controles",
    "Analizar reproduciblemente",
    "Registrar límites",
  ],
  education: [
    "Definir objetivo",
    "Adaptar dificultad",
    "Construir actividad",
    "Verificar inclusión",
  ],
  commerce: [
    "Definir operación",
    "Validar identidad y política",
    "Separar cálculo de autoridad financiera",
    "Registrar idempotencia",
  ],
  research: [
    "Definir pregunta",
    "Separar evidencia primaria y secundaria",
    "Comparar hipótesis",
    "Registrar incertidumbre",
  ],
  devops: [
    "Inspeccionar artefactos",
    "Validar entorno",
    "Ejecutar gates",
    "Preparar observabilidad y rollback",
  ],
  automation: ["Definir trigger", "Validar permisos", "Diseñar reintentos", "Auditar transiciones"],
  mcp_integrations: [
    "Definir herramienta y scopes",
    "Validar identidad y tenant",
    "Aplicar allowlist",
    "Auditar revocación",
  ],
  general_reasoning: [
    "Normalizar intención",
    "Extraer señales",
    "Separar hechos e inferencias",
    "Generar resultado trazable",
  ],
};
function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("es-MX").trim();
}
function detectDomain(skillId: string, task: string): NativeSkillDomain {
  const haystack = normalize(`${skillId} ${task}`);
  let best: { domain: NativeSkillDomain; score: number } = {
    domain: "general_reasoning",
    score: 0,
  };
  for (const rule of DOMAIN_RULES) {
    const score = rule.terms.reduce(
      (sum, term) => sum + (haystack.includes(normalize(term)) ? 1 : 0),
      0,
    );
    if (score > best.score) best = { domain: rule.domain, score };
  }
  return best.domain;
}
function inferSource(skillId: string, explicitSource?: string): NativeSkillSource {
  const requested = normalize(explicitSource ?? "");
  const exact = requested
    ? NATIVE_SKILL_SOURCES.find(
        (s) => normalize(s.id) === requested || normalize(s.repository) === requested,
      )
    : undefined;
  if (exact) return exact;
  return (
    NATIVE_SKILL_SOURCES.find((s) =>
      normalize(skillId).includes(normalize(s.family).replaceAll("-", " ")),
    ) ?? {
      id: "native-isabella",
      repository: "OsoPanda1/isabella-ai-genesis",
      family: "native-fusion",
      capabilityDomains: ["general_reasoning"],
      native: true,
      externalSideEffectsRequireAdapter: true,
    }
  );
}
function hasExternalSideEffect(task: string, input: Record<string, unknown>): boolean {
  const haystack = normalize(`${task} ${JSON.stringify(input)}`);
  return EXTERNAL_SIDE_EFFECT_TERMS.some((term) => haystack.includes(normalize(term)));
}

export function executeNativeSkill(request: NativeSkillRequest): NativeSkillExecution {
  const skillId = request.skillId.trim();
  if (!skillId) throw new Error("native_skill_id_required");
  const task = String(
    request.task ?? request.input?.task ?? request.input?.prompt ?? skillId,
  ).trim();
  const input = request.input ?? {};
  const source = inferSource(skillId, request.source);
  const domain = detectDomain(skillId, task);
  const semanticVector = Array.from(embed(`${skillId}\n${task}`, { dim: 64 }));
  const risk = classifyTextRisk(`${skillId} ${task}`);
  const external = hasExternalSideEffect(task, input);
  const requestId = request.requestId ?? randomUUID();
  const plan = DOMAIN_PLANS[domain];
  const provenancePayload = {
    requestId,
    skillId,
    source: source.repository,
    domain,
    task,
    input,
    riskModel: risk.modelId,
    plan,
  };
  const provenanceHash = stableHash(provenancePayload);
  const warnings = external
    ? ["La ejecución nativa no simula efectos externos; requiere un adaptador autorizado."]
    : [];
  const missingAdapters = external ? ["external-side-effect-adapter"] : [];
  return {
    requestId,
    skillId,
    source: source.repository,
    domain,
    status: external ? "PARTIAL" : "SUCCESS",
    native: true,
    externallyExecutable: false,
    summary: external
      ? `${skillId}: capacidad nativa resuelta; el efecto externo está bloqueado hasta autorizar un adaptador.`
      : `${skillId}: capacidad resuelta por Isabella Native ML para análisis, planificación y trazabilidad.`,
    plan,
    features: risk.features,
    risk: { score: risk.riskScore, labels: risk.labels },
    semanticVector,
    evidence: [
      {
        id: `evi_${randomUUID().slice(0, 8)}`,
        type: "native-analysis",
        hash: stableHash({ skillId, domain, risk, task }),
        source: "Isabella Native ML / NCUA",
      },
      {
        id: `evi_${randomUUID().slice(0, 8)}`,
        type: "input-provenance",
        hash: stableHash(input),
        source: source.repository,
      },
    ],
    provenanceHash,
    warnings,
    missingAdapters,
  };
}

export function createNativeFusedSkill<
  TInput extends Record<string, unknown> = Record<string, unknown>,
>(
  definition: Pick<
    IsabellaSkill<TInput, Record<string, unknown>>,
    "id" | "name" | "version" | "federation" | "risk" | "description"
  >,
): IsabellaSkill<TInput, Record<string, unknown>> {
  return {
    ...definition,
    canRun: (input: TInput, context: SkillContext) => Boolean(input && context.requestId),
    async run(input: TInput, context: SkillContext): Promise<SkillResult<Record<string, unknown>>> {
      const execution = executeNativeSkill({
        skillId: definition.id,
        task:
          typeof input.task === "string"
            ? input.task
            : typeof input.prompt === "string"
              ? input.prompt
              : definition.description,
        input,
        locale: context.locale,
        actorId: context.actorId,
        requestId: context.requestId,
      });
      return {
        skillId: definition.id,
        status: execution.status,
        summary: execution.summary,
        data: {
          native: true,
          domain: execution.domain,
          plan: execution.plan,
          semanticVector: execution.semanticVector,
          risk: execution.risk,
          provenanceHash: execution.provenanceHash,
          missingAdapters: execution.missingAdapters,
        },
        evidence: execution.evidence.map((item) => ({
          id: item.id,
          source: item.source,
          uri: `sovereign://evidence/${item.hash}`,
          score: item.type === "native-analysis" ? 1 : 0.8,
          timestamp: new Date().toISOString(),
        })),
        warnings: [...execution.warnings],
        auditEvents: [
          {
            id: randomUUID(),
            type: "SKILL_COMPLETED",
            skillId: definition.id,
            actorId: context.actorId,
            timestamp: new Date().toISOString(),
            payload: {
              requestId: context.requestId,
              provenanceHash: execution.provenanceHash,
              status: execution.status,
            },
          },
        ],
        requiresHumanReview: execution.risk.score >= 0.6 || execution.status === "PARTIAL",
      };
    },
  };
}

export function nativeSkillSimilarity(left: string, right: string): number {
  return cosine(embed(left, { dim: 64 }), embed(right, { dim: 64 }));
}
export function resolveNativeSkillFamily(skillId: string): NativeSkillSource {
  return inferSource(skillId);
}

/** Backward-compatible lightweight fusion facade retained for existing consumers. */
export interface FusionOutcome {
  fused: boolean;
  synthesizedCapabilities: string[];
  confidence: number;
}

export function fuseSkills(skillIds: string[]): FusionOutcome {
  return {
    fused: true,
    synthesizedCapabilities: skillIds.map((skillId) => `fused_${skillId}`),
    confidence: 0.95,
  };
}

const nativeSkillFusionApi = {
  fuseSkills,
  executeNativeSkill,
  createNativeFusedSkill,
  nativeSkillSimilarity,
  resolveNativeSkillFamily,
};
export default nativeSkillFusionApi;
