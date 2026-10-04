/**
 * REGISTRO DE HERRAMIENTAS — WHITELIST ZERO TRUST (src/lib/tool-registry.ts)
 * -----------------------------------------------------------------
 * Catálogo canónico de herramientas autorizadas. Real, sin mockdata:
 *  - Cada herramienta declara propósito, entrada, salida, riesgo,
 *    permisos, tiempo máximo, reintentos y evento de auditoría (§9).
 *  - Ninguna herramienta puede ejecutarse si no está registrada aquí
 *    (deny-by-default / fail-closed).
 *  - El registro NO decide autoridad: la política (`policy-engine`) y
 *    la autorización (`authorization.ts`) deciden; este registro solo
 *    define la whitelist y sus metadatos operativos.
 */

import { grantedPermissions, ROLES, type Permission, type Role } from "./rbac";

export type ToolRisk = "low" | "medium" | "high" | "critical";
export type ToolCategory =
  "memory" | "ledger" | "compute" | "storage" | "network" | "identity" | "system" | "creativity";

export interface RegisteredTool {
  name: string;
  purpose: string;
  inputSchemaDescription: string;
  outputDescription: string;
  risk: ToolRisk;
  requiredPermissions: readonly string[];
  maxTimeMs: number;
  maxRetries: number;
  auditEvent: string;
  category: ToolCategory;
  /** Si true, la ejecución requiere aprobación humana previa. */
  requiresApproval: boolean;
  /** Si true, nunca debe enviarse a ningún tercero. */
  territorialBoundary: boolean;
}

export interface ToolExecutionDecision {
  allowed: boolean;
  reason: string;
}

export const TOOL_REGISTRY_SEED: readonly RegisteredTool[] = [
  {
    name: "memory.retrieve",
    purpose: "Recuperar contexto de memoria dentro del scope y tenant autorizados.",
    inputSchemaDescription: "tenantId, actorId, scope, sensitivity",
    outputDescription: "Registros de memoria filtrados por autorización.",
    risk: "medium",
    requiredPermissions: ["memory:read"],
    maxTimeMs: 2000,
    maxRetries: 0,
    auditEvent: "tool.memory.retrieve",
    category: "memory",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "memory.record",
    purpose: "Persistir una pieza de memoria con consentimiento y procedencia.",
    inputSchemaDescription: "content, scope, sensitivity, purpose, consent",
    outputDescription: "Registro de memoria persistido con hash de integridad.",
    risk: "medium",
    requiredPermissions: ["memory:write"],
    maxTimeMs: 2000,
    maxRetries: 0,
    auditEvent: "tool.memory.record",
    category: "memory",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "ledger.record",
    purpose: "Registrar un asiento inmutable en el libro mayor BookPI.",
    inputSchemaDescription: "tenantId, userId, operation, category, cost, tokens",
    outputDescription: "Bloque BookPI encadenado criptográficamente.",
    risk: "high",
    requiredPermissions: ["ledger:write"],
    maxTimeMs: 1500,
    maxRetries: 0,
    auditEvent: "tool.ledger.record",
    category: "ledger",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "compute.sandbox",
    purpose: "Ejecutar tarea aislada en contenedor/WASM bajo sandbox soberano.",
    inputSchemaDescription: "command, envVars, inputPayload (solo fuentes autorizadas)",
    outputDescription: "Resultado de ejecución aislada con verificación.",
    risk: "critical",
    requiredPermissions: ["compute:execute"],
    maxTimeMs: 2500,
    maxRetries: 0,
    auditEvent: "tool.compute.sandbox",
    category: "compute",
    requiresApproval: true,
    territorialBoundary: true,
  },
  {
    name: "storage.read",
    purpose: "Leer datos de repositorio autorizado dentro de la frontera de tenant.",
    inputSchemaDescription: "tenantId, path, scope",
    outputDescription: "Contenido leído tras verificación de policy.",
    risk: "medium",
    requiredPermissions: ["storage:read"],
    maxTimeMs: 2000,
    maxRetries: 1,
    auditEvent: "tool.storage.read",
    category: "storage",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "identity.resolve",
    purpose: "Resolver identidad/roles/scopes de un principal en el servidor.",
    inputSchemaDescription: "token/session, tenantId",
    outputDescription: "Perfil de identidad autoritativo.",
    risk: "high",
    requiredPermissions: ["identity:read"],
    maxTimeMs: 1500,
    maxRetries: 0,
    auditEvent: "tool.identity.resolve",
    category: "identity",
    requiresApproval: false,
    territorialBoundary: false,
  },
  // 733-754: Evolved Skills Whitelist
  {
    name: "firecrawl.market_research",
    purpose: "Investigación profunda de mercado, tamaño de oportunidad y vectores de competencia.",
    inputSchemaDescription: "industry, depth, competitors",
    outputDescription: "Dossier de inteligencia de mercado con estimación TAM/SAM/SOM.",
    risk: "low",
    requiredPermissions: ["market:read"],
    maxTimeMs: 5000,
    maxRetries: 1,
    auditEvent: "tool.firecrawl.market_research",
    category: "network",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "firecrawl.monitor",
    purpose: "Monitoreo continuo de cambios web y diffing semántico de DOM.",
    inputSchemaDescription: "url, frequency",
    outputDescription: "Snapshot de diffing y reporte de variaciones estructurales.",
    risk: "low",
    requiredPermissions: ["monitor:read"],
    maxTimeMs: 3000,
    maxRetries: 1,
    auditEvent: "tool.firecrawl.monitor",
    category: "network",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "ckm.brand",
    purpose: "Arquitectura de identidad de marca, contraste matemático WCAG AAA y guía de tono.",
    inputSchemaDescription: "brandName, industry",
    outputDescription: "Tokens de diseño, paleta contrastada y escala tipográfica.",
    risk: "low",
    requiredPermissions: ["brand:write"],
    maxTimeMs: 2000,
    maxRetries: 0,
    auditEvent: "tool.ckm.brand",
    category: "creativity",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "ckm.banner_design",
    purpose: "Diseño de banners multiformato (16:9, 1:1, 9:16) con márgenes y balance visual.",
    inputSchemaDescription: "headline, subline, cta",
    outputDescription: "Matriz geométrica de banners para múltiples relaciones de aspecto.",
    risk: "low",
    requiredPermissions: ["banner:write"],
    maxTimeMs: 2000,
    maxRetries: 0,
    auditEvent: "tool.ckm.banner_design",
    category: "creativity",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "tavily.search",
    purpose: "Búsqueda web fáctica optimizada para LLMs con filtrado de granjas de spam.",
    inputSchemaDescription: "query, maxResults",
    outputDescription: "Resultados clasificados con citas directas y puntuación de relevancia.",
    risk: "low",
    requiredPermissions: ["search:read"],
    maxTimeMs: 4000,
    maxRetries: 1,
    auditEvent: "tool.tavily.search",
    category: "network",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "ckm.slides",
    purpose: "Estructuración de diapositivas ejecutivas con arquetipos canónicos de presentación.",
    inputSchemaDescription: "topic, targetAudience",
    outputDescription: "Deck estructurado de 5 diapositivas ejecutivas.",
    risk: "low",
    requiredPermissions: ["slides:write"],
    maxTimeMs: 2000,
    maxRetries: 0,
    auditEvent: "tool.ckm.slides",
    category: "creativity",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "flutter.add_widget_test",
    purpose: "Generación de pruebas unitarias de widgets Flutter con WidgetTester.",
    inputSchemaDescription: "widgetName",
    outputDescription: "Harness de prueba en Dart con aserciones semánticas.",
    risk: "low",
    requiredPermissions: ["testing:write"],
    maxTimeMs: 2500,
    maxRetries: 0,
    auditEvent: "tool.flutter.add_widget_test",
    category: "compute",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "browser.testing_with_devtools",
    purpose: "Auditoría automatizada de Core Web Vitals, accesibilidad axe-core y consola.",
    inputSchemaDescription: "url",
    outputDescription: "Métricas LCP/CLS/INP y reporte de accesibilidad.",
    risk: "low",
    requiredPermissions: ["testing:execute"],
    maxTimeMs: 4000,
    maxRetries: 0,
    auditEvent: "tool.browser.testing_with_devtools",
    category: "compute",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "firecrawl.seo_audit",
    purpose: "Auditoría SEO técnica profunda: OpenGraph, JSON-LD schema y jerarquía de títulos.",
    inputSchemaDescription: "url",
    outputDescription: "Checklist de indexabilidad y puntaje de salud SEO.",
    risk: "low",
    requiredPermissions: ["seo:read"],
    maxTimeMs: 3500,
    maxRetries: 1,
    auditEvent: "tool.firecrawl.seo_audit",
    category: "network",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "baoyu.infographic",
    purpose: "Desglose visual de conocimiento en infografías conceptuales estructuradas.",
    inputSchemaDescription: "concept",
    outputDescription: "Esquema vectorial de nodos y flujos conceptuales.",
    risk: "low",
    requiredPermissions: ["infographic:write"],
    maxTimeMs: 2000,
    maxRetries: 0,
    auditEvent: "tool.baoyu.infographic",
    category: "creativity",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "firecrawl.knowledge_base",
    purpose: "Rastreo de documentación técnica y particionamiento semántico para ingesta RAG.",
    inputSchemaDescription: "docUrl",
    outputDescription: "Chunks semánticos particionados y calificados para indexación.",
    risk: "low",
    requiredPermissions: ["kb:read"],
    maxTimeMs: 5000,
    maxRetries: 1,
    auditEvent: "tool.firecrawl.knowledge_base",
    category: "network",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "cicd.automation",
    purpose: "Formulación de pipelines CI/CD con análisis SAST y verificación de compuertas.",
    inputSchemaDescription: "projectType, provider",
    outputDescription: "Workflow declarativo YAML con compuertas de seguridad.",
    risk: "medium",
    requiredPermissions: ["cicd:write"],
    maxTimeMs: 2500,
    maxRetries: 0,
    auditEvent: "tool.cicd.automation",
    category: "compute",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "firecrawl.workflows",
    purpose: "Orquestación de flujos de extracción web multiciclo y webhooks.",
    inputSchemaDescription: "workflowName",
    outputDescription: "Plan de ejecución DAG con reintentos y validación de políticas.",
    risk: "medium",
    requiredPermissions: ["workflows:execute"],
    maxTimeMs: 4000,
    maxRetries: 1,
    auditEvent: "tool.firecrawl.workflows",
    category: "network",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "baoyu.markdown_to_html",
    purpose: "Conversión de markdown a HTML semántico de alta artesanía con sanitización.",
    inputSchemaDescription: "markdown",
    outputDescription: "HTML semántico accesible y sanitizado sin inyección de scripts.",
    risk: "low",
    requiredPermissions: ["render:read"],
    maxTimeMs: 1500,
    maxRetries: 0,
    auditEvent: "tool.baoyu.markdown_to_html",
    category: "creativity",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "firecrawl.dashboard_reporting",
    purpose: "Generación de tableros ejecutivos a partir de métricas web extraídas.",
    inputSchemaDescription: "reportName",
    outputDescription: "Resumen ejecutivo con indicadores clave de rendimiento (KPIs).",
    risk: "low",
    requiredPermissions: ["reporting:read"],
    maxTimeMs: 2500,
    maxRetries: 0,
    auditEvent: "tool.firecrawl.dashboard_reporting",
    category: "network",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "swiftui.expert_skill",
    purpose: "Desarrollo y optimización en SwiftUI moderno con macro @Observable y Swift 6.",
    inputSchemaDescription: "viewName",
    outputDescription: "Código Swift compilable con arquitectura NavigationStack y accesibilidad.",
    risk: "low",
    requiredPermissions: ["swiftui:write"],
    maxTimeMs: 2000,
    maxRetries: 0,
    auditEvent: "tool.swiftui.expert_skill",
    category: "compute",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "source_driven.development",
    purpose:
      "Desarrollo guiado por especificación: generación de contratos y prevención de deriva.",
    inputSchemaDescription: "specName",
    outputDescription: "Manifiesto de contratos tipados, esquemas Zod e invariantes AST.",
    risk: "low",
    requiredPermissions: ["spec:write"],
    maxTimeMs: 2000,
    maxRetries: 0,
    auditEvent: "tool.source_driven.development",
    category: "compute",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "firecrawl.lead_gen",
    purpose: "Descubrimiento de oportunidades B2B y prospección calificada bajo normas éticas.",
    inputSchemaDescription: "industrySector, location",
    outputDescription: "Listado de entidades descubiertas con calificación de afinidad.",
    risk: "medium",
    requiredPermissions: ["leadgen:read"],
    maxTimeMs: 4000,
    maxRetries: 1,
    auditEvent: "tool.firecrawl.lead_gen",
    category: "network",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "shipping.launch",
    purpose: "Checklist integral de preparación de despliegue a producción y reversión.",
    inputSchemaDescription: "releaseVersion, targetEnv",
    outputDescription: "Evaluación de compuertas de seguridad y decisión de lanzamiento.",
    risk: "medium",
    requiredPermissions: ["launch:execute"],
    maxTimeMs: 3000,
    maxRetries: 0,
    auditEvent: "tool.shipping.launch",
    category: "system",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "firecrawl.lead_research",
    purpose: "Dossier profundo sobre organizaciones objetivo: tecnología, directivos y propuesta.",
    inputSchemaDescription: "organization",
    outputDescription: "Dossier estructurado con análisis de madurez digital.",
    risk: "low",
    requiredPermissions: ["research:read"],
    maxTimeMs: 3500,
    maxRetries: 1,
    auditEvent: "tool.firecrawl.lead_research",
    category: "network",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "flutter.add_integration_test",
    purpose: "Construcción de pruebas de integración extremo a extremo para Flutter.",
    inputSchemaDescription: "flowName",
    outputDescription: "Suite de pruebas E2E con IntegrationTestWidgetsFlutterBinding.",
    risk: "low",
    requiredPermissions: ["testing:write"],
    maxTimeMs: 2500,
    maxRetries: 0,
    auditEvent: "tool.flutter.add_integration_test",
    category: "compute",
    requiresApproval: false,
    territorialBoundary: false,
  },
  {
    name: "firecrawl.competitive_intel",
    purpose: "Monitoreo continuo de competidores y matrices de paridad de características.",
    inputSchemaDescription: "sector, competitor",
    outputDescription: "Matriz comparativa y recomendaciones de contra-posicionamiento.",
    risk: "low",
    requiredPermissions: ["intel:read"],
    maxTimeMs: 3500,
    maxRetries: 1,
    auditEvent: "tool.firecrawl.competitive_intel",
    category: "network",
    requiresApproval: false,
    territorialBoundary: false,
  },
];

/**
 * Crea el registro de herramientas. La lista puede inyectarse (para test),
 * pero el comportamiento default es deny-by-default: toda herramienta no
 * registrada se considera NO autorizada.
 */

/**
 * Mapa EXPLÍCITO de los permisos declarados por herramienta (ISA-164) al
 * catálogo RBAC: un permiso de herramienta queda satisfecho si el rol posee
 * ALGUNO de los permisos RBAC equivalentes. Sin entrada en este mapa la
 * herramienta queda DENEGADA (fail-closed): añadir un permiso nuevo al
 * registro exige declarar aquí qué rol puede ejecutarlo.
 */
const READ_ONLY_PERMISSIONS: readonly Permission[] = [
  "tool:execute:readonly",
  "tool:execute",
  "system:admin",
];
const WRITE_PERMISSIONS: readonly Permission[] = ["tool:execute", "system:admin"];

const TOOL_PERMISSION_TO_RBAC: Record<string, readonly Permission[]> = {
  // Datos / ledger / cómputo con equivalencia directa en RBAC.
  "memory:read": [
    "memory:read:own",
    "memory:read:territorial",
    "memory:read:restricted",
    "memory:admin",
  ],
  "memory:write": ["memory:write:own", "memory:admin"],
  "ledger:write": ["ledger:write", "ledger:refund"],
  "compute:execute": ["sandbox:run", "tool:execute"],
  // Lecturas (herramientas sin side effects): el rol de sólo-lectura las ve.
  "storage:read": READ_ONLY_PERMISSIONS,
  "identity:read": READ_ONLY_PERMISSIONS,
  "market:read": READ_ONLY_PERMISSIONS,
  "monitor:read": READ_ONLY_PERMISSIONS,
  "search:read": READ_ONLY_PERMISSIONS,
  "seo:read": READ_ONLY_PERMISSIONS,
  "kb:read": READ_ONLY_PERMISSIONS,
  "render:read": READ_ONLY_PERMISSIONS,
  "reporting:read": READ_ONLY_PERMISSIONS,
  "research:read": READ_ONLY_PERMISSIONS,
  "intel:read": READ_ONLY_PERMISSIONS,
  "leadgen:read": READ_ONLY_PERMISSIONS,
  // Escrituras y ejecuciones con side effects.
  "banner:write": WRITE_PERMISSIONS,
  "brand:write": WRITE_PERMISSIONS,
  "cicd:write": WRITE_PERMISSIONS,
  "infographic:write": WRITE_PERMISSIONS,
  "slides:write": WRITE_PERMISSIONS,
  "spec:write": WRITE_PERMISSIONS,
  "swiftui:write": WRITE_PERMISSIONS,
  "testing:write": WRITE_PERMISSIONS,
  "launch:execute": WRITE_PERMISSIONS,
  "testing:execute": WRITE_PERMISSIONS,
  "workflows:execute": WRITE_PERMISSIONS,
};

/**
 * Devuelve los `requiredPermissions` de una herramienta que el rol NO posee
 * (ISA-164). Reglas:
 *  1. Coincidencia exacta con el catálogo RBAC.
 *  2. Emparejamiento jerárquico: `memory:read` queda cubierto por
 *     `memory:read:own` / `memory:read:territorial`.
 *  3. Permisos sin entrada en `TOOL_PERMISSION_TO_RBAC` quedan en `missing`.
 * Un rol desconocido otorga conjunto vacío (fail-closed).
 */
export function missingToolPermissions(
  tool: Pick<RegisteredTool, "requiredPermissions">,
  role: string,
): string[] {
  const granted: ReadonlySet<string> = ROLES.includes(role as Role)
    ? grantedPermissions(role as Role)
    : new Set<string>();
  const missing: string[] = [];
  for (const required of tool.requiredPermissions) {
    if (granted.has(required)) continue;
    if ([...granted].some((permission) => permission.startsWith(`${required}:`))) continue;
    const accepted = TOOL_PERMISSION_TO_RBAC[required];
    if (!accepted || !accepted.some((permission) => granted.has(permission))) {
      missing.push(required);
    }
  }
  return missing;
}

export function createToolRegistry(seed: readonly RegisteredTool[] = TOOL_REGISTRY_SEED) {
  const byName = new Map<string, RegisteredTool>();
  for (const tool of seed)
    byName.set(tool.name, {
      ...tool,
      requiredPermissions: [...tool.requiredPermissions],
    });

  return {
    /** Verifica si una herramienta está en la whitelist y qué riesgo tiene. */
    check(name: string): ToolExecutionDecision {
      const tool = byName.get(name);
      if (!tool) {
        return {
          allowed: false,
          reason: `Herramienta '${name}' no está en la whitelist Zero Trust.`,
        };
      }
      return {
        allowed: true,
        reason: `Herramienta '${name}' registrada con riesgo ${tool.risk}.`,
      };
    },

    /** Obtiene los metadatos completos de una herramienta, si existe. */
    lookup(name: string): RegisteredTool | null {
      const tool = byName.get(name);
      return tool ? { ...tool, requiredPermissions: [...tool.requiredPermissions] } : null;
    },

    list(): RegisteredTool[] {
      return seed.map((t) => ({
        ...t,
        requiredPermissions: [...t.requiredPermissions],
      }));
    },
  };
}

export type ToolRegistry = ReturnType<typeof createToolRegistry>;
export const TOOL_REGISTRY = {
  create: createToolRegistry,
};
