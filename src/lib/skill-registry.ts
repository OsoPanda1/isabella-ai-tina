import { z } from "zod";
import { capabilityRegistry, type CapabilityState } from "./capability-registry";

export const SkillId = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    if (
      value.startsWith("-") ||
      value.endsWith("-") ||
      value.startsWith(":") ||
      value.endsWith(":")
    )
      return false;
    for (const character of value) {
      const isAlphaNumeric =
        (character >= "a" && character <= "z") || (character >= "0" && character <= "9");
      if (!isAlphaNumeric && character !== "-" && character !== ":") return false;
    }
    return true;
  }, "Invalid skill id");
export type SkillStatus = Extract<
  CapabilityState,
  "implemented" | "verified" | "experimental" | "unavailable"
>;

export interface IsabellaSkill {
  id: string;
  name: string;
  description: string;
  folder: string;
  subfolder: string;
  capability: string;
  status: SkillStatus;
  requiredScopes: readonly string[];
  skillNumber?: number;
}

export const ISABELLA_SKILLS: readonly IsabellaSkill[] = [
  {
    id: "crown-routing",
    name: "CROWN Routing",
    description: "Clasifica intención y enruta la percepción entre los núcleos cognitivos.",
    folder: "Orquestación",
    subfolder: "CROWN",
    capability: "crown",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "argus-policy",
    name: "ARGUS Policy Gate",
    description: "Evalúa riesgo, permisos, datos sensibles y escalamiento humano antes de actuar.",
    folder: "Gobernanza",
    subfolder: "ARGUS",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "territorial-memory",
    name: "Memoria territorial",
    description: "Consulta memoria contextual con procedencia, alcance y trazabilidad territorial.",
    folder: "Memoria",
    subfolder: "Territorial",
    capability: "memory",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "audit-bundle",
    name: "Audit Bundle",
    description:
      "Construye evidencia auditable de decisiones, correlación y resultado del pipeline.",
    folder: "Gobernanza",
    subfolder: "Auditoría",
    capability: "audit",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "voice-synthesis",
    name: "Voz de Isabella",
    description: "Solicita síntesis vocal segura y la reproduce progresivamente en el navegador.",
    folder: "Interfaces",
    subfolder: "Voz",
    capability: "voice",
    status: "implemented",
    requiredScopes: ["isabella:voice"],
  },
  {
    id: "api-contracts",
    name: "APIs nativas",
    description: "Expone contratos registrados con validación de entrada y control de autoridad.",
    folder: "Orquestación",
    subfolder: "Contratos",
    capability: "build",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "monetization-ledger",
    name: "Ledger de monetización",
    description:
      "Registra consumo y movimientos económicos sin hacer saldos escribibles desde cliente.",
    folder: "Economía",
    subfolder: "BookPI",
    capability: "bookpi",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "sovereign-tools",
    name: "Herramientas soberanas",
    description:
      "Registra herramientas autorizables para ejecución controlada; requiere handler operativo.",
    folder: "Ejecución",
    subfolder: "Herramientas",
    capability: "tools",
    status: "experimental",
    requiredScopes: ["isabella:tools"],
  },
  {
    id: "marketplace-browse",
    name: "Marketplace",
    description:
      "Explora ofertas, productos y servicios territoriales — lectura paginada con tenant isolation.",
    folder: "Economía",
    subfolder: "Marketplace",
    capability: "monetization",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "offer-create",
    name: "Crear oferta",
    description:
      "Crea oferta con idempotencia, validación Zod y auditoría — requiere approval si riesgo alto.",
    folder: "Economía",
    subfolder: "Marketplace",
    capability: "monetization",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "gift-redeem",
    name: "Gifts y Rewards",
    description: "Redime gifts con verificación de saldo, idempotencia y ledger append-only.",
    folder: "Economía",
    subfolder: "Marketplace",
    capability: "monetization",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "payout-request",
    name: "Solicitar payout",
    description: "Solicita retiro 85/15 con reserva, disputa retenida y payout idempotente.",
    folder: "Economía",
    subfolder: "Payouts",
    capability: "monetization",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "payout-verify",
    name: "Verificar payout",
    description: "Verifica estado de payout, firma y reconciliación — solo lectura con RLS.",
    folder: "Economía",
    subfolder: "Payouts",
    capability: "monetization",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "monetization-analytics",
    name: "Analíticas de monetización",
    description: "Consulta métricas de consumo, ingresos y distribución territorial con RBAC.",
    folder: "Economía",
    subfolder: "Analíticas",
    capability: "monetization",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "creator-coach",
    name: "Coach del creador",
    description: "Asiste perfil → coach → skills → boosters → studio → assets con provenance.",
    folder: "Economía",
    subfolder: "Creator OS",
    capability: "monetization",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "skill-boost",
    name: "Boosters",
    description: "Aplica boosters de claridad, narrativa y localización sin prometer viralidad.",
    folder: "Economía",
    subfolder: "Creator OS",
    capability: "monetization",
    status: "implemented",
    requiredScopes: ["isabella:chat"],
  },
  // ==========================================================================
  // SKILLS NATIVOS EVOLUCIONADOS (733-754)
  // ==========================================================================
  {
    id: "firecrawl-market-research",
    skillNumber: 733,
    name: "Firecrawl Market Research",
    description:
      "Investigación profunda de mercado, tamaño de oportunidad (TAM/SAM/SOM), vectores competitivos y síntesis web.",
    folder: "Inteligencia Web",
    subfolder: "Mercados",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "firecrawl-monitor",
    skillNumber: 734,
    name: "Firecrawl Monitor",
    description:
      "Monitoreo continuo de cambios web, diffing semántico de DOM, alertas de precios y deriva de contenido.",
    folder: "Inteligencia Web",
    subfolder: "Monitoreo",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "ckm:brand",
    skillNumber: 735,
    name: "CKM Brand Identity",
    description:
      "Arquitectura de identidad de marca, contraste matemático WCAG AAA, escala tipográfica armónica y guía de tono.",
    folder: "Diseño & Marca",
    subfolder: "Identidad",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "ckm-brand",
    skillNumber: 735,
    name: "CKM Brand (Kebab Alias)",
    description: "Alias canónico de identidad de marca para compatibilidad con invocaciones CLI.",
    folder: "Diseño & Marca",
    subfolder: "Identidad",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "ckm:banner-design",
    skillNumber: 736,
    name: "CKM Banner Design",
    description:
      "Diseño de banners de alto impacto en relaciones 16:9, 1:1, 4:5 y 9:16 con respeto estricto de márgenes seguros.",
    folder: "Diseño & Marca",
    subfolder: "Displays",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "ckm-banner-design",
    skillNumber: 736,
    name: "CKM Banner Design (Kebab Alias)",
    description: "Alias canónico de diseño de banners para compatibilidad con invocaciones CLI.",
    folder: "Diseño & Marca",
    subfolder: "Displays",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "tavily-search",
    skillNumber: 737,
    name: "Tavily Search",
    description:
      "Búsqueda web fáctica optimizada para LLMs con filtrado de granjas SEO y extracción de citas y evidencias.",
    folder: "Búsqueda & Conocimiento",
    subfolder: "Fáctico",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "ckm:slides",
    skillNumber: 738,
    name: "CKM Presentation Slides",
    description:
      "Estructuración de diapositivas ejecutivas con arquetipos canónicos de presentación y narrativa de alto impacto.",
    folder: "Diseño & Marca",
    subfolder: "Presentaciones",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "ckm-slides",
    skillNumber: 738,
    name: "CKM Slides (Kebab Alias)",
    description: "Alias canónico de diapositivas para compatibilidad con invocaciones CLI.",
    folder: "Diseño & Marca",
    subfolder: "Presentaciones",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "flutter-add-widget-test",
    skillNumber: 739,
    name: "Flutter Add Widget Test",
    description:
      "Generación de pruebas unitarias de widgets Flutter con WidgetTester, finders y aserciones de accesibilidad.",
    folder: "Calidad & Testing",
    subfolder: "Flutter",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "browser-testing-with-devtools",
    skillNumber: 740,
    name: "Browser Testing with DevTools",
    description:
      "Auditoría automatizada de Core Web Vitals (LCP/CLS/INP), accesibilidad axe-core y captura de errores de consola.",
    folder: "Calidad & Testing",
    subfolder: "Web Vitals",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "firecrawl-seo-audit",
    skillNumber: 741,
    name: "Firecrawl SEO Audit",
    description:
      "Auditoría SEO técnica profunda: OpenGraph, marcado schema.org JSON-LD, sitemaps y jerarquía semántica.",
    folder: "Inteligencia Web",
    subfolder: "SEO",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "baoyu-infographic",
    skillNumber: 742,
    name: "Baoyu Infographic",
    description:
      "Desglose visual de conocimiento en infografías conceptuales estructuradas, esquemas SVG y modelos visuales.",
    folder: "Diseño & Marca",
    subfolder: "Infografías",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "firecrawl-knowledge-base",
    skillNumber: 743,
    name: "Firecrawl Knowledge Base",
    description:
      "Rastreo de portales documentales, limpieza de markdown y particionamiento semántico listo para ingesta RAG.",
    folder: "Búsqueda & Conocimiento",
    subfolder: "RAG & Docs",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "ci-cd-and-automation",
    skillNumber: 744,
    name: "CI/CD and Automation",
    description:
      "Formulación de pipelines de integración y entrega continua con análisis de seguridad SAST y compuertas de despliegue.",
    folder: "DevOps & Despliegue",
    subfolder: "Pipelines",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "firecrawl-workflows",
    skillNumber: 745,
    name: "Firecrawl Workflows",
    description:
      "Orquestación de flujos de extracción web multiciclo: Crawl → Extract → Validate → Webhook.",
    folder: "Inteligencia Web",
    subfolder: "Flujos ETL",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "baoyu-markdown-to-html",
    skillNumber: 746,
    name: "Baoyu Markdown to HTML",
    description:
      "Conversión de markdown a HTML semántico de alta artesanía, tipografía responsiva y sanitización estricta.",
    folder: "Diseño & Marca",
    subfolder: "Documentos",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "firecrawl-dashboard-reporting",
    skillNumber: 747,
    name: "Firecrawl Dashboard Reporting",
    description:
      "Generación de tableros ejecutivos a partir de métricas web extraídas, con tendencias y resúmenes de KPI.",
    folder: "Inteligencia Web",
    subfolder: "Reportes",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "swiftui-expert-skill",
    skillNumber: 748,
    name: "SwiftUI Expert Skill",
    description:
      "Desarrollo y optimización experta en SwiftUI: macro @Observable, concurrencia Swift moderna y NavigationStack.",
    folder: "Ingeniería de Software",
    subfolder: "Apple / Swift",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "source-driven-development",
    skillNumber: 749,
    name: "Source-Driven Development",
    description:
      "Desarrollo dirigido por especificación: generación de contratos tipados, validación AST y prevención de deriva.",
    folder: "Ingeniería de Software",
    subfolder: "Arquitectura",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "firecrawl-lead-gen",
    skillNumber: 750,
    name: "Firecrawl Lead Gen",
    description:
      "Descubrimiento de oportunidades B2B, extracción estructurada de empresas y calificación con cumplimiento ético.",
    folder: "Inteligencia Web",
    subfolder: "Prospección",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "shipping-and-launch",
    skillNumber: 751,
    name: "Shipping and Launch",
    description:
      "Checklist integral de preparación para lanzamiento productivo, verificación de rollback y compuertas operativas.",
    folder: "DevOps & Despliegue",
    subfolder: "Lanzamientos",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "firecrawl-lead-research",
    skillNumber: 752,
    name: "Firecrawl Lead Research",
    description:
      "Dossier profundo sobre organizaciones objetivo: tecnología, modelo de negocio, directivos y propuesta de valor.",
    folder: "Inteligencia Web",
    subfolder: "Dossiers",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "flutter-add-integration-test",
    skillNumber: 753,
    name: "Flutter Add Integration Test",
    description:
      "Construcción de pruebas de integración extremo a extremo para Flutter con la biblioteca integration_test.",
    folder: "Calidad & Testing",
    subfolder: "Flutter E2E",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
  {
    id: "firecrawl-competitive-intel",
    skillNumber: 754,
    name: "Firecrawl Competitive Intel",
    description:
      "Monitoreo continuo de competidores: cambios en precios, matrices de paridad de funciones y recomendaciones estratégicas.",
    folder: "Inteligencia Web",
    subfolder: "Competencia",
    capability: "crown",
    status: "verified",
    requiredScopes: ["isabella:chat"],
  },
];

export interface SkillInvocation {
  skill: IsabellaSkill;
  prompt: string;
  invocation: string;
}

export function parseSkillInvocation(
  input: string,
): { requestedId: string; prompt: string; invocation: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("@")) return null;
  const separator = trimmed.search(/[\t\n\r ]/);
  const token = separator === -1 ? trimmed : trimmed.slice(0, separator);
  const requestedId = token.slice(1).toLowerCase();
  if (!requestedId || !SkillId.safeParse(requestedId).success) return null;
  return {
    requestedId,
    prompt: separator === -1 ? "" : trimmed.slice(separator).trim(),
    invocation: token,
  };
}

export function resolveSkillInvocation(
  input: string,
): SkillInvocation | { error: string; code: string } | null {
  const parsed = parseSkillInvocation(input);
  if (!parsed) return null;
  const skill = ISABELLA_SKILLS.find((item) => item.id === parsed.requestedId);
  if (!skill)
    return {
      error: `Skill no registrado: @${parsed.requestedId}`,
      code: "SKILL_NOT_FOUND",
    };
  if (!capabilityRegistry.isOperational(skill.capability) && skill.status !== "experimental") {
    return {
      error: `Skill no operativo: @${skill.id}`,
      code: "SKILL_UNAVAILABLE",
    };
  }
  return { skill, prompt: parsed.prompt, invocation: parsed.invocation };
}

export function skillGroups(): Array<{
  folder: string;
  items: IsabellaSkill[];
}> {
  const groups = new Map<string, IsabellaSkill[]>();
  for (const skill of ISABELLA_SKILLS)
    groups.set(skill.folder, [...(groups.get(skill.folder) ?? []), skill]);
  return [...groups.entries()].map(([folder, items]) => ({ folder, items }));
}
