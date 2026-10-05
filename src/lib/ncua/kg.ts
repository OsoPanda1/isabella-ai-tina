/**
 * NCUA — grafo de conocimiento soberano.
 * Hechos tipados con peso, procedencia y una recuperación por embeddings
 * continuos (consulta → emparejamiento por similitud → selección de
 * subgrafo a cierta profundidad). Los hechos se etiquetan por fuente para
 * distinguir patrimonio documentado de tradición oral.
 */

import { embed, cosine } from "./embed";

export type KGFactSource =
  "patrimonio-documentado" | "tradicion-oral" | "sistema" | "contemporaneo";

export interface KGFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  weight: number;
  source: KGFactSource;
  confidence: number;
}

export interface KGRetrieval {
  fact: KGFact;
  score: number;
}

export interface KGNarrative {
  text: string;
  groundedFacts: number;
}

export class SovereignKnowledgeGraph {
  private readonly facts: KGFact[] = [];
  private readonly subjectEmbeddings = new Map<string, Float64Array>();
  private readonly adjacency = new Map<string, string[]>();
  private readonly dim: number;

  constructor(options: { dim?: number } = {}) {
    this.dim = options.dim ?? 192;
  }

  get size(): number {
    return this.facts.length;
  }

  addFact(
    subject: string,
    predicate: string,
    object: string,
    options: {
      weight?: number;
      source?: KGFactSource;
      confidence?: number;
    } = {},
  ): KGFact {
    const fact: KGFact = {
      id: `kg:${this.facts.length}:${hashOf(subject + predicate + object)}`,
      subject,
      predicate,
      object,
      weight: options.weight ?? 1,
      source: options.source ?? "sistema",
      confidence: options.confidence ?? 0.5,
    };
    this.facts.push(fact);
    if (!this.subjectEmbeddings.has(subject)) {
      this.subjectEmbeddings.set(subject, embed(subject, { dim: this.dim }));
    }
    const neighbors = this.adjacency.get(subject) ?? [];
    neighbors.push(fact.id);
    this.adjacency.set(subject, neighbors);
    return fact;
  }

  retrieve(
    query: string,
    options: { topK?: number; minScore?: number; hops?: number } = {},
  ): KGRetrieval[] {
    const topK = options.topK ?? 4;
    const minScore = options.minScore ?? 0.3;
    const queryVector = embed(query, { dim: this.dim });
    const scored: Array<{ fact: KGFact; score: number }> = [];
    for (const fact of this.facts) {
      const subjectVector = this.subjectEmbeddings.get(fact.subject);
      if (!subjectVector) continue;
      const score = cosine(queryVector, subjectVector) * fact.weight;
      if (score < minScore) continue;
      scored.push({ fact, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const selected = new Map<string, KGFact>();
    for (const item of scored) {
      selected.set(item.fact.id, item.fact);
      if (selected.size >= topK) break;
    }
    const hops = (options.hops ?? 1) - 1;
    let frontier = Array.from(selected.keys());
    for (let hop = 0; hop < hops; hop += 1) {
      const next: string[] = [];
      for (const factId of frontier) {
        const fact = this.facts.find((candidate) => candidate.id === factId);
        if (!fact) continue;
        const neighbors = this.adjacency.get(fact.object) ?? [];
        for (const neighborId of neighbors) {
          const neighbor = this.facts.find((candidate) => candidate.id === neighborId);
          if (neighbor && !selected.has(neighbor.id)) {
            selected.set(neighbor.id, neighbor);
            next.push(neighbor.id);
          }
        }
      }
      frontier = next;
    }
    const ordered = Array.from(scored).filter((item) => selected.has(item.fact.id));
    return ordered.slice(0, topK).sort((a, b) => b.score - a.score);
  }

  factsByPredicate(predicate: string): KGFact[] {
    return this.facts.filter((fact) => fact.predicate === predicate);
  }

  createNarrative(query: string, options: { topK?: number; minScore?: number } = {}): KGNarrative {
    const hits = this.retrieve(query, options);
    const sentences: string[] = [];
    for (const hit of hits) {
      const label = factSourceLabel(hit.fact.source);
      const confidence = Math.round(hit.fact.confidence * 100);
      sentences.push(
        `${hit.fact.subject} ${hit.fact.predicate} ${hit.fact.object} [${label}, confianza ${confidence}%].`,
      );
    }
    return {
      text: sentences.join(" "),
      groundedFacts: hits.length,
    };
  }
}

function factSourceLabel(source: KGFactSource): string {
  const labels: Record<KGFactSource, string> = {
    "patrimonio-documentado": "patrimonio documentado",
    "tradicion-oral": "tradición oral",
    sistema: "fuente de sistema",
    contemporaneo: "fuente contemporánea",
  };
  return labels[source];
}

function hashOf(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function seedRdmKnowledgeGraph(options: { dim?: number } = {}): SovereignKnowledgeGraph {
  const graph = new SovereignKnowledgeGraph(options);
  const seeded: Array<
    [string, string, string, { weight?: number; source?: KGFactSource; confidence?: number }]
  > = [
    [
      "Real del Monte",
      "es",
      "pueblo minero en el estado de Hidalgo, México",
      { weight: 1, source: "patrimonio-documentado", confidence: 0.92 },
    ],
    [
      "Real del Monte",
      "es",
      "parte del distrito minero de Pachuca-Real del Monte",
      { weight: 1, source: "patrimonio-documentado", confidence: 0.9 },
    ],
    [
      "el paste",
      "fue",
      "introducido por mineros córnico-alemanes en Real del Monte",
      { weight: 1, source: "tradicion-oral", confidence: 0.82 },
    ],
    [
      "el paste",
      "es",
      "patrimonio gastronómico del estado de Hidalgo",
      { weight: 1, source: "patrimonio-documentado", confidence: 0.88 },
    ],
    [
      "Pedro Romero de Terreros",
      "fue",
      "el Conde de Regla y desarrolló las minas del distrito",
      { weight: 1, source: "patrimonio-documentado", confidence: 0.9 },
    ],
    [
      "Mina de Acosta",
      "es",
      "un museo de sitio minero visitable en Pachuca",
      { weight: 1, source: "patrimonio-documentado", confidence: 0.91 },
    ],
    [
      "plata",
      "se",
      "extraía en el distrito minero de Pachuca-Real del Monte",
      { weight: 1, source: "patrimonio-documentado", confidence: 0.9 },
    ],
    [
      "platería",
      "trabaja",
      "plata de ley 925",
      { weight: 1, source: "contemporaneo", confidence: 0.85 },
    ],
    [
      "Nodo Cero",
      "es",
      "el centro del ecosistema TAMV en Real del Monte",
      { weight: 1, source: "sistema", confidence: 0.7 },
    ],
    [
      "Isabella",
      "opera",
      "bajo soberanía humana y gobernanza explícita",
      { weight: 1, source: "patrimonio-documentado", confidence: 0.95 },
    ],
  ];
  for (const [subject, predicate, object, options] of seeded) {
    graph.addFact(subject, predicate, object, options);
  }
  return graph;
}
