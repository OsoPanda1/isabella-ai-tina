import { createAuditEvent, IsabellaSkill, SkillResult } from "./contracts";

// ============================================================================
// 9. CITEMESH (Federated Mesh Coordination)
// ============================================================================
export interface CiteMeshInput {
  nodes: Array<{
    id: string;
    federation: string;
    meshHealth: number;
    latencyMs: number;
    synchronized: boolean;
    critical: boolean;
  }>;
}

export interface CiteMeshOutput {
  networkHealth: "HEALTHY" | "DEGRADED" | "PARTITIONED";
  unhealthyNodes: string[];
  resilienceActions: string[];
}

export const CITEMESH: IsabellaSkill<CiteMeshInput, CiteMeshOutput> = {
  id: "CITEMESH",
  name: "Federated Mesh Coordination",
  version: "v.GENESIS",
  federation: "INFRASTRUCTURE",
  risk: "HIGH",
  description: "Evalúa salud federada, detecta particiones y propone acciones de resiliencia.",
  canRun: (input) => Boolean(input.nodes?.length),
  async run(input, context): Promise<SkillResult<CiteMeshOutput>> {
    const unhealthyNodes = input.nodes
      .filter((node) => node.meshHealth < 0.65 || !node.synchronized || node.latencyMs > 1500)
      .map((node) => node.id);

    const criticalFailures = input.nodes.filter(
      (node) => node.critical && (node.meshHealth < 0.5 || !node.synchronized),
    ).length;

    const networkHealth =
      criticalFailures > 0 ? "PARTITIONED" : unhealthyNodes.length ? "DEGRADED" : "HEALTHY";

    const resilienceActions =
      networkHealth === "PARTITIONED"
        ? [
            "Aislar rutas defectuosas sin detener nodos sanos.",
            "Promover réplica verificada desde nodos disponibles.",
            "Notificar a la guardianía técnica para recuperación.",
          ]
        : networkHealth === "DEGRADED"
          ? ["Priorizar sincronización incremental.", "Revisar rutas de baja salud."]
          : ["Mantener monitoreo y réplica preventiva."];

    return {
      skillId: "CITEMESH",
      status: networkHealth === "PARTITIONED" ? "ESCALATED" : "SUCCESS",
      summary: `CITEMESH clasificó la red como ${networkHealth}.`,
      data: { networkHealth, unhealthyNodes, resilienceActions },
      evidence: [],
      warnings: unhealthyNodes.map((id) => `Nodo degradado: ${id}`),
      requiresHumanReview: networkHealth === "PARTITIONED",
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "CITEMESH",
          { nodeCount: input.nodes.length },
          context.actorId,
        ),
        createAuditEvent(
          "SKILL_COMPLETED",
          "CITEMESH",
          { networkHealth, unhealthyNodes },
          context.actorId,
        ),
      ],
    };
  },
};

// ============================================================================
// 21. HEPHAESTUS (Sovereign Architecture Builder)
// ============================================================================
export interface HephaestusInput {
  feature: string;
  requirements: string[];
  target: "TYPESCRIPT_MODULE" | "OPENAPI_ENDPOINT" | "ADR" | "TEST_PLAN";
}

export interface HephaestusOutput {
  artifactName: string;
  files: Array<{
    path: string;
    purpose: string;
  }>;
  acceptanceCriteria: string[];
}

export const HEPHAESTUS: IsabellaSkill<HephaestusInput, HephaestusOutput> = {
  id: "HEPHAESTUS",
  name: "Sovereign Architecture Builder",
  version: "v.GENESIS",
  federation: "INFRASTRUCTURE",
  risk: "HIGH",
  description:
    "Deriva artefactos técnicos y criterios de aceptación a partir de requerimientos gobernados.",
  canRun: (input) => Boolean(input.feature?.trim() && input.requirements?.length),
  async run(input, context): Promise<SkillResult<HephaestusOutput>> {
    const slug = input.feature
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const extension =
      input.target === "TYPESCRIPT_MODULE"
        ? "ts"
        : input.target === "OPENAPI_ENDPOINT"
          ? "yaml"
          : "md";

    const files = [
      {
        path: `core/isabella/${slug}.${extension}`,
        purpose: `Implementación o definición principal de ${input.feature}.`,
      },
      {
        path: `core/isabella/${slug}.test.ts`,
        purpose: "Pruebas de comportamiento, política y regresión.",
      },
    ];

    const acceptanceCriteria = [
      "Validación de entrada antes de ejecutar lógica.",
      "Eventos de auditoría generados para invocación y resultado.",
      "Respeto de políticas GEMET y VIGIA antes de efectos sensibles.",
      ...input.requirements.map((requirement) => `Requisito: ${requirement}`),
    ];

    return {
      skillId: "HEPHAESTUS",
      status: "SUCCESS",
      summary: `HEPHAESTUS generó un plan técnico para ${input.feature}.`,
      data: {
        artifactName: slug,
        files,
        acceptanceCriteria,
      },
      evidence: [],
      warnings: [],
      auditEvents: [
        createAuditEvent(
          "SKILL_INVOKED",
          "HEPHAESTUS",
          { feature: input.feature, target: input.target },
          context.actorId,
        ),
        createAuditEvent("SKILL_COMPLETED", "HEPHAESTUS", { artifactName: slug }, context.actorId),
      ],
    };
  },
};
