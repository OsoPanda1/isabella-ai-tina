/**
 * PRISMA — Skill Registry + Lifecycle
 *
 * Sistema de skills para Isabella Villaseñor AI.
 * Patrón adaptado de Hermes Agent Skills (MIT) con renombramiento.
 *
 * Cada skill define: nombre, propósito, entrada, salida, riesgo, permisos.
 * PRISMA maneja: discovery, registration, execution, lifecycle.
 */

// ============================================================================
// TYPES
// ============================================================================

export type SkillCategory =
  | "knowledge"
  | "coding"
  | "creative"
  | "analysis"
  | "governance"
  | "communication"
  | "security"
  | "territorial"
  | "economic"
  | "system";

export type SkillState = "active" | "stale" | "archived" | "pinned";

export type SkillRisk = "minimal" | "low" | "medium" | "high" | "critical";

export interface SkillDefinition {
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  category: SkillCategory;
  tags: string[];
  risk: SkillRisk;
  requiredPermissions: string[];
  requiredRoles: string[];
  timeout: number;
  retries: number;
  reversible: boolean;
  auditRequired: boolean;
}

export interface SkillWithState extends SkillDefinition {
  state: SkillState;
  useCount: number;
  lastUsedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface SkillExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  tokensUsed?: number;
}

// ============================================================================
// SKILL REGISTRY
// ============================================================================

export class PRISMARegistry {
  private skills = new Map<string, SkillWithState>();

  register(definition: SkillDefinition): void {
    const existing = this.skills.get(definition.name);
    const now = new Date().toISOString();

    this.skills.set(definition.name, {
      ...definition,
      state: existing?.state ?? "active",
      useCount: existing?.useCount ?? 0,
      lastUsedAt: existing?.lastUsedAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  get(name: string): SkillWithState | undefined {
    return this.skills.get(name);
  }

  getActive(): SkillWithState[] {
    return Array.from(this.skills.values()).filter((s) => s.state === "active");
  }

  getByCategory(category: SkillCategory): SkillWithState[] {
    return Array.from(this.skills.values()).filter(
      (s) => s.category === category && s.state === "active",
    );
  }

  getByRisk(risk: SkillRisk): SkillWithState[] {
    return Array.from(this.skills.values()).filter((s) => s.risk === risk && s.state === "active");
  }

  recordUse(name: string): void {
    const skill = this.skills.get(name);
    if (skill) {
      skill.useCount++;
      skill.lastUsedAt = new Date().toISOString();
    }
  }

  archive(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill || skill.state === "pinned") return false;
    skill.state = "archived";
    skill.updatedAt = new Date().toISOString();
    return true;
  }

  restore(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill || skill.state !== "archived") return false;
    skill.state = "active";
    skill.updatedAt = new Date().toISOString();
    return true;
  }

  pin(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    skill.state = "pinned";
    skill.updatedAt = new Date().toISOString();
    return true;
  }

  unpin(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill || skill.state !== "pinned") return false;
    skill.state = "active";
    skill.updatedAt = new Date().toISOString();
    return true;
  }

  count(): number {
    return this.skills.size;
  }
}

export const prismaRegistry = new PRISMARegistry();
