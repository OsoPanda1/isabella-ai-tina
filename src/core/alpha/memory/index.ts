/**
 * Alpha — Memory
 *
 * Recupera únicamente memorias autorizadas y vigentes.
 */

export type MemoryScope = "session" | "user" | "tenant" | "public";
export type SensitivityLevel = "public" | "internal" | "confidential" | "secret";

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
    // Placeholder for actual memory retrieval
    // In production, this would query MEMORIA + historical memory
    const results: MemoryResult[] = [];

    for (const scope of query.scopes) {
      results.push({
        id: crypto.randomUUID(),
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
