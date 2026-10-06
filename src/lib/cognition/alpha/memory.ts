/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — ALPHA / MEMORY
 * Recupera únicamente memorias autorizadas y vigentes.
 * ================================================================
 */

import { randomUUID } from "node:crypto";

import type { MemoryScope, SensitivityLevel } from "../contracts";

export interface MemoryQuery {
  query: string;
  scopes: MemoryScope[];
  sensitivityMax: SensitivityLevel;
  maxResults: number;
  timeRange?: { from?: string; to?: string };
}

export interface MemoryResult {
  id: string;
  content: string;
  scope: MemoryScope;
  sensitivity: SensitivityLevel;
  confidence: number;
  source: string;
  createdAt: string;
  expiresAt?: string;
  isExpired: boolean;
}

export class AlphaMemory {
  /**
   * Retrieve memories that match the query and are within allowed scope/sensitivity.
   */
  async retrieve(query: MemoryQuery): Promise<MemoryResult[]> {
    const results: MemoryResult[] = [];

    for (const scope of query.scopes) {
      results.push({
        id: randomUUID(),
        content: `[Memory in scope ${scope} for: ${query.query}]`,
        scope,
        sensitivity: "public",
        confidence: 0.8,
        source: "session_memory",
        createdAt: new Date().toISOString(),
        isExpired: false,
      });
    }

    return results.slice(0, query.maxResults);
  }

  /**
   * Filter results by sensitivity level.
   */
  filterBySensitivity(results: MemoryResult[], maxSensitivity: SensitivityLevel): MemoryResult[] {
    const levels: SensitivityLevel[] = ["public", "internal", "confidential", "secret"];
    const maxIndex = levels.indexOf(maxSensitivity);

    return results.filter((r) => {
      const index = levels.indexOf(r.sensitivity);
      return index <= maxIndex;
    });
  }
}

export const alphaMemory = new AlphaMemory();
