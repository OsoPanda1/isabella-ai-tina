/**
 * Isabella MCP Adapter — LITLE Local Vector Index V2
 * Corregido per auditoría Part III-V:
 * - Valida dimensión del índice contra embedding del query
 * - Valida modelDigest (rechaza si no coincide)
 * - Valida que vectors estén normalizados (cosine = dot product only when normalized)
 * - Valida números finitos en vectores
 * - Incluye provenance completa por nodo
 * - Rechaza incompatibilidad entre modelo e índice
 *
 * Estado: diseño integrado y preparado para validación.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { MCPAdapterV2, MCPQueryContext, MCPQueryResultV2 } from "../claim-radar/contracts";

// ============================================================================
// INDEX SCHEMA VALIDATION
// ============================================================================

const LitleNodeSchema = z.object({
  nodeId: z.string(),
  doi: z.string().optional(),
  title: z.string(),
  embeddingVector: z.array(z.number().finite()).min(1),
  contentChunk: z.string(),
});

const LitleIndexSchema = z.object({
  schemaVersion: z.literal(1),
  embeddingModel: z.string(),
  modelDigest: z.string(),
  dimension: z.number().int().positive(),
  nodes: z.array(LitleNodeSchema),
});

type LitleIndex = z.infer<typeof LitleIndexSchema>;

// ============================================================================
// HELPERS
// ============================================================================

function sha3_256(value: string): string {
  return createHash("sha3-256").update(value).digest("hex");
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0 || !Number.isFinite(norm)) return v.map(() => 0);
  return v.map((x) => x / norm);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

// ============================================================================
// LITLE LOCAL MCP ADAPTER V2
// ============================================================================

export class LitleMCPAdapterV2 implements MCPAdapterV2 {
  readonly id = "litle-local";
  readonly version = "2.0.0";

  constructor(private readonly indexPath: string) {}

  async query(ctx: MCPQueryContext): Promise<ReadonlyArray<MCPQueryResultV2>> {
    // REQUIRE embedding for dense retrieval
    if (!ctx.embedding) {
      return [];
    }

    // Load and validate index
    let index: LitleIndex;
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw);
      const validated = LitleIndexSchema.safeParse(parsed);
      if (!validated.success) {
        return [];
      }
      index = validated.data;
    } catch {
      return [];
    }

    // Validate model/digest compatibility — reject if mismatched
    if (index.modelDigest !== ctx.embedding.modelDigest) {
      return [];
    }

    // Validate dimension match
    if (ctx.embedding.vector.length !== index.dimension) {
      return [];
    }

    // Validate embedding vector contains only finite numbers
    if (!ctx.embedding.vector.every((x) => Number.isFinite(x))) {
      return [];
    }

    // Validate normalized embeddings
    if (!ctx.embedding.normalized) {
      return [];
    }

    const queryVector = normalize(ctx.embedding.vector);
    const retrievedAt = new Date().toISOString();
    const queryDigest = sha3_256(ctx.assertion);

    // Score each node
    const scoredNodes = index.nodes
      .filter((node) => {
        // Validate each node's vector
        if (node.embeddingVector.length !== index.dimension) return false;
        if (!node.embeddingVector.every((x) => Number.isFinite(x))) return false;
        return true;
      })
      .map((node) => ({
        node,
        score: cosine(queryVector, normalize(node.embeddingVector)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(ctx.maxResults, 20));

    return scoredNodes.map(({ node, score }) => ({
      evidenceId: `litle:${node.nodeId}`,
      repository: "LITLE_LOCAL" as const,
      persistentId: node.doi ? { type: "doi" as const, value: node.doi } : undefined,
      title: node.title,
      excerpt: node.contentChunk.slice(0, 1000),
      retrievedAt,
      sourceUrl: node.doi ? `https://doi.org/${node.doi}` : `bookpi://${node.nodeId}`,
      relevance: {
        // Map cosine [-1,1] to [0,1] for relevance
        score: Math.max(0, Math.min(1, (score + 1) / 2)),
        method: "dense" as const,
        modelDigest: index.modelDigest,
      },
      // CRITICAL: retrieval is NEVER verification
      epistemic: {
        status: "insufficient" as const,
        reasonCode: "RETRIEVAL_IS_NOT_VERIFICATION",
        evaluatorVersion: "claim-radar-v2",
      },
      provenance: {
        responseDigest: sha3_256(JSON.stringify(node)),
        adapterVersion: this.version,
        queryDigest,
      },
    }));
  }

  async health(): Promise<{ ready: boolean; checkedAt: string }> {
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw);
      const validated = LitleIndexSchema.safeParse(parsed);
      return {
        ready: validated.success,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return { ready: false, checkedAt: new Date().toISOString() };
    }
  }
}
