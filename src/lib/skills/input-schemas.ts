import { z } from "zod";
import { assertBoundedJsonValue } from "@/lib/request-limits";
import type { IsabellaSkillId } from "./registry";

const BOUNDED_SKILL_INPUT = z
  .record(z.string().min(1).max(128), z.unknown())
  .superRefine((value, ctx) => {
    try {
      assertBoundedJsonValue(value, { maxDepth: 6, maxObjectKeys: 64, maxArrayItems: 64 });
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "SKILL_INPUT_TOO_LARGE",
      });
    }
  });

export const skillInputSchemas: Record<IsabellaSkillId, typeof BOUNDED_SKILL_INPUT> = {
  ORION: BOUNDED_SKILL_INPUT,
  SOPHIA: BOUNDED_SKILL_INPUT,
  ARGUS: BOUNDED_SKILL_INPUT,
  HERMES: BOUNDED_SKILL_INPUT,
  ATLAS: BOUNDED_SKILL_INPUT,
  ANUBIS: BOUNDED_SKILL_INPUT,
  GEMET: BOUNDED_SKILL_INPUT,
  AURORA: BOUNDED_SKILL_INPUT,
  CITEMESH: BOUNDED_SKILL_INPUT,
  MNEMOSYNE: BOUNDED_SKILL_INPUT,
  HELIOS: BOUNDED_SKILL_INPUT,
  GAIA: BOUNDED_SKILL_INPUT,
  NODO_CERO: BOUNDED_SKILL_INPUT,
  CHRONOS: BOUNDED_SKILL_INPUT,
  VIGIA: BOUNDED_SKILL_INPUT,
  LYRA: BOUNDED_SKILL_INPUT,
  PROMETEO: BOUNDED_SKILL_INPUT,
  THEMIS: BOUNDED_SKILL_INPUT,
  PHAROS: BOUNDED_SKILL_INPUT,
  KAIROS: BOUNDED_SKILL_INPUT,
  HEPHAESTUS: BOUNDED_SKILL_INPUT,
  EIRENE: BOUNDED_SKILL_INPUT,
  SENTINEL: BOUNDED_SKILL_INPUT,
  UTAMV: BOUNDED_SKILL_INPUT,
  HEPTA: BOUNDED_SKILL_INPUT,
  TINA: BOUNDED_SKILL_INPUT,
  FIRECRAWL_MARKET_RESEARCH: BOUNDED_SKILL_INPUT,
  FIRECRAWL_MONITOR: BOUNDED_SKILL_INPUT,
  CKM_BRAND: BOUNDED_SKILL_INPUT,
  CKM_BANNER_DESIGN: BOUNDED_SKILL_INPUT,
  TAVILY_SEARCH: BOUNDED_SKILL_INPUT,
  CKM_SLIDES: BOUNDED_SKILL_INPUT,
  FLUTTER_ADD_WIDGET_TEST: BOUNDED_SKILL_INPUT,
  BROWSER_TESTING_WITH_DEVTOOLS: BOUNDED_SKILL_INPUT,
  FIRECRAWL_SEO_AUDIT: BOUNDED_SKILL_INPUT,
  BAOYU_INFOGRAPHIC: BOUNDED_SKILL_INPUT,
  FIRECRAWL_KNOWLEDGE_BASE: BOUNDED_SKILL_INPUT,
  CI_CD_AND_AUTOMATION: BOUNDED_SKILL_INPUT,
  FIRECRAWL_WORKFLOWS: BOUNDED_SKILL_INPUT,
  BAOYU_MARKDOWN_TO_HTML: BOUNDED_SKILL_INPUT,
  FIRECRAWL_DASHBOARD_REPORTING: BOUNDED_SKILL_INPUT,
  SWIFTUI_EXPERT_SKILL: BOUNDED_SKILL_INPUT,
  SOURCE_DRIVEN_DEVELOPMENT: BOUNDED_SKILL_INPUT,
  FIRECRAWL_LEAD_GEN: BOUNDED_SKILL_INPUT,
  SHIPPING_AND_LAUNCH: BOUNDED_SKILL_INPUT,
  FIRECRAWL_LEAD_RESEARCH: BOUNDED_SKILL_INPUT,
  FLUTTER_ADD_INTEGRATION_TEST: BOUNDED_SKILL_INPUT,
  FIRECRAWL_COMPETITIVE_INTEL: BOUNDED_SKILL_INPUT,
  "firecrawl-market-research": BOUNDED_SKILL_INPUT,
  "firecrawl-monitor": BOUNDED_SKILL_INPUT,
  "ckm-brand": BOUNDED_SKILL_INPUT,
  "ckm:brand": BOUNDED_SKILL_INPUT,
  "ckm-banner-design": BOUNDED_SKILL_INPUT,
  "ckm:banner-design": BOUNDED_SKILL_INPUT,
  "tavily-search": BOUNDED_SKILL_INPUT,
  "ckm-slides": BOUNDED_SKILL_INPUT,
  "ckm:slides": BOUNDED_SKILL_INPUT,
  "flutter-add-widget-test": BOUNDED_SKILL_INPUT,
  "browser-testing-with-devtools": BOUNDED_SKILL_INPUT,
  "firecrawl-seo-audit": BOUNDED_SKILL_INPUT,
  "baoyu-infographic": BOUNDED_SKILL_INPUT,
  "firecrawl-knowledge-base": BOUNDED_SKILL_INPUT,
  "ci-cd-and-automation": BOUNDED_SKILL_INPUT,
  "firecrawl-workflows": BOUNDED_SKILL_INPUT,
  "baoyu-markdown-to-html": BOUNDED_SKILL_INPUT,
  "firecrawl-dashboard-reporting": BOUNDED_SKILL_INPUT,
  "swiftui-expert-skill": BOUNDED_SKILL_INPUT,
  "source-driven-development": BOUNDED_SKILL_INPUT,
  "firecrawl-lead-gen": BOUNDED_SKILL_INPUT,
  "shipping-and-launch": BOUNDED_SKILL_INPUT,
  "firecrawl-lead-research": BOUNDED_SKILL_INPUT,
  "flutter-add-integration-test": BOUNDED_SKILL_INPUT,
  "firecrawl-competitive-intel": BOUNDED_SKILL_INPUT,
  "nodo-cero-twin": BOUNDED_SKILL_INPUT,
  "rdm-sovereign-commerce": BOUNDED_SKILL_INPUT,
  "rdm-community-assembly": BOUNDED_SKILL_INPUT,
  "fast-parallel-ingest": BOUNDED_SKILL_INPUT,
  "qstash-event-dispatcher": BOUNDED_SKILL_INPUT,
  "docs-instant-search": BOUNDED_SKILL_INPUT,
};

export function parseSkillInput(skillId: IsabellaSkillId, value: unknown) {
  const schema = skillInputSchemas[skillId] ?? BOUNDED_SKILL_INPUT;
  return schema.safeParse(value);
}
