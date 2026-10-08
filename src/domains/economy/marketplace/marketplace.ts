import { randomBytes, createHash } from "node:crypto";
import type { MarketplaceListing, AssetType, ListingStatus } from "../types";

/* ========================================================================== *
 * Isabella Marketplace
 *
 * Central registry for agents, skills, knowledge packs, templates,
 * workflows, datasets, prompts, digital products, and services.
 * ========================================================================== */

const listings = new Map<string, MarketplaceListing>();

function generateId(): string {
  return `listing_${randomBytes(12).toString("hex")}`;
}

function computeContentHash(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

export function createListing(params: {
  tenantId: string;
  creatorId: string;
  assetType: AssetType;
  name: string;
  description: string;
  version?: string;
  price: number;
  currency?: string;
}): MarketplaceListing {
  const now = new Date().toISOString();
  const listing: MarketplaceListing = {
    id: generateId(),
    tenantId: params.tenantId,
    creatorId: params.creatorId,
    assetType: params.assetType,
    name: params.name,
    description: params.description,
    version: params.version || "1.0.0",
    price: params.price,
    currency: params.currency || "USD",
    status: "active",
    qualityScore: 0.5,
    securityScore: 0.5,
    evidenceScore: 0.5,
    usageCount: 0,
    revenue: 0,
    provenance: {
      creatorId: params.creatorId,
      createdFrom: "user_creation",
      evidenceIds: [],
      auditTrailId: `audit_${randomBytes(8).toString("hex")}`,
      contentHash: computeContentHash(`${params.name}:${params.description}:${params.price}`),
    },
    createdAt: now,
    updatedAt: now,
  };
  listings.set(listing.id, listing);
  return listing;
}

export function getListing(id: string): MarketplaceListing | null {
  return listings.get(id) || null;
}

export function updateListing(
  id: string,
  updates: Partial<
    Pick<MarketplaceListing, "name" | "description" | "price" | "status" | "version">
  >,
): MarketplaceListing | null {
  const listing = listings.get(id);
  if (!listing) return null;
  Object.assign(listing, updates, { updatedAt: new Date().toISOString() });
  return listing;
}

export function recordUsage(id: string, executionRevenue: number): MarketplaceListing | null {
  const listing = listings.get(id);
  if (!listing) return null;
  listing.usageCount += 1;
  listing.revenue += executionRevenue;
  listing.updatedAt = new Date().toISOString();
  return listing;
}

export function searchListings(params: {
  tenantId?: string;
  assetType?: AssetType;
  status?: ListingStatus;
  minPrice?: number;
  maxPrice?: number;
  query?: string;
}): MarketplaceListing[] {
  const results: MarketplaceListing[] = [];
  for (const listing of listings.values()) {
    if (params.tenantId && listing.tenantId !== params.tenantId) continue;
    if (params.assetType && listing.assetType !== params.assetType) continue;
    if (params.status && listing.status !== params.status) continue;
    if (params.minPrice !== undefined && listing.price < params.minPrice) continue;
    if (params.maxPrice !== undefined && listing.price > params.maxPrice) continue;
    if (params.query) {
      const q = params.query.toLowerCase();
      if (!listing.name.toLowerCase().includes(q) && !listing.description.toLowerCase().includes(q))
        continue;
    }
    results.push(listing);
  }
  return results.sort((a, b) => b.usageCount - a.usageCount);
}

export function getListingsByCreator(creatorId: string, tenantId?: string): MarketplaceListing[] {
  return Array.from(listings.values()).filter(
    (l) => l.creatorId === creatorId && (!tenantId || l.tenantId === tenantId),
  );
}
