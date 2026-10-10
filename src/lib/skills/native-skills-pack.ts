import {
  createAuditEvent,
  nowIso,
  type IsabellaSkill,
  type SkillContext,
  type SkillResult,
} from "./contracts";

/**
 * Native capability pack derived from external skill patterns.
 *
 * The repository does not copy third-party implementations. It implements
 * equivalent, provider-neutral contracts inside Isabella and marks external
 * rendering/database work as unavailable until a real provider/runtime exists.
 */

type NativeOutput = {
  capability: string;
  version: string;
  execution: "native" | "provider-required";
  status: "ready" | "blocked";
  inputs: Record<string, unknown>;
  plan: string[];
  artifacts: string[];
  evidencePolicy: "repo-and-runtime-only";
  warnings: string[];
};

function result(
  skillId: string,
  context: SkillContext,
  data: NativeOutput,
  status: SkillResult<NativeOutput>["status"] = data.status === "ready" ? "SUCCESS" : "BLOCKED",
): SkillResult<NativeOutput> {
  return {
    skillId,
    status,
    summary:
      data.status === "ready"
        ? `${data.capability} preparado para ejecución nativa verificable.`
        : `${data.capability} requiere un proveedor externo o runtime que no está configurado.`,
    data,
    evidence: context.evidence ?? [],
    warnings: data.warnings,
    auditEvents: [
      createAuditEvent(
        "SKILL_COMPLETED",
        skillId,
        { execution: data.execution, status: data.status },
        context.actorId,
      ),
    ],
    requiresHumanReview: status === "ESCALATED" || status === "BLOCKED",
  };
}

function commonCanRun(input: Record<string, unknown>) {
  return Boolean(input && Object.keys(input).length > 0);
}

export const NATIVE_FRONTEND_DESIGN: IsabellaSkill<Record<string, unknown>, NativeOutput> = {
  id: "frontend-design",
  name: "Isabella Native Frontend Design",
  version: "1.0.0",
  federation: "INFRASTRUCTURE",
  risk: "LOW",
  description:
    "Sistema de diseño deliberado para interfaces Isabella: propósito, composición, tipografía, tokens, motion y accesibilidad.",
  canRun: commonCanRun,
  async run(input, context) {
    return result(this.id, context, {
      capability: "frontend-design",
      version: this.version,
      execution: "native",
      status: "ready",
      inputs: input,
      plan: [
        "Definir propósito, usuario y firma visual antes del layout.",
        "Usar tokens de color, tipografía, espaciado, radios y profundidad.",
        "Aplicar jerarquía visual, responsive design, keyboard access y reduced motion.",
        "Evitar layouts genéricos y gradients decorativos sin función.",
      ],
      artifacts: ["design-tokens", "component-spec", "accessibility-checklist"],
      evidencePolicy: "repo-and-runtime-only",
      warnings: [],
    });
  },
};

export const NATIVE_WEB_DESIGN_GUIDELINES: IsabellaSkill<Record<string, unknown>, NativeOutput> = {
  id: "web-design-guidelines",
  name: "Isabella Native Web Design Guidelines",
  version: "1.0.0",
  federation: "INFRASTRUCTURE",
  risk: "LOW",
  description:
    "Auditoría nativa de interfaz y accesibilidad basada en reglas verificables de interacción, contenido y responsive design.",
  canRun: commonCanRun,
  async run(input, context) {
    return result(this.id, context, {
      capability: "web-design-guidelines",
      version: this.version,
      execution: "native",
      status: "ready",
      inputs: input,
      plan: [
        "Revisar semántica HTML y nombres accesibles.",
        "Verificar foco visible, navegación por teclado y estados interactivos.",
        "Verificar responsive behavior, overflow, text wrapping y touch targets.",
        "Revisar loading, error, empty y reduced-motion states.",
      ],
      artifacts: ["ui-audit-report", "accessibility-findings"],
      evidencePolicy: "repo-and-runtime-only",
      warnings: [],
    });
  },
};

export const NATIVE_CAVEMAN: IsabellaSkill<Record<string, unknown>, NativeOutput> = {
  id: "caveman",
  name: "Isabella Native Compression Mode",
  version: "1.0.0",
  federation: "EDUCATION",
  risk: "LOW",
  description:
    "Modo de comunicación de baja verbosidad que conserva números, restricciones, código y negaciones.",
  canRun: commonCanRun,
  async run(input, context) {
    const mode = String(input.mode ?? "full");
    const allowed = new Set([
      "lite",
      "full",
      "ultra",
      "wenyan-lite",
      "wenyan-full",
      "wenyan-ultra",
      "off",
    ]);
    return result(this.id, context, {
      capability: "caveman",
      version: this.version,
      execution: "native",
      status: "ready",
      inputs: { ...input, mode: allowed.has(mode) ? mode : "full" },
      plan: [
        "Eliminar relleno, no contenido técnico.",
        "Conservar no/never/no, cifras, unidades, errores exactos y bloques de código.",
        "Desactivar compresión cuando pueda introducir ambigüedad de seguridad.",
      ],
      artifacts: ["response-policy"],
      evidencePolicy: "repo-and-runtime-only",
      warnings: [],
    });
  },
};

export const NATIVE_PRISMA_CLIENT_API: IsabellaSkill<Record<string, unknown>, NativeOutput> = {
  id: "prisma-client-api",
  name: "Isabella Native Prisma Client API",
  version: "1.0.0",
  federation: "INFRASTRUCTURE",
  risk: "HIGH",
  description:
    "Contrato nativo para CRUD, filtros, relaciones y transacciones Prisma sobre la autoridad PostgreSQL.",
  canRun: commonCanRun,
  async run(input, context) {
    return result(this.id, context, {
      capability: "prisma-client-api",
      version: this.version,
      execution: "native",
      status: "ready",
      inputs: input,
      plan: [
        "Resolver modelo y tenant explícitos.",
        "Aplicar select/include/where/orderBy sin ampliar superficie.",
        "Usar transacción para operaciones que deban ser atómicas.",
        "Registrar decisión y resultado en BookPI/auditoría cuando corresponda.",
      ],
      artifacts: ["query-plan", "transaction-boundary"],
      evidencePolicy: "repo-and-runtime-only",
      warnings: [],
    });
  },
};

export const NATIVE_PRISMA_CLI: IsabellaSkill<Record<string, unknown>, NativeOutput> = {
  id: "prisma-cli",
  name: "Isabella Native Prisma CLI",
  version: "1.0.0",
  federation: "INFRASTRUCTURE",
  risk: "HIGH",
  description:
    "Operación controlada de Prisma para generación, validación y migraciones reproducibles.",
  canRun: commonCanRun,
  async run(input, context) {
    return result(this.id, context, {
      capability: "prisma-cli",
      version: this.version,
      execution: "native",
      status: "ready",
      inputs: input,
      plan: [
        "Validar schema antes de aplicar cambios.",
        "Usar migraciones reproducibles en staging/production.",
        "Bloquear reset/push destructivo fuera de desarrollo explícito.",
        "Emitir evidencia de migración y versión de artefacto.",
      ],
      artifacts: ["migration-plan", "schema-check"],
      evidencePolicy: "repo-and-runtime-only",
      warnings: [],
    });
  },
};

export const NATIVE_PRISMA_DATABASE_SETUP: IsabellaSkill<Record<string, unknown>, NativeOutput> = {
  id: "prisma-database-setup",
  name: "Isabella Native Prisma Database Setup",
  version: "1.0.0",
  federation: "INFRASTRUCTURE",
  risk: "HIGH",
  description: "Contrato de configuración de Prisma y PostgreSQL con una única autoridad durable.",
  canRun: commonCanRun,
  async run(input, context) {
    return result(this.id, context, {
      capability: "prisma-database-setup",
      version: this.version,
      execution: "native",
      status: "ready",
      inputs: input,
      plan: [
        "Resolver DATABASE_URL como autoridad durable.",
        "Verificar provider PostgreSQL y migraciones aplicadas.",
        "Verificar conexión, aislamiento de tenant y salud de esquema.",
        "Rechazar JSON/memory como autoridad en production.",
      ],
      artifacts: ["database-preflight", "schema-contract"],
      evidencePolicy: "repo-and-runtime-only",
      warnings: [],
    });
  },
};

export const NATIVE_PRISMA_POSTGRES: IsabellaSkill<Record<string, unknown>, NativeOutput> = {
  id: "prisma-postgres",
  name: "Isabella Native Prisma Postgres",
  version: "1.0.0",
  federation: "INFRASTRUCTURE",
  risk: "HIGH",
  description:
    "Gobierno de conexiones PostgreSQL, regiones, migraciones y operación durable sin una segunda fuente de verdad.",
  canRun: commonCanRun,
  async run(input, context) {
    return result(this.id, context, {
      capability: "prisma-postgres",
      version: this.version,
      execution: "native",
      status: "ready",
      inputs: input,
      plan: [
        "Usar DATABASE_URL explícita.",
        "Separar migración, lectura y escritura por responsabilidad.",
        "Aplicar transacciones y locks para invariantes financieras.",
        "Verificar backup/restore antes de declarar producción segura.",
      ],
      artifacts: ["postgres-operational-contract"],
      evidencePolicy: "repo-and-runtime-only",
      warnings: [],
    });
  },
};

const MEDIA_PROVIDER_WARNING =
  "Render real requiere un proveedor de medios configurado. Esta skill no fabrica MP4, audio, imagen ni avatar.";

function mediaSkill(
  id: string,
  name: string,
  description: string,
  providerRequired = true,
): IsabellaSkill<Record<string, unknown>, NativeOutput> {
  return {
    id,
    name,
    version: "1.0.0",
    federation: "ETHICS_CULTURE",
    risk: "MEDIUM",
    description,
    canRun: commonCanRun,
    async run(input, context) {
      const hasProvider = Boolean(input.providerUrl || input.provider || input.providerConfigured);
      return result(this.id, context, {
        capability: id,
        version: this.version,
        execution: providerRequired && !hasProvider ? "provider-required" : "native",
        status: providerRequired && !hasProvider ? "blocked" : "ready",
        inputs: input,
        plan: [
          "Crear brief durable y conservar procedencia de assets.",
          "Validar relaciones de aspecto, duración, texto, safe zones y accesibilidad.",
          "Construir manifest determinista y composición verificable.",
          providerRequired
            ? "Enviar a renderer/proveedor externo solo después del gate humano."
            : "Usar renderer nativo disponible.",
        ],
        artifacts: ["media-brief", "storyboard", "composition-manifest"],
        evidencePolicy: "repo-and-runtime-only",
        warnings: providerRequired && !hasProvider ? [MEDIA_PROVIDER_WARNING] : [],
      });
    },
  };
}

export const NATIVE_PRODUCT_LAUNCH_VIDEO = mediaSkill(
  "product-launch-video",
  "Isabella Native Product Launch Video",
  "Pipeline estructurada para lanzamiento de producto con brief, storyboard, audio, composición y render.",
);
export const NATIVE_MOTION_GRAPHICS = mediaSkill(
  "motion-graphics",
  "Isabella Native Motion Graphics",
  "Pipeline breve de motion graphics orientada a diseño y mensaje visual.",
);
export const NATIVE_FACELESS_EXPLAINER = mediaSkill(
  "faceless-explainer",
  "Isabella Native Faceless Explainer",
  "Pipeline de explicación audiovisual desde texto, storyboard y composición.",
);
export const NATIVE_TALKING_HEAD_RECUT = mediaSkill(
  "talking-head-recut",
  "Isabella Native Talking Head Recut",
  "Capas gráficas sincronizadas sobre video existente, separadas de captions.",
);
export const NATIVE_EMBEDDED_CAPTIONS = mediaSkill(
  "embedded-captions",
  "Isabella Native Embedded Captions",
  "Composición de subtítulos legibles con safe zones y opción de embed cinematográfico.",
);
export const NATIVE_AI_VIDEO_GENERATION = mediaSkill(
  "ai-video-generation",
  "Isabella Native AI Video Generation",
  "Contrato de generación de video multimodelo con provider gate, trazabilidad y artefactos.",
);
export const NATIVE_AI_IMAGE_GENERATION = mediaSkill(
  "ai-image-generation",
  "Isabella Native AI Image Generation",
  "Contrato de generación de imágenes con briefing, restricciones de marca, provenance y provider gate.",
);

export const NATIVE_SKILLS_PACK = {
  "frontend-design": NATIVE_FRONTEND_DESIGN,
  "web-design-guidelines": NATIVE_WEB_DESIGN_GUIDELINES,
  caveman: NATIVE_CAVEMAN,
  "prisma-client-api": NATIVE_PRISMA_CLIENT_API,
  "prisma-cli": NATIVE_PRISMA_CLI,
  "prisma-database-setup": NATIVE_PRISMA_DATABASE_SETUP,
  "prisma-postgres": NATIVE_PRISMA_POSTGRES,
  "product-launch-video": NATIVE_PRODUCT_LAUNCH_VIDEO,
  "motion-graphics": NATIVE_MOTION_GRAPHICS,
  "faceless-explainer": NATIVE_FACELESS_EXPLAINER,
  "talking-head-recut": NATIVE_TALKING_HEAD_RECUT,
  "embedded-captions": NATIVE_EMBEDDED_CAPTIONS,
  "ai-video-generation": NATIVE_AI_VIDEO_GENERATION,
  "ai-image-generation": NATIVE_AI_IMAGE_GENERATION,
} as const;

export const NATIVE_SKILLS_VERSION = nowIso();
