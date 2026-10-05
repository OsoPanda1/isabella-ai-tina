/**
 * ================================================================
 * STORE AUTHORITY — Single Source of Truth (P0.5)
 * ================================================================
 * Isabella Mexa tiene varios mecanismos de persistencia (SQLite, Postgres,
 * Supabase, memoria, archivos JSON). Esta es la autoridad central que declara
 * CUÁL es la fuente de verdad para cada dominio y marca explícitamente qué
 * backends son NO autoritativos (solo caché/preview en proceso).
 *
 * Regla de resolución por defecto:
 *   1. Postgres  (POSTGRES_URL definido)  -> fuente de verdad durable
 *   2. SQLite    (data/isabella.db)       -> nodo único persistente
 *   3. Memoria / JSON                      -> NUNCA autoritativos; solo cache
 *                                            volátil o preview de desarrollo.
 *
 * No se debe tomar una decisión de negocio (saldo, permiso, clave) leyendo un
 * archivo JSON o un Map en memoria como si fuera autoritativo en producción.
 */

export type StoreBackend = "postgres" | "sqlite" | "supabase" | "memory" | "json";

export const NON_AUTHORITATIVE: ReadonlySet<StoreBackend> = new Set<StoreBackend>([
  "memory",
  "json",
]);

export interface StoreAuthority {
  /** Backend resuelto como fuente de verdad. */
  primary: StoreBackend;
  /** True si el backend primario es durable y apto para producción. */
  durable: boolean;
  /** True si el backend primario NO debe usarse como fuente de verdad. */
  advisoryOnly: boolean;
  /** Dominio económico: ledger autoritativo. */
  economyLedger: "creator-economy" | "wallet-cache";
  reason: string;
}

export function resolveStoreAuthority(): StoreAuthority {
  const hasPostgres = Boolean(process.env.POSTGRES_URL);
  const hasSupabase = Boolean(process.env.SUPABASE_URL);

  if (hasPostgres) {
    return {
      primary: "postgres",
      durable: true,
      advisoryOnly: false,
      economyLedger: "creator-economy",
      reason: "POSTGRES_URL presente: Postgres es la fuente de verdad durable.",
    };
  }
  if (hasSupabase) {
    return {
      primary: "supabase",
      durable: true,
      advisoryOnly: false,
      economyLedger: "creator-economy",
      reason: "SUPABASE_URL presente: Supabase es la fuente de verdad durable.",
    };
  }
  return {
    primary: "sqlite",
    durable: true,
    advisoryOnly: false,
    economyLedger: "creator-economy",
    reason:
      "Sin Postgres/Supabase: SQLite (data/isabella.db) es la fuente de verdad " +
      "para un nodo único persistente. Memoria y JSON son solo caché/preview.",
  };
}

/** Lanza si se intenta usar memoria/JSON como fuente de verdad en producción. */
export function assertNotAdvisoryOnly(context: string): void {
  const authority = resolveStoreAuthority();
  if (authority.advisoryOnly && (process.env.NODE_ENV === "production" || process.env.VERCEL)) {
    throw new Error(`store_advisory_only_in_production: ${context}`);
  }
}
