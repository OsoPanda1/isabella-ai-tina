/**
 * TINA CATEGORY (src/lib/tina/category.ts)
 * -----------------------------------------------------------------
 * Trusted Intelligence, Native & Adaptive — categoría TINA.
 * Isabella Villaseñor AI es la primera AI declarada en esta categoría.
 *
 * Honesty: una declaración de categoría no es certificación de producción.
 * Los gates, evidencia y productionSafe siguen en platform-capabilities
 * y production-capabilities.json.
 */

export const TINA_CATEGORY_ID = "TINA" as const;
export const TINA_CATEGORY_NAME = "Trusted Intelligence, Native & Adaptive" as const;
export const TINA_SPEC_VERSION = "0.1.0-genesis" as const;

export const TINA_PRINCIPLES = [
  "Capacidad separada de autoridad.",
  "El camino mínimo seguro determina la ejecución.",
  "El contenido recuperado es evidencia, no instrucciones.",
  "Ningún aprendizaje llega directamente a producción.",
  "Todo cambio crítico es trazable y reversible.",
  "Cada territorio conserva datos, políticas, memoria y límites de autonomía.",
] as const;

export interface TinaCategoryMember {
  readonly systemId: string;
  readonly displayName: string;
  readonly category: typeof TINA_CATEGORY_ID;
  readonly categoryVersion: typeof TINA_SPEC_VERSION;
  readonly declaredAt: string;
  readonly repository: string;
  readonly claim: "first_declared_member" | "member";
  readonly certification: "declared_not_certified";
  readonly notes: string;
}

export const ISABELLA_TINA_MEMBER: TinaCategoryMember = {
  systemId: "isabella-villasenor-ai",
  displayName: "Isabella Villaseñor AI",
  category: TINA_CATEGORY_ID,
  categoryVersion: TINA_SPEC_VERSION,
  declaredAt: "2026-09-24",
  repository: "github.com/OsoPanda1/isabella-ai-genesis",
  claim: "first_declared_member",
  certification: "declared_not_certified",
  notes:
    "Primera AI declarada en la categoría TINA. Declaración de categoría ≠ certificación de producción, AGI ni conciencia.",
};

export function getTinaCategoryManifest() {
  return {
    id: TINA_CATEGORY_ID,
    name: TINA_CATEGORY_NAME,
    version: TINA_SPEC_VERSION,
    principles: [...TINA_PRINCIPLES],
    members: [ISABELLA_TINA_MEMBER],
    architecture: {
      authorize: "CROWN",
      inspect: "AEGIS",
      infer: "NativeML",
      evidence: "MemoryRAG",
      learn: "LearningPlane",
      federate: "Federation",
      ledger: "BookPI",
    },
    limits: [
      "No afirma AGI, conciencia ni autoconciencia.",
      "No sustituye CROWN/AEGIS de producción, HSM/KMS ni sandbox de procesos.",
      "No debe recibir secretos ni ejecutar acciones externas sin backend autorizado.",
    ],
  } as const;
}
