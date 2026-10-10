import { createAuditEvent, IsabellaSkill, SkillResult, normalizeText } from "./contracts";

// ============================================================================
// 8. AURORA (Contextual Orientation Layer)
// ============================================================================
export interface AuroraInput {
  request: string;
  userType: "VISITOR" | "CITIZEN" | "MERCHANT" | "STUDENT";
  availableResources: Array<{
    id: string;
    title: string;
    category: string;
    description: string;
  }>;
}

export interface AuroraOutput {
  intent: "TOURISM" | "CULTURE" | "COMMERCE" | "EDUCATION" | "SUPPORT" | "UNKNOWN";
  recommendations: Array<{
    id: string;
    title: string;
    reason: string;
  }>;
  escalationMessage?: string;
}

export const AURORA: IsabellaSkill<AuroraInput, AuroraOutput> = {
  id: "AURORA",
  name: "Contextual Orientation Layer",
  version: "v.GENESIS",
  federation: "TERRITORY",
  risk: "MEDIUM",
  description:
    "Orienta a usuarios dentro de RDM Digital con recomendaciones contextuales y responsables.",
  canRun: (input) => Boolean(input.request?.trim()),
  async run(input, context): Promise<SkillResult<AuroraOutput>> {
    const text = normalizeText(input.request);

    const intent = /(ruta|visitar|hotel|comer|turismo)/.test(text)
      ? "TOURISM"
      : /(historia|museo|cultura|mina)/.test(text)
        ? "CULTURE"
        : /(negocio|comercio|vender|cliente)/.test(text)
          ? "COMMERCE"
          : /(curso|aprender|investigar|estudiar)/.test(text)
            ? "EDUCATION"
            : /(ayuda|riesgo|emergencia|violencia)/.test(text)
              ? "SUPPORT"
              : "UNKNOWN";

    const requiresEscalation = intent === "SUPPORT";
    const keywords = text.split(/\s+/).filter((word) => word.length > 3);

    const recommendations = requiresEscalation
      ? []
      : input.availableResources
          .map((resource) => {
            const searchable = normalizeText(
              `${resource.title} ${resource.category} ${resource.description}`,
            );
            const score = keywords.filter((word) => searchable.includes(word)).length;
            return { resource, score };
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((item) => ({
            id: item.resource.id,
            title: item.resource.title,
            reason: `Relacionado con tu solicitud de ${intent.toLowerCase()}.`,
          }));

    const escalationMessage = requiresEscalation
      ? "Para una situación de riesgo o emergencia, contacta servicios locales de emergencia o una persona de confianza. Isabella puede mostrar recursos, pero no sustituye atención profesional."
      : undefined;

    return {
      skillId: "AURORA",
      status: requiresEscalation ? "ESCALATED" : "SUCCESS",
      summary: requiresEscalation
        ? "AURORA detectó una solicitud que requiere atención humana o institucional."
        : `AURORA identificó intención ${intent} y generó recomendaciones.`,
      data: { intent, recommendations, escalationMessage },
      evidence: [],
      warnings: escalationMessage ? [escalationMessage] : [],
      requiresHumanReview: requiresEscalation,
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "AURORA",
          { userType: input.userType, intent },
          context.actorId,
        ),
        ...(requiresEscalation
          ? [
              createAuditEvent(
                "HUMAN_REVIEW_REQUIRED",
                "AURORA",
                { reason: "Sensitive support request" },
                context.actorId,
              ),
            ]
          : []),
        createAuditEvent(
          "SKILL_COMPLETED",
          "AURORA",
          { recommendationCount: recommendations.length },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 12. GAIA (Territorial Sustainability Engine)
// ============================================================================
export interface GaiaInput {
  initiative: string;
  impacts: {
    environmental: number;
    cultural: number;
    social: number;
    economic: number;
    territorial: number;
  };
}

export interface GaiaOutput {
  sustainabilityScore: number;
  verdict: "REGENERATIVE" | "ACCEPTABLE" | "REVIEW" | "HARMFUL";
  criticalDimensions: string[];
}

export const GAIA: IsabellaSkill<GaiaInput, GaiaOutput> = {
  id: "GAIA",
  name: "Territorial Sustainability Engine",
  version: "v.GENESIS",
  federation: "TERRITORY",
  risk: "HIGH",
  description: "Evalúa sostenibilidad integral de iniciativas con enfoque territorial y cultural.",
  canRun: (input) => Boolean(input.initiative?.trim() && input.impacts),
  async run(input, context): Promise<SkillResult<GaiaOutput>> {
    const values = Object.entries(input.impacts);
    const sustainabilityScore =
      values.reduce((total, [, value]) => total + value, 0) / values.length;

    const criticalDimensions = values
      .filter(([, value]) => value < 0)
      .map(([dimension]) => dimension);

    const verdict =
      sustainabilityScore >= 0.65 && !criticalDimensions.length
        ? "REGENERATIVE"
        : sustainabilityScore >= 0.2 && criticalDimensions.length < 2
          ? "ACCEPTABLE"
          : sustainabilityScore >= -0.2
            ? "REVIEW"
            : "HARMFUL";

    return {
      skillId: "GAIA",
      status: verdict === "HARMFUL" ? "BLOCKED" : verdict === "REVIEW" ? "ESCALATED" : "SUCCESS",
      summary: `GAIA evaluó la iniciativa como ${verdict}.`,
      data: {
        sustainabilityScore,
        verdict,
        criticalDimensions,
      },
      evidence: context.evidence ?? [],
      warnings: criticalDimensions.map(
        (dimension) => `Impacto negativo identificado en: ${dimension}.`,
      ),
      requiresHumanReview: verdict === "REVIEW" || verdict === "HARMFUL",
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "GAIA",
          { initiative: input.initiative },
          context.actorId,
        ),
        createAuditEvent(
          "SKILL_COMPLETED",
          "GAIA",
          { sustainabilityScore, verdict },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 13. NODO_CERO (Real del Monte Node Zero Operations)
// ============================================================================
export interface NodoCeroInput {
  initiative: string;
  stage: "DISCOVERY" | "DESIGN" | "BUILD" | "PILOT" | "OPERATE" | "SCALE";
  blockers?: string[];
  metrics?: Record<string, number>;
}

export interface NodoCeroOutput {
  initiative: string;
  stage: string;
  status: "READY" | "BLOCKED" | "REVIEW";
  nextActions: string[];
}

export const NODO_CERO: IsabellaSkill<NodoCeroInput, NodoCeroOutput> = {
  id: "NODO_CERO",
  name: "Real del Monte Node Zero Operations",
  version: "v.GENESIS",
  federation: "TERRITORY",
  risk: "HIGH",
  description: "Gestiona etapas, dependencias y acciones de iniciativas vinculadas al Nodo Cero.",
  canRun: (input) => Boolean(input.initiative?.trim() && input.stage),
  async run(input, context): Promise<SkillResult<NodoCeroOutput>> {
    const blockers = input.blockers ?? [];
    const status = blockers.length > 0 ? "BLOCKED" : input.stage === "SCALE" ? "REVIEW" : "READY";

    const nextActions =
      status === "BLOCKED"
        ? [
            "Registrar y clasificar bloqueos.",
            "Asignar responsable humano.",
            "Definir fecha de revisión y evidencia necesaria.",
          ]
        : status === "REVIEW"
          ? [
              "Validar impacto territorial antes de escalar.",
              "Solicitar revisión comunitaria y técnica.",
            ]
          : [
              `Avanzar la iniciativa desde la etapa ${input.stage}.`,
              "Actualizar métricas y ledger de operación.",
            ];

    return {
      skillId: "NODO_CERO",
      status: status === "BLOCKED" ? "ESCALATED" : "SUCCESS",
      summary: `NODO_CERO clasificó “${input.initiative}” como ${status}.`,
      data: {
        initiative: input.initiative,
        stage: input.stage,
        status,
        nextActions,
      },
      evidence: [],
      warnings: blockers,
      requiresHumanReview: status !== "READY",
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "NODO_CERO",
          { initiative: input.initiative, stage: input.stage },
          context.actorId,
        ),
        createAuditEvent("SKILL_COMPLETED", "NODO_CERO", { status, blockers }, context.actorId),
      ],
    };
  },
};

// ============================================================================
// 19. PHAROS (Responsible Territorial Discovery)
// ============================================================================
export interface PharosInput {
  interests: string[];
  places: Array<{
    id: string;
    name: string;
    categories: string[];
    communityVerified: boolean;
    accessibility: boolean;
    sustainabilityScore: number;
  }>;
}

export interface PharosOutput {
  recommendations: Array<{
    id: string;
    name: string;
    score: number;
    reason: string;
  }>;
}

export const PHAROS: IsabellaSkill<PharosInput, PharosOutput> = {
  id: "PHAROS",
  name: "Responsible Territorial Discovery",
  version: "v.GENESIS",
  federation: "TERRITORY",
  risk: "MEDIUM",
  description:
    "Recomienda experiencias territoriales con criterios culturales, comunitarios y de accesibilidad.",
  canRun: (input) => Boolean(input.places?.length),
  async run(input, context): Promise<SkillResult<PharosOutput>> {
    const interests = input.interests.map(normalizeText);

    const recommendations = input.places
      .filter((place) => place.communityVerified)
      .map((place) => {
        const categoryMatches = place.categories
          .map(normalizeText)
          .filter((category) => interests.includes(category)).length;

        const score =
          categoryMatches * 2 + place.sustainabilityScore + (place.accessibility ? 0.5 : 0);

        return {
          id: place.id,
          name: place.name,
          score,
          reason: `${categoryMatches} afinidades con intereses, verificación comunitaria y evaluación territorial.`,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return {
      skillId: "PHAROS",
      status: "SUCCESS",
      summary: `PHAROS generó ${recommendations.length} recomendaciones territoriales responsables.`,
      data: { recommendations },
      evidence: [],
      warnings: [],
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "PHAROS",
          { interests: input.interests },
          context.actorId,
        ),
        createAuditEvent(
          "SKILL_COMPLETED",
          "PHAROS",
          { recommendationCount: recommendations.length },
          context.actorId,
        ),
      ],
    };
  },
};
