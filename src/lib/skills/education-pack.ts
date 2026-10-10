import { createAuditEvent, IsabellaSkill, SkillResult } from "./contracts";

// ============================================================================
// 24. UTAMV (University-OS Learning Path Engine)
// ============================================================================
export interface UtamvInput {
  learnerGoal: string;
  currentLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  availableModules: Array<{
    id: string;
    title: string;
    level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
    competencies: string[];
  }>;
}

export interface UtamvOutput {
  learningPath: Array<{
    id: string;
    title: string;
    reason: string;
  }>;
  appliedProject: string;
}

const LEVEL_ORDER = {
  BEGINNER: 1,
  INTERMEDIATE: 2,
  ADVANCED: 3,
};

export const UTAMV: IsabellaSkill<UtamvInput, UtamvOutput> = {
  id: "UTAMV",
  name: "University-OS Learning Path Engine",
  version: "v.GENESIS",
  federation: "EDUCATION",
  risk: "LOW",
  description: "Diseña rutas de aprendizaje y proyectos aplicados con evidencia de competencia.",
  canRun: (input) => Boolean(input.learnerGoal?.trim() && input.availableModules?.length),
  async run(input, context): Promise<SkillResult<UtamvOutput>> {
    const currentOrder = LEVEL_ORDER[input.currentLevel];

    const learningPath = input.availableModules
      .filter((module) => LEVEL_ORDER[module.level] <= currentOrder + 1)
      .slice(0, 5)
      .map((module) => ({
        id: module.id,
        title: module.title,
        reason: `Alineado con el objetivo: ${input.learnerGoal}.`,
      }));

    const appliedProject = `Proyecto aplicado: resolver una necesidad de RDM Digital relacionada con “${input.learnerGoal}”.`;

    return {
      skillId: "UTAMV",
      status: "SUCCESS",
      summary: `UTAMV generó una ruta de ${learningPath.length} módulos.`,
      data: { learningPath, appliedProject },
      evidence: [],
      warnings: [],
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "UTAMV",
          { currentLevel: input.currentLevel },
          context.actorId,
        ),
        createAuditEvent(
          "SKILL_COMPLETED",
          "UTAMV",
          { learningPathLength: learningPath.length },
          context.actorId,
        ),
      ],
    };
  },
};
