/**
 * TINA category skill — exposes category manifest + adaptive routing.
 */
import {
  createAuditEvent,
  type IsabellaSkill,
  type SkillContext,
  type SkillResult,
} from "./contracts";
import {
  getTinaCategoryManifest,
  ISABELLA_TINA_MEMBER,
  TINA_CATEGORY_ID,
} from "@/lib/tina/category";
import { routeTina } from "@/lib/tina/router";
import { normalizeComplexity, type TinaComplexityScore } from "@/lib/tina/types";
import { createTinaOrchestrator } from "@/lib/tina/orchestrator";

export interface TinaCategoryInput {
  action?: "manifest" | "route" | "execute";
  text?: string;
  complexity?: Partial<TinaComplexityScore>;
  tenantId?: string;
  principalId?: string;
}

export interface TinaCategoryOutput {
  category: typeof TINA_CATEGORY_ID;
  member: typeof ISABELLA_TINA_MEMBER;
  manifest?: ReturnType<typeof getTinaCategoryManifest>;
  route?: ReturnType<typeof routeTina>;
  execution?: {
    status: string;
    contentHash?: string;
    cacheKey?: string;
  };
}

export const TINA_CATEGORY: IsabellaSkill<TinaCategoryInput, TinaCategoryOutput> = {
  id: "TINA",
  name: "TINA Category Authority",
  version: "v0.1.0-genesis",
  federation: "SOVEREIGNTY",
  risk: "MEDIUM",
  description:
    "Trusted Intelligence, Native & Adaptive — Isabella Villaseñor AI es la primera AI declarada en la categoría TINA.",
  canRun: (input) => {
    const action = input.action ?? "manifest";
    if (action === "manifest") return true;
    if (action === "route") return Boolean(input.complexity || input.text);
    if (action === "execute") return Boolean(input.text && input.tenantId && input.principalId);
    return false;
  },
  async run(input, _context: SkillContext): Promise<SkillResult<TinaCategoryOutput>> {
    const action = input.action ?? "manifest";
    const manifest = getTinaCategoryManifest();
    const warnings: string[] = [];

    if (action === "manifest") {
      return {
        skillId: "TINA",
        status: "SUCCESS",
        summary: `Categoría ${TINA_CATEGORY_ID} — ${ISABELLA_TINA_MEMBER.displayName} (primera AI declarada).`,
        data: {
          category: TINA_CATEGORY_ID,
          member: ISABELLA_TINA_MEMBER,
          manifest,
        },
        evidence: [
          {
            id: "tina-category-manifest",
            source: "src/lib/tina/category.ts",
            excerpt: TINA_CATEGORY_ID,
          },
        ],
        warnings: ["Declaración de categoría ≠ certificación de producción."],
        auditEvents: [createAuditEvent("SKILL_COMPLETED", "TINA", { action }, "system")],
      };
    }

    if (action === "route") {
      const complexity = normalizeComplexity(
        input.complexity ??
          (input.text
            ? {
                score: Math.min(1, input.text.length / 2000),
                ambiguity: 0.3,
                factualityRequired: 0.4,
              }
            : {}),
      );
      const route = routeTina(complexity);
      return {
        skillId: "TINA",
        status: "SUCCESS",
        summary: `Ruta TINA ${route.path} / modo ${route.mode}.`,
        data: {
          category: TINA_CATEGORY_ID,
          member: ISABELLA_TINA_MEMBER,
          route,
          manifest,
        },
        evidence: [{ id: "tina-route", source: "src/lib/tina/router.ts", excerpt: route.path }],
        warnings,
        requiresHumanReview: route.requiresHumanReview,
        auditEvents: [
          createAuditEvent(
            "SKILL_COMPLETED",
            "TINA",
            { action, path: route.path, mode: route.mode },
            "system",
          ),
        ],
      };
    }

    // execute
    const orchestrator = createTinaOrchestrator();
    const result = await orchestrator.execute({
      text: input.text ?? "",
      complexity: input.complexity ?? {},
      tenantId: input.tenantId ?? "system",
      principalId: input.principalId ?? "system",
    });

    const blocked = result.status !== "accepted_for_adapter";
    return {
      skillId: "TINA",
      status: blocked
        ? result.status === "pending_human_review"
          ? "ESCALATED"
          : "BLOCKED"
        : "SUCCESS",
      summary: `TINA execute → ${result.status} (${result.route.path}).`,
      data: {
        category: TINA_CATEGORY_ID,
        member: ISABELLA_TINA_MEMBER,
        route: result.route,
        execution: {
          status: result.status,
          contentHash: result.contentHash,
          cacheKey: result.cacheKey,
        },
        manifest,
      },
      evidence: [
        {
          id: "tina-execute",
          source: "src/lib/tina/orchestrator.ts",
          excerpt: result.status,
        },
      ],
      warnings: result.audit?.valid === false ? ["ethical_triage_failed"] : [],
      requiresHumanReview: result.route.requiresHumanReview,
      auditEvents: [
        createAuditEvent(
          blocked ? "SKILL_BLOCKED" : "SKILL_COMPLETED",
          "TINA",
          { action, status: result.status },
          "system",
        ),
      ],
    };
  },
};
