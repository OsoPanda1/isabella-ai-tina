import { createAuditEvent, IsabellaSkill, SkillResult } from "./contracts";

// ============================================================================
// 11. HELIOS (Systemic Analytics Engine)
// ============================================================================
export interface HeliosInput {
  series: Array<{
    metric: string;
    values: number[];
  }>;
}

export interface HeliosOutput {
  trends: Array<{
    metric: string;
    direction: "UP" | "DOWN" | "STABLE";
    change: number;
  }>;
  systemSignals: string[];
}

export const HELIOS: IsabellaSkill<HeliosInput, HeliosOutput> = {
  id: "HELIOS",
  name: "Systemic Analytics Engine",
  version: "v.GENESIS",
  federation: "ECONOMY",
  risk: "MEDIUM",
  description: "Identifica tendencias, señales sistémicas y puntos de atención en series métricas.",
  canRun: (input) => Boolean(input.series?.length),
  async run(input, context): Promise<SkillResult<HeliosOutput>> {
    const trends = input.series.map((series) => {
      const first = series.values[0] ?? 0;
      const last = series.values.at(-1) ?? 0;
      const change = last - first;
      const direction: HeliosOutput["trends"][number]["direction"] =
        change > 0.01 ? "UP" : change < -0.01 ? "DOWN" : "STABLE";
      return {
        metric: series.metric,
        direction,
        change,
      };
    });

    const systemSignals = trends
      .filter((trend) => trend.direction !== "STABLE")
      .map(
        (trend) =>
          `${trend.metric}: tendencia ${trend.direction.toLowerCase()} (${trend.change.toFixed(2)}).`,
      );

    return {
      skillId: "HELIOS",
      status: "SUCCESS",
      summary: `HELIOS analizó ${trends.length} series métricas.`,
      data: { trends, systemSignals },
      evidence: [],
      warnings: [],
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "HELIOS",
          { seriesCount: input.series.length },
          context.actorId,
        ),
        createAuditEvent(
          "SKILL_COMPLETED",
          "HELIOS",
          { trendCount: trends.length },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 20. KAIROS (Strategic Prioritization Engine)
// ============================================================================
export interface KairosInput {
  initiatives: Array<{
    id: string;
    title: string;
    impact: number;
    urgency: number;
    feasibility: number;
    risk: number;
    territorialAlignment: number;
  }>;
}

export interface KairosOutput {
  ranked: Array<{
    id: string;
    title: string;
    priorityScore: number;
    rank: number;
  }>;
}

export const KAIROS: IsabellaSkill<KairosInput, KairosOutput> = {
  id: "KAIROS",
  name: "Strategic Prioritization Engine",
  version: "v.GENESIS",
  federation: "ECONOMY",
  risk: "MEDIUM",
  description:
    "Prioriza iniciativas con métricas explícitas de impacto, urgencia, riesgo y viabilidad.",
  canRun: (input) => Boolean(input.initiatives?.length),
  async run(input, context): Promise<SkillResult<KairosOutput>> {
    const ranked = input.initiatives
      .map((initiative) => ({
        id: initiative.id,
        title: initiative.title,
        priorityScore:
          initiative.impact * 0.3 +
          initiative.urgency * 0.25 +
          initiative.feasibility * 0.2 +
          initiative.territorialAlignment * 0.2 -
          initiative.risk * 0.15,
      }))
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .map((item, index) => ({
        ...item,
        rank: index + 1,
      }));

    return {
      skillId: "KAIROS",
      status: "SUCCESS",
      summary: `KAIROS priorizó ${ranked.length} iniciativas.`,
      data: { ranked },
      evidence: [],
      warnings: [],
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "KAIROS",
          { initiativeCount: input.initiatives.length },
          context.actorId,
        ),
        createAuditEvent(
          "SKILL_COMPLETED",
          "KAIROS",
          { topInitiative: ranked[0]?.id },
          context.actorId,
        ),
      ],
    };
  },
};
