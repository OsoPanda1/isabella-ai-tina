// ==== Isabella Persistence — autoridad de sistema (P0-02) ====
// Clasifica cada almacen como AUTHORITATIVE (PostgreSQL, source of truth) o
// TRANSIENT (SQLite/JSON, cache/local). El codigo de produccion DEBE invocar
// assertAuthoritativeBackend(nombre) antes de operar estado critico; si
// PostgreSQL no esta configurado, se rechaza usar almacen transitorio como
// fuente de verdad (fail-closed). SQLite/JSON = cache/transient, nunca SoR.

import { getPgPool } from "./postgres";

export type StoreTier = "authoritative" | "transient";

// Estado critico cuyo unico source of truth es PostgreSQL.
const STORE_TIER: Record<string, StoreTier> = {
  ledger: "authoritative",
  bookpi: "authoritative",
  economy: "authoritative",
  wallet: "authoritative",
  billing: "authoritative",
  apiKeys: "authoritative",
  audit: "authoritative",
  memory: "authoritative",
  sessions: "transient",
  durableJson: "transient",
  featureFlags: "transient",
  rateLimit: "transient",
};

export function getStoreTier(store: string): StoreTier {
  return STORE_TIER[store] ?? "transient";
}

export function isPostgresConfigured(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.POSTGRES_URL);
}

export function assertAuthoritativeBackend(store: string): void {
  if (getStoreTier(store) === "authoritative" && !isPostgresConfigured()) {
    throw new Error(
      `SYSTEM_OF_RECORD_MISSING: el almacen "${store}" es AUTHORITATIVE pero PostgreSQL no esta configurado. ` +
        `Se rechaza usar almacenamiento transitorio (SQLite/JSON) como fuente de verdad.`,
    );
  }
}

export function getPgPoolOrThrow(): NonNullable<ReturnType<typeof getPgPool>> {
  const pool = getPgPool();
  if (!pool) throw new Error("PostgreSQL unavailable");
  return pool;
}
