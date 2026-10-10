import { randomBytes } from "node:crypto";
import type { Opportunity, OpportunityCategory, Opportunity as OpportunityType } from "../types";

/* ========================================================================== *
 * Isabella Opportunity Engine
 *
 * Discovers, evaluates, and scores economic opportunities for users
 * based on their capabilities, skills, market conditions, and evidence.
 * ========================================================================== */

const CATEGORY_TEMPLATES: Record<
  OpportunityCategory,
  Array<{
    title: string;
    baseRevenue: [number, number];
    difficulty: OpportunityType["difficulty"];
    ttmDays: number;
    competition: OpportunityType["competitionLevel"];
  }>
> = {
  create: [
    {
      title: "Digital content creation services",
      baseRevenue: [200, 2000],
      difficulty: "low",
      ttmDays: 7,
      competition: "high",
    },
    {
      title: "Custom AI prompts and templates",
      baseRevenue: [100, 1500],
      difficulty: "low",
      ttmDays: 3,
      competition: "medium",
    },
    {
      title: "Online course production",
      baseRevenue: [500, 5000],
      difficulty: "medium",
      ttmDays: 30,
      competition: "medium",
    },
    {
      title: "E-book and digital guide creation",
      baseRevenue: [100, 3000],
      difficulty: "low",
      ttmDays: 14,
      competition: "medium",
    },
    {
      title: "Short-form video production",
      baseRevenue: [300, 3000],
      difficulty: "medium",
      ttmDays: 7,
      competition: "high",
    },
  ],
  sell: [
    {
      title: "Consulting services marketplace",
      baseRevenue: [500, 5000],
      difficulty: "medium",
      ttmDays: 14,
      competition: "medium",
    },
    {
      title: "Digital product storefront",
      baseRevenue: [200, 4000],
      difficulty: "medium",
      ttmDays: 21,
      competition: "high",
    },
    {
      title: "Service-based freelancer profile",
      baseRevenue: [300, 3000],
      difficulty: "low",
      ttmDays: 5,
      competition: "high",
    },
    {
      title: "Specialized knowledge marketplace",
      baseRevenue: [400, 6000],
      difficulty: "high",
      ttmDays: 30,
      competition: "low",
    },
  ],
  recommend: [
    {
      title: "Product affiliate recommendations",
      baseRevenue: [50, 2000],
      difficulty: "low",
      ttmDays: 3,
      competition: "high",
    },
    {
      title: "Service referral partnerships",
      baseRevenue: [100, 1500],
      difficulty: "low",
      ttmDays: 7,
      competition: "medium",
    },
    {
      title: "Curated recommendation newsletter",
      baseRevenue: [200, 3000],
      difficulty: "medium",
      ttmDays: 14,
      competition: "medium",
    },
  ],
  serve: [
    {
      title: "Automated business services",
      baseRevenue: [300, 4000],
      difficulty: "medium",
      ttmDays: 21,
      competition: "low",
    },
    {
      title: "Local business consulting",
      baseRevenue: [500, 5000],
      difficulty: "medium",
      ttmDays: 14,
      competition: "low",
    },
    {
      title: "Technical documentation services",
      baseRevenue: [200, 2500],
      difficulty: "low",
      ttmDays: 7,
      competition: "medium",
    },
    {
      title: "AI-powered data analysis",
      baseRevenue: [400, 6000],
      difficulty: "high",
      ttmDays: 21,
      competition: "low",
    },
  ],
  build: [
    {
      title: "Custom AI agent creation",
      baseRevenue: [500, 8000],
      difficulty: "high",
      ttmDays: 30,
      competition: "low",
    },
    {
      title: "Automation workflow builder",
      baseRevenue: [300, 5000],
      difficulty: "medium",
      ttmDays: 21,
      competition: "medium",
    },
    {
      title: "Knowledge pack marketplace",
      baseRevenue: [200, 4000],
      difficulty: "medium",
      ttmDays: 14,
      competition: "low",
    },
    {
      title: "Reusable skill library",
      baseRevenue: [100, 3000],
      difficulty: "medium",
      ttmDays: 14,
      competition: "low",
    },
  ],
};

function generateId(): string {
  return `opp_${randomBytes(12).toString("hex")}`;
}

function computeOverallScore(params: {
  revenueScore: number;
  difficultyScore: number;
  ttmScore: number;
  competitionScore: number;
  evidenceScore: number;
  capitalScore: number;
}): number {
  const weights = {
    revenue: 0.25,
    difficulty: 0.15,
    ttm: 0.15,
    competition: 0.15,
    evidence: 0.2,
    capital: 0.1,
  };
  return (
    Math.round(
      (params.revenueScore * weights.revenue +
        params.difficultyScore * weights.difficulty +
        params.ttmScore * weights.ttm +
        params.competitionScore * weights.competition +
        params.evidenceScore * weights.evidence +
        params.capitalScore * weights.capital) *
        100,
    ) / 100
  );
}

function normalizeRevenue(max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, max / 10000);
}

function difficultyScore(d: OpportunityType["difficulty"]): number {
  return d === "low" ? 0.9 : d === "medium" ? 0.6 : 0.3;
}

function ttmScore(days: number): number {
  if (days <= 3) return 1.0;
  if (days <= 7) return 0.85;
  if (days <= 14) return 0.7;
  if (days <= 21) return 0.55;
  return 0.4;
}

function competitionScore(c: OpportunityType["competitionLevel"]): number {
  return c === "low" ? 0.95 : c === "medium" ? 0.6 : 0.3;
}

export function discoverOpportunities(
  principalId: string,
  tenantId: string,
  capabilities: string[],
  categories?: OpportunityCategory[],
): Opportunity[] {
  const now = new Date().toISOString();
  const cats =
    categories && categories.length > 0
      ? categories
      : (Object.keys(CATEGORY_TEMPLATES) as OpportunityCategory[]);

  const opportunities: Opportunity[] = [];

  for (const cat of cats) {
    const templates = CATEGORY_TEMPLATES[cat] || [];
    for (const tmpl of templates) {
      // Sin evidencia registrada para plantillas: fail-closed en 0, no aleatorio.
      const evidenceScore = 0;
      const overallScore = computeOverallScore({
        revenueScore: normalizeRevenue(tmpl.baseRevenue[1]),
        difficultyScore: difficultyScore(tmpl.difficulty),
        ttmScore: ttmScore(tmpl.ttmDays),
        competitionScore: competitionScore(tmpl.competition),
        evidenceScore,
        capitalScore: 0.8,
      });

      opportunities.push({
        id: generateId(),
        tenantId,
        principalId,
        category: cat,
        title: tmpl.title,
        description: `${tmpl.title} — tailored for capabilities: ${capabilities.slice(0, 3).join(", ") || "general"}`,
        estimatedRevenueMin: tmpl.baseRevenue[0],
        estimatedRevenueMax: tmpl.baseRevenue[1],
        currency: "USD",
        difficulty: tmpl.difficulty,
        timeToMarketDays: tmpl.ttmDays,
        competitionLevel: tmpl.competition,
        requiredCapital: 0,
        riskLevel:
          tmpl.difficulty === "low" ? "low" : tmpl.difficulty === "medium" ? "medium" : "high",
        evidenceScore,
        overallScore,
        status: "discovered",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return opportunities.sort((a, b) => b.overallScore - a.overallScore);
}

export function scoreOpportunity(opp: Opportunity): Opportunity {
  // Sin evidencia registrada: fail-closed en 0, no aleatorio.
  const evidenceScore = 0;
  const overallScore = computeOverallScore({
    revenueScore: normalizeRevenue(opp.estimatedRevenueMax),
    difficultyScore: difficultyScore(opp.difficulty),
    ttmScore: ttmScore(opp.timeToMarketDays),
    competitionScore: competitionScore(opp.competitionLevel),
    evidenceScore,
    capitalScore: opp.requiredCapital === 0 ? 0.95 : 0.5,
  });
  return {
    ...opp,
    evidenceScore,
    overallScore,
    updatedAt: new Date().toISOString(),
  };
}
