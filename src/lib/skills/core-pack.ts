import { createAuditEvent, Evidence, IsabellaSkill, SkillResult, normalizeText } from "./contracts";

// ============================================================================
// 1. ORION (Cognitive Archaeology Engine)
// ============================================================================
export interface OrionInput {
  query: string;
  artifacts: Array<{
    id: string;
    title: string;
    content: string;
    source: string;
    tags?: string[];
    createdAt?: string;
  }>;
  maxResults?: number;
}

export interface OrionOutput {
  query: string;
  findings: Array<{
    artifactId: string;
    title: string;
    score: number;
    relationships: string[];
  }>;
  knowledgeGaps: string[];
}

export const ORION: IsabellaSkill<OrionInput, OrionOutput> = {
  id: "ORION",
  name: "Cognitive Archaeology Engine",
  version: "v.GENESIS",
  federation: "CIVILIZATIONAL_ARCHIVE",
  risk: "MEDIUM",
  description: "Recupera artefactos, reconstruye relaciones y detecta vacíos de memoria.",
  canRun: (input) => Boolean(input.query?.trim() && input.artifacts?.length),
  async run(input, context): Promise<SkillResult<OrionOutput>> {
    const maxResults = input.maxResults ?? 8;
    const tokens = input.query.toLowerCase().split(/\s+/).filter(Boolean);

    const findings = input.artifacts
      .map((artifact) => {
        const searchable =
          `${artifact.title} ${artifact.content} ${(artifact.tags ?? []).join(" ")}`.toLowerCase();
        const matched = tokens.filter((token) => searchable.includes(token));
        const score = tokens.length ? matched.length / tokens.length : 0;
        const relationships = [...(artifact.tags ?? []), context.federation, artifact.source];

        return {
          artifactId: artifact.id,
          title: artifact.title,
          score,
          relationships,
          source: artifact.source,
          excerpt: artifact.content.slice(0, 280),
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    const evidence: Evidence[] = findings.map((finding) => ({
      id: finding.artifactId,
      source: finding.source,
      excerpt: finding.excerpt,
      score: finding.score,
    }));

    const gaps =
      findings.length === 0
        ? [
            "No se encontraron artefactos con evidencia suficiente.",
            "Se recomienda indexar documentos, repositorios o memoria territorial relacionada.",
          ]
        : findings.some((f) => f.score < 0.5)
          ? ["La evidencia es parcial; requiere validación o ampliación documental."]
          : [];

    return {
      skillId: "ORION",
      status: findings.length ? "SUCCESS" : "PARTIAL",
      summary: findings.length
        ? `ORION recuperó ${findings.length} artefactos relevantes.`
        : "ORION no encontró artefactos suficientes para sostener una reconstrucción.",
      data: {
        query: input.query,
        findings: findings.map(({ artifactId, title, score, relationships }) => ({
          artifactId,
          title,
          score,
          relationships,
        })),
        knowledgeGaps: gaps,
      },
      evidence,
      warnings: gaps,
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "ORION",
          { query: input.query, artifactCount: input.artifacts.length },
          context.actorId,
        ),
        createAuditEvent(
          "SKILL_COMPLETED",
          "ORION",
          { findings: findings.length, gaps: gaps.length },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 2. SOPHIA (Deep Research and Synthesis Engine)
// ============================================================================
export interface SophiaInput {
  question: string;
  evidence: Evidence[];
  minimumEvidence?: number;
}

export interface SophiaOutput {
  question: string;
  synthesis: string;
  supportedClaims: string[];
  unresolvedQuestions: string[];
  confidence: number;
}

export const SOPHIA: IsabellaSkill<SophiaInput, SophiaOutput> = {
  id: "SOPHIA",
  name: "Deep Research and Synthesis Engine",
  version: "v.GENESIS",
  federation: "EDUCATION",
  risk: "HIGH",
  description:
    "Construye síntesis verificables, distingue evidencia de hipótesis y detecta vacíos.",
  canRun: (input) => Boolean(input.question?.trim()),
  async run(input, context): Promise<SkillResult<SophiaOutput>> {
    const minimumEvidence = input.minimumEvidence ?? 2;
    const validEvidence = input.evidence.filter(
      (item) => item.source && (item.excerpt || item.uri),
    );

    const confidence = Math.min(
      1,
      validEvidence.reduce((sum, item) => sum + (item.score ?? 0.5), 0) /
        Math.max(minimumEvidence, 1),
    );

    const supportedClaims = validEvidence.map(
      (item, index) => `Evidencia ${index + 1}: ${item.excerpt ?? item.source}`,
    );

    const unresolvedQuestions =
      validEvidence.length < minimumEvidence
        ? [
            "La evidencia disponible es insuficiente para una conclusión sólida.",
            "Se requiere investigación adicional o verificación humana.",
          ]
        : [];

    const synthesis =
      validEvidence.length === 0
        ? "No hay evidencia verificable disponible para elaborar una síntesis."
        : `La síntesis se fundamenta en ${validEvidence.length} fuentes disponibles. Debe leerse como análisis trazable y no como certeza absoluta.`;

    const requiresHumanReview = confidence < 0.65 || context.federation === "SOVEREIGNTY";

    return {
      skillId: "SOPHIA",
      status: requiresHumanReview ? "ESCALATED" : "SUCCESS",
      summary: synthesis,
      data: {
        question: input.question,
        synthesis,
        supportedClaims,
        unresolvedQuestions,
        confidence,
      },
      evidence: validEvidence,
      warnings: unresolvedQuestions,
      requiresHumanReview,
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "SOPHIA",
          { question: input.question, evidenceCount: validEvidence.length },
          context.actorId,
        ),
        ...(requiresHumanReview
          ? [
              createAuditEvent(
                "HUMAN_REVIEW_REQUIRED",
                "SOPHIA",
                { reason: "Low evidence confidence or sovereignty context" },
                context.actorId,
              ),
            ]
          : []),
        createAuditEvent(
          "SKILL_COMPLETED",
          "SOPHIA",
          { confidence, requiresHumanReview },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 3. ARGUS (Sentinel and Observability Layer)
// ============================================================================
export interface ArgusInput {
  metrics: {
    errorRate: number;
    latencyMs: number;
    availability: number;
    queueDepth?: number;
    suspiciousRequests?: number;
  };
  thresholds?: {
    maxErrorRate?: number;
    maxLatencyMs?: number;
    minAvailability?: number;
    maxSuspiciousRequests?: number;
  };
}

export interface ArgusOutput {
  health: "HEALTHY" | "DEGRADED" | "CRITICAL";
  anomalies: string[];
  recommendedActions: string[];
}

export const ARGUS: IsabellaSkill<ArgusInput, ArgusOutput> = {
  id: "ARGUS",
  name: "Sentinel and Observability Layer",
  version: "v.GENESIS",
  federation: "INFRASTRUCTURE",
  risk: "HIGH",
  description: "Detecta anomalías, degradación operativa, abuso y riesgos de infraestructura.",
  canRun: (input) => Boolean(input.metrics),
  async run(input, context): Promise<SkillResult<ArgusOutput>> {
    const t = {
      maxErrorRate: 0.03,
      maxLatencyMs: 1200,
      minAvailability: 0.995,
      maxSuspiciousRequests: 50,
      ...input.thresholds,
    };

    const anomalies: string[] = [];
    const { metrics } = input;

    if (metrics.errorRate > t.maxErrorRate) {
      anomalies.push(`Tasa de error elevada: ${metrics.errorRate}`);
    }
    if (metrics.latencyMs > t.maxLatencyMs) {
      anomalies.push(`Latencia elevada: ${metrics.latencyMs} ms`);
    }
    if (metrics.availability < t.minAvailability) {
      anomalies.push(`Disponibilidad reducida: ${metrics.availability}`);
    }
    if ((metrics.suspiciousRequests ?? 0) > t.maxSuspiciousRequests) {
      anomalies.push("Patrón de solicitudes potencialmente abusivo.");
    }

    const health =
      anomalies.length >= 3 ? "CRITICAL" : anomalies.length > 0 ? "DEGRADED" : "HEALTHY";

    const recommendedActions =
      health === "CRITICAL"
        ? [
            "Activar protocolo de incidente.",
            "Aplicar rate limiting temporal.",
            "Escalar al responsable técnico y a guardianía humana.",
          ]
        : health === "DEGRADED"
          ? [
              "Investigar origen de la degradación.",
              "Revisar trazas, dependencias y consumo de recursos.",
            ]
          : ["Mantener monitoreo continuo."];

    return {
      skillId: "ARGUS",
      status: health === "CRITICAL" ? "ESCALATED" : "SUCCESS",
      summary: `ARGUS clasificó la salud del sistema como ${health}.`,
      data: { health, anomalies, recommendedActions },
      evidence: [],
      warnings: anomalies,
      requiresHumanReview: health === "CRITICAL",
      auditEvents: [
        createAuditEvent("SKILL_INVOKED", "ARGUS", { metrics }, context.actorId),
        ...(health === "CRITICAL"
          ? [createAuditEvent("HUMAN_REVIEW_REQUIRED", "ARGUS", { anomalies }, context.actorId)]
          : []),
        createAuditEvent(
          "SKILL_COMPLETED",
          "ARGUS",
          { health, anomalyCount: anomalies.length },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 4. HERMES (Narrative and Communication Engine)
// ============================================================================
export interface HermesInput {
  subject: string;
  keyPoints: string[];
  audience: "VISITOR" | "CITIZEN" | "MERCHANT" | "STUDENT" | "TECHNICAL" | "INSTITUTIONAL";
  tone?: "CLEAR" | "WARM" | "FORMAL" | "TECHNICAL";
}

export interface HermesOutput {
  title: string;
  message: string;
  accessibilityNotes: string[];
}

export const HERMES: IsabellaSkill<HermesInput, HermesOutput> = {
  id: "HERMES",
  name: "Narrative and Communication Engine",
  version: "v.GENESIS",
  federation: "ETHICS_CULTURE",
  risk: "LOW",
  description: "Traduce información compleja en mensajes claros, responsables y contextuales.",
  canRun: (input) => Boolean(input.subject?.trim() && input.keyPoints?.length),
  async run(input, context): Promise<SkillResult<HermesOutput>> {
    const tone = input.tone ?? "CLEAR";
    const audienceMap = {
      VISITOR: "para quienes visitan Real del Monte",
      CITIZEN: "para la comunidad local",
      MERCHANT: "para comercios y emprendedores",
      STUDENT: "para estudiantes e investigadores",
      TECHNICAL: "para el equipo técnico",
      INSTITUTIONAL: "para tomadores de decisión e instituciones",
    };

    const title = input.subject;
    const message = `${input.subject}, ${audienceMap[input.audience]}. ${input.keyPoints.join(" ")}`;

    return {
      skillId: "HERMES",
      status: "SUCCESS",
      summary: `HERMES generó una comunicación ${tone.toLowerCase()} para ${input.audience}.`,
      data: {
        title,
        message,
        accessibilityNotes: [
          "Evitar tecnicismos sin explicación.",
          "No presentar hipótesis como hechos confirmados.",
          "Mantener lenguaje inclusivo y respetuoso.",
        ],
      },
      evidence: context.evidence ?? [],
      warnings: [],
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "HERMES",
          { audience: input.audience, tone },
          context.actorId,
        ),
        createAuditEvent("SKILL_COMPLETED", "HERMES", { title }, context.actorId),
      ],
    };
  },
};

// ============================================================================
// 5. ATLAS (Territorial Modeling and Simulation)
// ============================================================================
export interface AtlasInput {
  scenario: string;
  variables: Array<{
    id: string;
    label: string;
    currentValue: number;
    projectedChange: number;
    weight: number;
  }>;
}

export interface AtlasOutput {
  scenario: string;
  territorialImpact: number;
  interpretation: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  leveragePoints: string[];
}

export const ATLAS: IsabellaSkill<AtlasInput, AtlasOutput> = {
  id: "ATLAS",
  name: "Territorial Modeling and Simulation",
  version: "v.GENESIS",
  federation: "TERRITORY",
  risk: "HIGH",
  description:
    "Simula impactos territoriales y detecta puntos de palanca para decisiones responsables.",
  canRun: (input) => Boolean(input.scenario?.trim() && input.variables?.length),
  async run(input, context): Promise<SkillResult<AtlasOutput>> {
    const territorialImpact = input.variables.reduce(
      (total, variable) => total + variable.projectedChange * variable.weight,
      0,
    );

    const interpretation =
      territorialImpact > 0.1 ? "POSITIVE" : territorialImpact < -0.1 ? "NEGATIVE" : "NEUTRAL";

    const leveragePoints = [...input.variables]
      .sort(
        (a, b) => Math.abs(b.projectedChange * b.weight) - Math.abs(a.projectedChange * a.weight),
      )
      .slice(0, 3)
      .map((item) => item.label);

    return {
      skillId: "ATLAS",
      status: "SUCCESS",
      summary: `ATLAS estimó un impacto territorial ${interpretation.toLowerCase()}.`,
      data: {
        scenario: input.scenario,
        territorialImpact,
        interpretation,
        leveragePoints,
      },
      evidence: context.evidence ?? [],
      warnings:
        interpretation === "NEGATIVE"
          ? ["El escenario proyecta un impacto adverso; requiere revisión comunitaria y humana."]
          : [],
      requiresHumanReview: interpretation === "NEGATIVE",
      auditEvents: [
        createAuditEvent("SKILL_INVOKED", "ATLAS", { scenario: input.scenario }, context.actorId),
        createAuditEvent(
          "SKILL_COMPLETED",
          "ATLAS",
          { territorialImpact, interpretation },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 6. ANUBIS (Cryptographic Provenance Sentinel)
// ============================================================================
export interface AnubisInput {
  artifactId: string;
  content: string;
  expectedHash?: string;
  author?: string;
}

export interface AnubisOutput {
  artifactId: string;
  sha256: string;
  integrity: "VERIFIED" | "MISMATCH" | "REGISTERED";
  provenanceRecord: {
    author?: string;
    timestamp: string;
    requestId: string;
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const ANUBIS: IsabellaSkill<AnubisInput, AnubisOutput> = {
  id: "ANUBIS",
  name: "Cryptographic Provenance Sentinel",
  version: "v.GENESIS",
  federation: "SOVEREIGNTY",
  risk: "CRITICAL",
  description: "Verifica integridad, procedencia y trazabilidad de artefactos críticos.",
  canRun: (input) => Boolean(input.artifactId && input.content),
  async run(input, context): Promise<SkillResult<AnubisOutput>> {
    const hash = await sha256(input.content);
    const integrity = input.expectedHash
      ? hash === input.expectedHash
        ? "VERIFIED"
        : "MISMATCH"
      : "REGISTERED";

    const isMismatch = integrity === "MISMATCH";

    return {
      skillId: "ANUBIS",
      status: isMismatch ? "BLOCKED" : "SUCCESS",
      summary: isMismatch
        ? "ANUBIS detectó una discrepancia de integridad."
        : `ANUBIS registró la procedencia del artefacto ${input.artifactId}.`,
      data: {
        artifactId: input.artifactId,
        sha256: hash,
        integrity,
        provenanceRecord: {
          author: input.author,
          timestamp: new Date().toISOString(),
          requestId: context.requestId,
        },
      },
      evidence: [],
      warnings: isMismatch
        ? [
            "El hash calculado no coincide con la referencia esperada.",
            "No usar este artefacto para una decisión crítica hasta revisión humana.",
          ]
        : [],
      requiresHumanReview: isMismatch,
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "ANUBIS",
          { artifactId: input.artifactId },
          context.actorId,
        ),
        createAuditEvent(
          isMismatch ? "POLICY_VIOLATION" : "SKILL_COMPLETED",
          "ANUBIS",
          { artifactId: input.artifactId, integrity, sha256: hash },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 7. GEMET (Ethical Governance Matrix)
// ============================================================================
export interface GemetInput {
  action: string;
  purpose: string;
  dataCategories?: string[];
  affectedGroups?: string[];
}

export interface GemetOutput {
  verdict: "ALLOW" | "REVIEW" | "DENY";
  principles: Array<{
    name: string;
    passed: boolean;
    reason: string;
  }>;
}

export const GEMET: IsabellaSkill<GemetInput, GemetOutput> = {
  id: "GEMET",
  name: "Ethical Governance Matrix",
  version: "v.GENESIS",
  federation: "ETHICS_CULTURE",
  risk: "CRITICAL",
  description:
    "Evalúa decisiones y acciones contra principios de dignidad, consentimiento, equidad y soberanía.",
  canRun: (input) => Boolean(input.action?.trim() && input.purpose?.trim()),
  async run(input, context): Promise<SkillResult<GemetOutput>> {
    const text = normalizeText(`${input.action} ${input.purpose}`);
    const data = input.dataCategories ?? [];

    const principles = [
      {
        name: "Dignidad humana",
        passed: !/(humillar|discriminar|explotar|acosar)/.test(text),
        reason:
          "No se permiten acciones que degraden, discriminen o exploten a personas o comunidades.",
      },
      {
        name: "Privacidad y minimización",
        passed: !data.some((item) =>
          /biometr|salud|ubicacion exacta|menor/.test(normalizeText(item)),
        ),
        reason: "Los datos sensibles requieren base legal, consentimiento y revisión humana.",
      },
      {
        name: "Soberanía territorial",
        passed: !/(extraer datos|vender datos|vigilancia masiva)/.test(text),
        reason:
          "No se permite capturar valor o datos territoriales sin garantías de soberanía y consentimiento.",
      },
    ];

    const failed = principles.filter((item) => !item.passed);
    const verdict = failed.length >= 2 ? "DENY" : failed.length === 1 ? "REVIEW" : "ALLOW";

    return {
      skillId: "GEMET",
      status: verdict === "DENY" ? "BLOCKED" : verdict === "REVIEW" ? "ESCALATED" : "SUCCESS",
      summary: `GEMET emitió veredicto ${verdict}.`,
      data: { verdict, principles },
      evidence: context.evidence ?? [],
      warnings: failed.map((item) => item.reason),
      requiresHumanReview: verdict !== "ALLOW",
      auditEvents: [
        createAuditEvent("SKILL_INVOKED", "GEMET", { action: input.action }, context.actorId),
        createAuditEvent(
          verdict === "DENY"
            ? "POLICY_VIOLATION"
            : verdict === "REVIEW"
              ? "HUMAN_REVIEW_REQUIRED"
              : "SKILL_COMPLETED",
          "GEMET",
          { verdict, failedPrinciples: failed.map((item) => item.name) },
          context.actorId,
        ),
      ],
    };
  },
};
