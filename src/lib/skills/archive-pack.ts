import { createAuditEvent, IsabellaSkill, SkillResult, unique } from "./contracts";

// ============================================================================
// 10. MNEMOSYNE (Living Institutional Memory)
// ============================================================================
export interface MnemosyneInput {
  artifact: {
    id: string;
    title: string;
    content: string;
    source: string;
    version?: string;
  };
  tags?: string[];
}

export interface MnemosyneOutput {
  memoryRecord: {
    id: string;
    title: string;
    summary: string;
    tags: string[];
    version: string;
    indexedAt: string;
  };
}

export const MNEMOSYNE: IsabellaSkill<MnemosyneInput, MnemosyneOutput> = {
  id: "MNEMOSYNE",
  name: "Living Institutional Memory",
  version: "v.GENESIS",
  federation: "CIVILIZATIONAL_ARCHIVE",
  risk: "MEDIUM",
  description: "Indexa, resume, etiqueta y versiona artefactos para la memoria del ecosistema.",
  canRun: (input) =>
    Boolean(input.artifact?.id && input.artifact?.title && input.artifact?.content),
  async run(input, context): Promise<SkillResult<MnemosyneOutput>> {
    const words = input.artifact.content.trim().split(/\s+/);
    const summary = words.slice(0, 80).join(" ").trim();

    const tags = unique([
      ...(input.tags ?? []),
      context.federation.toLowerCase(),
      "isabella-memory",
      "tamv",
      "rdm-digital",
    ]);

    const record = {
      id: input.artifact.id,
      title: input.artifact.title,
      summary: summary + (words.length > 80 ? "…" : ""),
      tags,
      version: input.artifact.version ?? "1.0.0",
      indexedAt: new Date().toISOString(),
    };

    return {
      skillId: "MNEMOSYNE",
      status: "SUCCESS",
      summary: `MNEMOSYNE indexó el artefacto “${record.title}”.`,
      data: { memoryRecord: record },
      evidence: [
        {
          id: input.artifact.id,
          source: input.artifact.source,
          excerpt: record.summary,
        },
      ],
      warnings: [],
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "MNEMOSYNE",
          { artifactId: input.artifact.id },
          context.actorId,
        ),
        createAuditEvent(
          "SKILL_COMPLETED",
          "MNEMOSYNE",
          { tags, version: record.version },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 14. CHRONOS (Temporal Continuity Engine)
// ============================================================================
export interface ChronosInput {
  events: Array<{
    id: string;
    title: string;
    timestamp: string;
    type: string;
  }>;
}

export interface ChronosOutput {
  timeline: Array<{
    id: string;
    title: string;
    timestamp: string;
    type: string;
  }>;
  temporalWarnings: string[];
}

export const CHRONOS: IsabellaSkill<ChronosInput, ChronosOutput> = {
  id: "CHRONOS",
  name: "Temporal Continuity Engine",
  version: "v.GENESIS",
  federation: "CIVILIZATIONAL_ARCHIVE",
  risk: "MEDIUM",
  description:
    "Ordena eventos, preserva trazabilidad temporal y señala inconsistencias cronológicas.",
  canRun: (input) => Boolean(input.events?.length),
  async run(input, context): Promise<SkillResult<ChronosOutput>> {
    const timeline = [...input.events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const temporalWarnings = timeline
      .filter((event) => Number.isNaN(new Date(event.timestamp).getTime()))
      .map((event) => `Timestamp inválido en ${event.id}.`);

    return {
      skillId: "CHRONOS",
      status: temporalWarnings.length ? "PARTIAL" : "SUCCESS",
      summary: `CHRONOS ordenó ${timeline.length} eventos temporales.`,
      data: { timeline, temporalWarnings },
      evidence: [],
      warnings: temporalWarnings,
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "CHRONOS",
          { eventCount: input.events.length },
          context.actorId,
        ),
        createAuditEvent(
          "SKILL_COMPLETED",
          "CHRONOS",
          { temporalWarnings: temporalWarnings.length },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 17. PROMETEO (Civilizational Compiler)
// ============================================================================
export interface PrometeoInput {
  documents: Array<{
    id: string;
    title: string;
    content: string;
  }>;
  target: "BLUEPRINT" | "API" | "BACKLOG" | "ARCHITECTURE";
}

export interface PrometeoOutput {
  target: string;
  inferredDomains: string[];
  proposedArtifacts: Array<{
    type: string;
    name: string;
    purpose: string;
  }>;
  gaps: string[];
}

export const PROMETEO: IsabellaSkill<PrometeoInput, PrometeoOutput> = {
  id: "PROMETEO",
  name: "Civilizational Compiler",
  version: "v.GENESIS",
  federation: "CIVILIZATIONAL_ARCHIVE",
  risk: "HIGH",
  description:
    "Convierte documentos y repositorios en blueprints, contratos y unidades implementables.",
  canRun: (input) => Boolean(input.documents?.length && input.target),
  async run(input, context): Promise<SkillResult<PrometeoOutput>> {
    const corpus = input.documents
      .map((doc) => `${doc.title} ${doc.content}`)
      .join(" ")
      .toLowerCase();

    const inferredDomains = unique(
      [
        corpus.includes("api") && "API",
        corpus.includes("seguridad") && "SECURITY",
        corpus.includes("turismo") && "TOURISM",
        corpus.includes("memoria") && "MEMORY",
        corpus.includes("territorio") && "TERRITORY",
        corpus.includes("educacion") && "EDUCATION",
      ].filter((v): v is string => typeof v === "string"),
    );

    const proposedArtifacts = inferredDomains.map((domain) => ({
      type: input.target,
      name: `${domain.toLowerCase()}-${input.target.toLowerCase()}`,
      purpose: `Artefacto generado para formalizar el dominio ${domain}.`,
    }));

    const gaps =
      inferredDomains.length === 0
        ? [
            "No se detectaron dominios suficientes.",
            "Se requiere documentación estructurada adicional.",
          ]
        : [];

    return {
      skillId: "PROMETEO",
      status: gaps.length ? "PARTIAL" : "SUCCESS",
      summary: `PROMETEO compiló ${input.documents.length} documentos hacia ${input.target}.`,
      data: {
        target: input.target,
        inferredDomains,
        proposedArtifacts,
        gaps,
      },
      evidence: input.documents.map((doc) => ({
        id: doc.id,
        source: doc.title,
        excerpt: doc.content.slice(0, 200),
      })),
      warnings: gaps,
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "PROMETEO",
          { target: input.target, documentCount: input.documents.length },
          context.actorId,
        ),
        createAuditEvent("SKILL_COMPLETED", "PROMETEO", { inferredDomains }, context.actorId),
      ],
    };
  },
};
