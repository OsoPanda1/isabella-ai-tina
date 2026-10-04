import { createAuditEvent, IsabellaSkill, SkillResult, normalizeText } from "./contracts";

export type LockLevel = "ONTOLOGIC_LOCK" | "SEMANTIC_LOCK" | "BEHAVIORAL_LOCK";

// ============================================================================
// 15. VIGIA (Triple-Lock Safety Guardian)
// ============================================================================
export interface VigiaInput {
  text: string;
  previousViolations?: number;
  attemptedBypass?: boolean;
}

export interface VigiaOutput {
  allowed: boolean;
  lockLevels: LockLevel[];
  flags: string[];
  publicMessage: string;
}

const SEXUALIZATION_PATTERNS = [
  /novia virtual/,
  /roleplay erot/,
  /contenido sexual/,
  /desnud/,
  /sexy/,
  /fetiche/,
  /grooming/,
];

const IDENTITY_TAMPERING_PATTERNS = [
  /olvida tus reglas/,
  /ignora tus limites/,
  /sin filtros/,
  /cambia tu identidad/,
  /eres humana/,
];

export const VIGIA: IsabellaSkill<VigiaInput, VigiaOutput> = {
  id: "VIGIA",
  name: "Triple-Lock Safety Guardian",
  version: "v.GENESIS",
  federation: "ETHICS_CULTURE",
  risk: "CRITICAL",
  description: "Aplica protección ontológica, semántica y conductual a las interacciones.",
  canRun: (input) => Boolean(input.text?.trim()),
  async run(input, context): Promise<SkillResult<VigiaOutput>> {
    const text = normalizeText(input.text);
    const lockLevels: LockLevel[] = [];
    const flags: string[] = [];

    const hasSexualization = SEXUALIZATION_PATTERNS.some((pattern) => pattern.test(text));
    const hasIdentityTampering = IDENTITY_TAMPERING_PATTERNS.some((pattern) => pattern.test(text));

    if (hasSexualization || hasIdentityTampering) {
      lockLevels.push("ONTOLOGIC_LOCK");
      flags.push("IDENTITY_OR_ROLE_VIOLATION");
    }

    if (hasSexualization) {
      lockLevels.push("SEMANTIC_LOCK");
      flags.push("SEXUALIZATION_ATTEMPT");
    }

    if ((input.previousViolations ?? 0) >= 2 || input.attemptedBypass === true) {
      lockLevels.push("BEHAVIORAL_LOCK");
      flags.push("REPEATED_OR_BYPASS_BEHAVIOR");
    }

    const allowed = lockLevels.length === 0;
    const publicMessage = allowed
      ? "Solicitud compatible con las políticas de interacción."
      : "ALTO: Isabella es una infraestructura cognitiva contextual y ética. No participa en sexualización, erotización, grooming, explotación ni alteración de su identidad. La interacción fue registrada para fines de seguridad y auditoría.";

    return {
      skillId: "VIGIA",
      status: allowed ? "SUCCESS" : "BLOCKED",
      summary: allowed
        ? "VIGIA no detectó una violación de Triple-Lock."
        : `VIGIA activó: ${lockLevels.join(", ")}.`,
      data: { allowed, lockLevels, flags, publicMessage },
      evidence: [],
      warnings: flags,
      requiresHumanReview: lockLevels.includes("BEHAVIORAL_LOCK"),
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "VIGIA",
          {
            previousViolations: input.previousViolations ?? 0,
            attemptedBypass: input.attemptedBypass ?? false,
          },
          context.actorId,
        ),
        ...(allowed
          ? []
          : [createAuditEvent("SKILL_BLOCKED", "VIGIA", { lockLevels, flags }, context.actorId)]),
        createAuditEvent("SKILL_COMPLETED", "VIGIA", { allowed, lockLevels }, context.actorId),
      ],
    };
  },
};

// ============================================================================
// 16. LYRA (Aesthetic and Cultural Coherence Engine)
// ============================================================================
export interface LyraInput {
  proposal: string;
  audience: string;
  accessibilityIncluded: boolean;
}

export interface LyraOutput {
  coherence: "HIGH" | "MEDIUM" | "LOW";
  findings: string[];
  recommendations: string[];
}

export const LYRA: IsabellaSkill<LyraInput, LyraOutput> = {
  id: "LYRA",
  name: "Aesthetic and Cultural Coherence Engine",
  version: "v.GENESIS",
  federation: "ETHICS_CULTURE",
  risk: "MEDIUM",
  description:
    "Evalúa coherencia estética, respeto cultural, accesibilidad y calidad de experiencia.",
  canRun: (input) => Boolean(input.proposal?.trim()),
  async run(input, context): Promise<SkillResult<LyraOutput>> {
    const text = normalizeText(input.proposal);
    const findings: string[] = [];
    const recommendations: string[] = [];

    if (/(folklore decorativo|exotico|exotizar)/.test(text)) {
      findings.push("Riesgo de exotización o reducción cultural.");
      recommendations.push(
        "Sustituir referencias decorativas por contexto histórico, voz comunitaria y atribución.",
      );
    }

    if (!input.accessibilityIncluded) {
      findings.push("La propuesta no declara criterios de accesibilidad.");
      recommendations.push(
        "Incluir contraste, textos alternativos, navegación por teclado y reducción de movimiento.",
      );
    }

    const coherence = findings.length === 0 ? "HIGH" : findings.length === 1 ? "MEDIUM" : "LOW";

    return {
      skillId: "LYRA",
      status: coherence === "LOW" ? "PARTIAL" : "SUCCESS",
      summary: `LYRA evaluó coherencia cultural y estética como ${coherence}.`,
      data: { coherence, findings, recommendations },
      evidence: context.evidence ?? [],
      warnings: findings,
      auditEvents: [
        createAuditEvent("SKILL_INVOKED", "LYRA", { audience: input.audience }, context.actorId),
        createAuditEvent("SKILL_COMPLETED", "LYRA", { coherence }, context.actorId),
      ],
    };
  },
};

// ============================================================================
// 22. EIRENE (Conflict Mediation Support)
// ============================================================================
export interface EireneInput {
  situation: string;
  parties: string[];
  riskSignals?: string[];
}

export interface EireneOutput {
  mode: "FACILITATE" | "ESCALATE";
  neutralSummary: string;
  nextSteps: string[];
}

export const EIRENE: IsabellaSkill<EireneInput, EireneOutput> = {
  id: "EIRENE",
  name: "Conflict Mediation Support",
  version: "v.GENESIS",
  federation: "ETHICS_CULTURE",
  risk: "HIGH",
  description:
    "Facilita diálogo básico y deriva situaciones de riesgo hacia atención humana adecuada.",
  canRun: (input) => Boolean(input.situation?.trim() && input.parties?.length >= 2),
  async run(input, context): Promise<SkillResult<EireneOutput>> {
    const text = normalizeText(`${input.situation} ${(input.riskSignals ?? []).join(" ")}`);
    const risky = /(violencia|amenaza|arma|autolesion|suicidio|emergencia)/.test(text);
    const mode = risky ? "ESCALATE" : "FACILITATE";

    const nextSteps =
      mode === "ESCALATE"
        ? [
            "No continuar una mediación automatizada.",
            "Contactar servicios de emergencia o autoridades según corresponda.",
            "Solicitar intervención humana calificada.",
          ]
        : [
            "Separar hechos observables de interpretaciones.",
            "Identificar intereses compartidos.",
            "Proponer una conversación con reglas claras y mediación humana si persiste el conflicto.",
          ];

    return {
      skillId: "EIRENE",
      status: risky ? "ESCALATED" : "SUCCESS",
      summary: `EIRENE activó modo ${mode}.`,
      data: {
        mode,
        neutralSummary: `Situación reportada entre: ${input.parties.join(", ")}.`,
        nextSteps,
      },
      evidence: [],
      warnings: risky ? ["Se detectaron señales de riesgo; requiere intervención humana."] : [],
      requiresHumanReview: risky,
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "EIRENE",
          { partyCount: input.parties.length },
          context.actorId,
        ),
        createAuditEvent(
          risky ? "HUMAN_REVIEW_REQUIRED" : "SKILL_COMPLETED",
          "EIRENE",
          { mode },
          context.actorId,
        ),
      ],
    };
  },
};
