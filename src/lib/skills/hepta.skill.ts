import {
  FederationId,
  createAuditEvent,
  IsabellaSkill,
  SkillResult,
  normalizeText,
} from "./contracts";

export interface HeptaInput {
  request: string;
}

export interface HeptaOutput {
  dominantFederation: FederationId;
  recommendedSkills: string[];
  executionOrder: string[];
}

function detectFederation(text: string): FederationId {
  const value = normalizeText(text);

  if (/(ruta|turismo|barrio|territorio|real del monte)/.test(value)) {
    return "TERRITORY";
  }

  if (/(negocio|comercio|ingreso|empleo|economia)/.test(value)) {
    return "ECONOMY";
  }

  if (/(curso|tesis|aprender|investigacion|universidad)/.test(value)) {
    return "EDUCATION";
  }

  if (/(api|servidor|infraestructura|codigo|telemetria)/.test(value)) {
    return "INFRASTRUCTURE";
  }

  if (/(firma|hash|licencia|datos|seguridad|propiedad)/.test(value)) {
    return "SOVEREIGNTY";
  }

  if (/(etica|cultura|conflicto|comunidad|narrativa)/.test(value)) {
    return "ETHICS_CULTURE";
  }

  return "CIVILIZATIONAL_ARCHIVE";
}

const FEDERATION_SKILLS: Record<FederationId, string[]> = {
  TERRITORY: ["VIGIA", "GEMET", "ATLAS", "PHAROS", "AURORA", "GAIA"],
  ECONOMY: ["VIGIA", "GEMET", "HELIOS", "KAIROS", "SOPHIA"],
  EDUCATION: ["VIGIA", "GEMET", "SOPHIA", "UTAMV", "ORION"],
  INFRASTRUCTURE: ["VIGIA", "GEMET", "ARGUS", "CITEMESH", "HEPHAESTUS"],
  SOVEREIGNTY: ["VIGIA", "GEMET", "ANUBIS", "THEMIS", "SENTINEL"],
  ETHICS_CULTURE: ["VIGIA", "GEMET", "HERMES", "LYRA", "EIRENE"],
  CIVILIZATIONAL_ARCHIVE: ["VIGIA", "GEMET", "ORION", "MNEMOSYNE", "CHRONOS", "PROMETEO"],
};

export const HEPTA: IsabellaSkill<HeptaInput, HeptaOutput> = {
  id: "HEPTA",
  name: "Heptafederated Cognitive Orchestrator",
  version: "v.GENESIS",
  federation: "CIVILIZATIONAL_ARCHIVE",
  risk: "HIGH",
  description: "Identifica la federación dominante y compone planes cognitivos gobernados.",
  canRun: (input) => Boolean(input.request?.trim()),
  async run(input, context): Promise<SkillResult<HeptaOutput>> {
    const dominantFederation = detectFederation(input.request);
    const recommendedSkills = FEDERATION_SKILLS[dominantFederation];

    return {
      skillId: "HEPTA",
      status: "SUCCESS",
      summary: `HEPTA clasificó la solicitud en la federación ${dominantFederation}.`,
      data: {
        dominantFederation,
        recommendedSkills,
        executionOrder: recommendedSkills,
      },
      evidence: [],
      warnings: [],
      auditEvents: [
        createAuditEvent("SKILL_INVOKED", "HEPTA", { request: input.request }, context.actorId),
        createAuditEvent(
          "SKILL_COMPLETED",
          "HEPTA",
          { dominantFederation, recommendedSkills },
          context.actorId,
        ),
      ],
    };
  },
};
