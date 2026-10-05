/**
 * MARKETPLACE REPOSITORY (src/lib/repositories/marketplace-repository.ts)
 * -----------------------------------------------------------------
 * Fuente durable de listados del marketplace (tabla PG canónica).
 * Sin DATABASE_URL: falla cerrado (el llamador decide fallback dev).
 */

import { Pool } from "pg";
import { config } from "../config";

export interface MarketplaceListingRecord {
  skillId: string;
  title: string;
  costCents: number;
  ownerId: string;
  description: string;
  createdAt: string;
}

let pool: Pool | null = null;
let poolUrl: string | null = null;

function getPool(): Pool {
  const url = config().DATABASE_URL;
  if (!url) {
    throw new Error("Marketplace durable requiere DATABASE_URL.");
  }
  if (!pool || poolUrl !== url) {
    if (pool) void pool.end().catch(() => undefined);
    pool = new Pool({ connectionString: url, max: 3 });
    poolUrl = url;
  }
  return pool;
}

function mapRow(row: Record<string, unknown>): MarketplaceListingRecord {
  return {
    skillId: String(row.skill_id),
    title: String(row.title),
    costCents: Number(row.cost_cents),
    ownerId: String(row.owner_id),
    description: String(row.description),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

const SKILL_ID = /^[a-z0-9-]{3,64}$/;

export function validateMarketplaceInput(input: {
  skillId: string;
  title: string;
  costCents: number;
  description: string;
}): { valid: boolean; reason?: string } {
  if (!SKILL_ID.test(input.skillId)) {
    return {
      valid: false,
      reason: "skillId solo admite minúsculas, números y guiones (3-64).",
    };
  }
  if (input.title.length < 3 || input.title.length > 120) {
    return { valid: false, reason: "Título 3-120 caracteres." };
  }
  if (!Number.isInteger(input.costCents) || input.costCents <= 0 || input.costCents > 100_000) {
    return { valid: false, reason: "costCents entero 1-100000." };
  }
  if (input.description.length < 10 || input.description.length > 2000) {
    return { valid: false, reason: "Descripción 10-2000 caracteres." };
  }
  return { valid: true };
}

export async function listMarketplace(): Promise<MarketplaceListingRecord[]> {
  const { rows } = await getPool().query(
    "SELECT * FROM marketplace_listings ORDER BY created_at ASC",
  );
  return rows.map(mapRow);
}

export async function createMarketplaceListing(input: {
  skillId: string;
  title: string;
  costCents: number;
  ownerId: string;
  description: string;
}): Promise<{ created: boolean; listing: MarketplaceListingRecord }> {
  const validation = validateMarketplaceInput(input);
  if (!validation.valid) throw new Error(validation.reason);
  const { rows } = await getPool().query(
    `INSERT INTO marketplace_listings (skill_id, title, cost_cents, owner_id, description)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (skill_id) DO NOTHING
     RETURNING *`,
    [input.skillId, input.title, input.costCents, input.ownerId, input.description],
  );
  if (rows[0]) return { created: true, listing: mapRow(rows[0]) };
  const existing = await getPool().query(
    "SELECT * FROM marketplace_listings WHERE skill_id = $1 LIMIT 1",
    [input.skillId],
  );
  return { created: false, listing: mapRow(existing.rows[0]) };
}

export const MARKETPLACE_REPOSITORY = {
  list: listMarketplace,
  create: createMarketplaceListing,
  validate: validateMarketplaceInput,
};
