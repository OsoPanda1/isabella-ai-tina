/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — ALPHA / RESEARCH
 * Combina: lexical retrieval, vector retrieval, graph traversal,
 * source ranking, claim extraction, contradiction search.
 * ================================================================
 */

import { randomUUID } from "node:crypto";

export type RetrievalMethod = "lexical" | "vector" | "graph" | "hybrid";

export interface ResearchQuery {
  query: string;
  methods: RetrievalMethod[];
  maxResults: number;
  minRelevance: number;
  scopeFilters?: string[];
  timeRange?: { from?: string; to?: string };
}

export interface ResearchResult {
  id: string;
  content: string;
  source: string;
  method: RetrievalMethod;
  relevance: number;
  confidence: number;
  retrievedAt: string;
  metadata: Record<string, unknown>;
}

export interface Claim {
  id: string;
  text: string;
  confidence: number;
  source: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  isSupported: boolean;
}

export interface ResearchSynthesis {
  query: string;
  results: ResearchResult[];
  claims: Claim[];
  contradictions: Contradiction[];
  sourceRanking: SourceRanking[];
  overallConfidence: number;
  retrievalMs: number;
}

export interface Contradiction {
  claimA: Claim;
  claimB: Claim;
  severity: "low" | "medium" | "high";
  description: string;
}

export interface SourceRanking {
  source: string;
  totalResults: number;
  avgRelevance: number;
  avgConfidence: number;
  reliabilityScore: number;
}

interface SourceMetrics {
  successes: number;
  failures: number;
  avgLatency: number;
}

/* =========================================================================
   RESEARCH ENGINE
   ========================================================================= */

export class ResearchEngine {
  private sources: Map<string, SourceMetrics> = new Map();

  /**
   * Execute a multi-method research query.
   */
  async research(query: ResearchQuery): Promise<ResearchSynthesis> {
    const startTime = Date.now();
    const allResults: ResearchResult[] = [];

    for (const method of query.methods) {
      const results = await this.retrieve(query, method);
      allResults.push(...results);
    }

    const deduplicated = this.deduplicate(allResults);
    const ranked = this.rank(deduplicated, query.minRelevance);
    const limited = ranked.slice(0, query.maxResults);

    const claims = this.extractClaims(limited);

    const contradictions = this.findContradictions(claims);

    const sourceRanking = this.rankSources(limited);

    const overallConfidence = this.calculateOverallConfidence(limited, claims);

    return {
      query: query.query,
      results: limited,
      claims,
      contradictions,
      sourceRanking,
      overallConfidence,
      retrievalMs: Date.now() - startTime,
    };
  }

  /* --- Retrieval Methods --- */

  private async retrieve(query: ResearchQuery, method: RetrievalMethod): Promise<ResearchResult[]> {
    const results: ResearchResult[] = [];

    switch (method) {
      case "lexical":
        results.push(...this.lexicalRetrieve(query.query));
        break;
      case "vector":
        results.push(...this.vectorRetrieve(query.query));
        break;
      case "graph":
        results.push(...this.graphRetrieve(query.query));
        break;
      case "hybrid":
        results.push(...this.lexicalRetrieve(query.query));
        results.push(...this.vectorRetrieve(query.query));
        results.push(...this.graphRetrieve(query.query));
        break;
    }

    return results;
  }

  private lexicalRetrieve(query: string): ResearchResult[] {
    return [
      {
        id: randomUUID(),
        content: `[Lexical match for: ${query}]`,
        source: "lexical_index",
        method: "lexical",
        relevance: 0.7,
        confidence: 0.8,
        retrievedAt: new Date().toISOString(),
        metadata: {},
      },
    ];
  }

  private vectorRetrieve(query: string): ResearchResult[] {
    return [
      {
        id: randomUUID(),
        content: `[Semantic match for: ${query}]`,
        source: "vector_store",
        method: "vector",
        relevance: 0.85,
        confidence: 0.75,
        retrievedAt: new Date().toISOString(),
        metadata: {},
      },
    ];
  }

  private graphRetrieve(query: string): ResearchResult[] {
    return [
      {
        id: randomUUID(),
        content: `[Graph traversal for: ${query}]`,
        source: "knowledge_graph",
        method: "graph",
        relevance: 0.65,
        confidence: 0.7,
        retrievedAt: new Date().toISOString(),
        metadata: {},
      },
    ];
  }

  /* --- Processing --- */

  private deduplicate(results: ResearchResult[]): ResearchResult[] {
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = `${r.source}:${r.content.slice(0, 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private rank(results: ResearchResult[], minRelevance: number): ResearchResult[] {
    return results
      .filter((r) => r.relevance >= minRelevance)
      .sort((a, b) => b.relevance - a.relevance);
  }

  private extractClaims(results: ResearchResult[]): Claim[] {
    return results.map((r) => ({
      id: randomUUID(),
      text: r.content,
      confidence: r.confidence,
      source: r.source,
      supportingEvidence: [r.content],
      contradictingEvidence: [],
      isSupported: r.confidence > 0.5,
    }));
  }

  private findContradictions(claims: Claim[]): Contradiction[] {
    const contradictions: Contradiction[] = [];

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        if (claims[i].source !== claims[j].source) {
          const similarity = this.textSimilarity(claims[i].text, claims[j].text);
          if (similarity > 0.7 && Math.abs(claims[i].confidence - claims[j].confidence) > 0.3) {
            contradictions.push({
              claimA: claims[i],
              claimB: claims[j],
              severity: similarity > 0.9 ? "high" : "medium",
              description: `Conflicting claims from ${claims[i].source} and ${claims[j].source}`,
            });
          }
        }
      }
    }

    return contradictions;
  }

  private rankSources(results: ResearchResult[]): SourceRanking[] {
    const sourceMap = new Map<string, { results: ResearchResult[] }>();

    for (const result of results) {
      const existing = sourceMap.get(result.source) ?? { results: [] };
      existing.results.push(result);
      sourceMap.set(result.source, existing);
    }

    return Array.from(sourceMap.entries())
      .map(([source, data]) => ({
        source,
        totalResults: data.results.length,
        avgRelevance: data.results.reduce((sum, r) => sum + r.relevance, 0) / data.results.length,
        avgConfidence: data.results.reduce((sum, r) => sum + r.confidence, 0) / data.results.length,
        reliabilityScore: this.calculateReliability(source),
      }))
      .sort((a, b) => b.reliabilityScore - a.reliabilityScore);
  }

  private calculateOverallConfidence(results: ResearchResult[], claims: Claim[]): number {
    if (results.length === 0) return 0;

    const avgRelevance = results.reduce((sum, r) => sum + r.relevance, 0) / results.length;
    const supportedClaims = claims.filter((c) => c.isSupported).length;
    const claimSupport = claims.length > 0 ? supportedClaims / claims.length : 0.5;

    return avgRelevance * 0.6 + claimSupport * 0.4;
  }

  private calculateReliability(source: string): number {
    const metrics = this.sources.get(source);
    if (!metrics) return 0.5;

    const successRate = metrics.successes / (metrics.successes + metrics.failures);
    return successRate;
  }

  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return intersection.size / union.size;
  }
}

export const researchEngine = new ResearchEngine();
