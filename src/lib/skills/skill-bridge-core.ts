/**
 * SKILL BRIDGE CORE (src/lib/skills/skill-bridge-core.ts)
 * -----------------------------------------------------------------
 * Utilidades ligeras e isomorfas para detección y tipado de invocaciones
 * a habilidades soberanas (@skill). Seguro para ser importado tanto en
 * el cliente (React / Vite) como en el servidor.
 */

import { isabellaSkills, type IsabellaSkillId } from "./registry";

export interface SkillInvocation {
  skillId: IsabellaSkillId;
  canonicalName: string;
  rawInput: string;
  parsedInput: Record<string, unknown>;
}

export interface ProcessSkillInvocationParams {
  text: string;
  token?: string;
  actorId?: string;
  tenantId?: string;
  role?: string;
  authenticated?: boolean;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  traceId?: string;
  correlationId?: string;
  locale?: string;
  federation?: string;
  context?: Record<string, unknown>;
}

export interface ProcessSkillResult {
  matched: boolean;
  success: boolean;
  content: string;
  skillId?: string;
  decisionId?: string | null;
  traceId?: string;
  code?: string;
  error?: string;
  bookpiLogged: boolean;
  bookpiBlockId?: string;
  rawResult?: unknown;
}

// Mapa de búsqueda indexado para resolución rápida de nombres de skills
const skillLookupMap = new Map<string, IsabellaSkillId>();

for (const key of Object.keys(isabellaSkills) as IsabellaSkillId[]) {
  const normKey = key.toLowerCase();
  skillLookupMap.set(normKey, key);
  skillLookupMap.set(normKey.replace(/-/g, "_"), key);
  skillLookupMap.set(normKey.replace(/_/g, "-"), key);
  const skillObj = isabellaSkills[key];
  if (skillObj && typeof skillObj === "object" && "name" in skillObj) {
    const nameLower = (skillObj.name as string).toLowerCase();
    skillLookupMap.set(nameLower, key);
  }
}

/**
 * Detecta si un texto contiene el prefijo o comando de una habilidad soberana.
 */
export function isSkillTrigger(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  return /(?:^|\s)@skill(?:[:\s]|\b)|(?:^|\s)@[a-zA-Z0-9_\-:]+/i.test(text.trim());
}

/**
 * Detecta y parsea si un mensaje o texto contiene una invocación de habilidad soberana.
 * Formatos admitidos:
 *  - `@skill:<nombre> [json|texto]`
 *  - `@skill <nombre> [json|texto]`
 *  - `@<nombre> [json|texto]` (para nombres coincidentes con el registro de skills)
 */
export function detectSkillInvocation(text: string): SkillInvocation | null {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();

  // Patrón 1: @skill:nombre o @skill nombre
  const skillPrefixMatch = trimmed.match(/^@skill[:\s]+([a-zA-Z0-9_\-:]+)([\s\S]*)$/i);
  let targetSkillName = "";
  let remainder = "";

  if (skillPrefixMatch) {
    targetSkillName = skillPrefixMatch[1].trim();
    remainder = skillPrefixMatch[2]?.trim() ?? "";
  } else {
    // Patrón 2: @nombre (ej. @hepta, @gaia, @sophia, @orion)
    const directMatch = trimmed.match(/^@([a-zA-Z0-9_\-:]+)([\s\S]*)$/);
    if (directMatch) {
      const candidate = directMatch[1].trim();
      const norm = candidate.toLowerCase();
      if (skillLookupMap.has(norm)) {
        targetSkillName = candidate;
        remainder = directMatch[2]?.trim() ?? "";
      }
    }
  }

  if (!targetSkillName) return null;

  const matchedSkillId =
    skillLookupMap.get(targetSkillName.toLowerCase()) ||
    skillLookupMap.get(targetSkillName.toLowerCase().replace(/-/g, "_")) ||
    skillLookupMap.get(targetSkillName.toLowerCase().replace(/_/g, "-"));

  if (!matchedSkillId) return null;

  // Extraer parámetros del input: intentar JSON o fallback a texto libre
  let parsedInput: Record<string, unknown> = {};
  if (remainder) {
    const jsonMatch = remainder.match(/^\{[\s\S]*\}$/);
    if (jsonMatch) {
      try {
        parsedInput = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      } catch {
        parsedInput = { query: remainder, prompt: remainder, intent: remainder };
      }
    } else {
      parsedInput = { query: remainder, prompt: remainder, intent: remainder };
    }
  } else {
    parsedInput = {
      query: "Ejecución invocada desde chat stream",
      intent: "chat_skill_invocation",
    };
  }

  return {
    skillId: matchedSkillId,
    canonicalName: String(matchedSkillId),
    rawInput: remainder,
    parsedInput,
  };
}
