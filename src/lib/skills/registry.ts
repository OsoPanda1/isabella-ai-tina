import { ORION, SOPHIA, ARGUS, HERMES, ATLAS, ANUBIS, GEMET } from "./core-pack";
import { AURORA, GAIA, NODO_CERO, PHAROS } from "./territorial-pack";
import { CITEMESH, HEPHAESTUS } from "./infrastructure-pack";
import { MNEMOSYNE, CHRONOS, PROMETEO } from "./archive-pack";
import { VIGIA, LYRA, EIRENE } from "./ethics-pack";
import { THEMIS, SENTINEL } from "./sovereignty-pack";
import { HELIOS, KAIROS } from "./economy-pack";
import { UTAMV } from "./education-pack";
import { HEPTA } from "./hepta.skill";
import { TINA_CATEGORY } from "./tina-category";
import { evolvedSkillsPack } from "./evolved-skills-pack";
import { OSOPANDA_ECOSYSTEM_SKILLS_PACK } from "./osopanda-ecosystem-pack";
import { createNativeFusedSkill } from "@/lib/native-ml/skill-fusion";

export type RuntimeSkill = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly federation: import("./contracts").FederationId;
  readonly risk: import("./contracts").SkillRisk;
  readonly description: string;
  canRun(input: Record<string, unknown>, context: import("./contracts").SkillContext): boolean;
  run(
    input: Record<string, unknown>,
    context: import("./contracts").SkillContext,
  ): Promise<import("./contracts").SkillResult<unknown>>;
};

const nativeFusedEvolvedSkills = Object.fromEntries(
  Object.values(evolvedSkillsPack).map((skill) => [
    skill.id,
    createNativeFusedSkill({
      id: skill.id,
      name: skill.name,
      version: skill.version,
      federation: skill.federation,
      risk: skill.risk,
      description: skill.description,
    }),
  ]),
) as Record<string, RuntimeSkill>;

export const isabellaSkills = {
  ORION,
  SOPHIA,
  ARGUS,
  HERMES,
  ATLAS,
  ANUBIS,
  GEMET,
  AURORA,
  CITEMESH,
  MNEMOSYNE,
  HELIOS,
  GAIA,
  NODO_CERO,
  CHRONOS,
  VIGIA,
  LYRA,
  PROMETEO,
  THEMIS,
  PHAROS,
  KAIROS,
  HEPHAESTUS,
  EIRENE,
  SENTINEL,
  UTAMV,
  HEPTA,
  TINA: TINA_CATEGORY,
  ...OSOPANDA_ECOSYSTEM_SKILLS_PACK,
  ...evolvedSkillsPack,
  ...nativeFusedEvolvedSkills,
  "firecrawl-market-research": nativeFusedEvolvedSkills["firecrawl-market-research"],
  "firecrawl-monitor": nativeFusedEvolvedSkills["firecrawl-monitor"],
  "ckm-brand": nativeFusedEvolvedSkills["ckm-brand"],
  "ckm:brand": nativeFusedEvolvedSkills["ckm-brand"],
  "ckm-banner-design": nativeFusedEvolvedSkills["ckm-banner-design"],
  "ckm:banner-design": nativeFusedEvolvedSkills["ckm-banner-design"],
  "tavily-search": nativeFusedEvolvedSkills["tavily-search"],
  "ckm-slides": nativeFusedEvolvedSkills["ckm-slides"],
  "ckm:slides": nativeFusedEvolvedSkills["ckm-slides"],
  "flutter-add-widget-test": nativeFusedEvolvedSkills["flutter-add-widget-test"],
  "browser-testing-with-devtools": nativeFusedEvolvedSkills["browser-testing-with-devtools"],
  "firecrawl-seo-audit": nativeFusedEvolvedSkills["firecrawl-seo-audit"],
  "baoyu-infographic": nativeFusedEvolvedSkills["baoyu-infographic"],
  "firecrawl-knowledge-base": nativeFusedEvolvedSkills["firecrawl-knowledge-base"],
  "ci-cd-and-automation": nativeFusedEvolvedSkills["ci-cd-and-automation"],
  "firecrawl-workflows": nativeFusedEvolvedSkills["firecrawl-workflows"],
  "baoyu-markdown-to-html": nativeFusedEvolvedSkills["baoyu-markdown-to-html"],
  "firecrawl-dashboard-reporting": nativeFusedEvolvedSkills["firecrawl-dashboard-reporting"],
  "swiftui-expert-skill": nativeFusedEvolvedSkills["swiftui-expert-skill"],
  "source-driven-development": nativeFusedEvolvedSkills["source-driven-development"],
  "firecrawl-lead-gen": nativeFusedEvolvedSkills["firecrawl-lead-gen"],
  "shipping-and-launch": nativeFusedEvolvedSkills["shipping-and-launch"],
  "firecrawl-lead-research": nativeFusedEvolvedSkills["firecrawl-lead-research"],
  "flutter-add-integration-test": nativeFusedEvolvedSkills["flutter-add-integration-test"],
  "firecrawl-competitive-intel": nativeFusedEvolvedSkills["firecrawl-competitive-intel"],
} as const;

export type IsabellaSkillId = keyof typeof isabellaSkills;

export function getIsabellaSkill(id: IsabellaSkillId) {
  return isabellaSkills[id];
}

export function listIsabellaSkills() {
  const seen = new Set<string>();
  const unique: Array<{
    id: string;
    name: string;
    version: string;
    federation: import("./contracts").FederationId;
    risk: import("./contracts").SkillRisk;
    description: string;
  }> = [];
  for (const skill of Object.values(isabellaSkills)) {
    if (!skill || typeof skill !== "object") continue;
    if (!seen.has(skill.id)) {
      seen.add(skill.id);
      unique.push({
        id: skill.id,
        name: skill.name,
        version: skill.version,
        federation: skill.federation,
        risk: skill.risk,
        description: skill.description,
      });
    }
  }
  return unique;
}

export const getRuntimeSkill = (id: IsabellaSkillId): RuntimeSkill =>
  isabellaSkills[id] as unknown as RuntimeSkill;
