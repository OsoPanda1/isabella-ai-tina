/**
 * NCUA — clasificador de intención por centroides continuos.
 * Aprendizaje incremental (online): cada ejemplo mueve el centroide.
 * Abstiene (devuelve "desconocido") cuando el margen o la confianza son
 * insuficientes, en línea con la doctrina "incertidumbre estructurada".
 */

import { embed } from "./embed";

export interface IntentSeed {
  intent: string;
  examples: string[];
}

export interface IntentScore {
  intent: string;
  score: number;
}

export interface IntentPrediction {
  intent: string;
  confidence: number;
  margin: number;
  scores: IntentScore[];
}

export interface IntentClassifierOptions {
  dim?: number;
  minConfidence?: number;
  minMargin?: number;
}

export class NativeIntentClassifier {
  private readonly centroids = new Map<string, Float64Array>();
  private readonly counts = new Map<string, number>();
  private readonly options: Required<IntentClassifierOptions>;

  constructor(options: IntentClassifierOptions = {}) {
    this.options = {
      dim: options.dim ?? 192,
      minConfidence: options.minConfidence ?? 0.18,
      minMargin: options.minMargin ?? 0.04,
    };
  }

  get size(): number {
    return this.centroids.size;
  }

  train(intent: string, examples: string[]): void {
    const denominator = examples.length + (this.counts.get(intent) ?? 0);
    const previous = this.centroids.get(intent);
    const accumulator = previous ?? new Float64Array(this.options.dim);
    for (const example of examples) {
      const vector = embed(example, { dim: this.options.dim });
      for (let index = 0; index < accumulator.length; index += 1) {
        accumulator[index] += (vector[index] as number) / denominator;
      }
    }
    this.centroids.set(intent, accumulator);
    this.counts.set(intent, (this.counts.get(intent) ?? 0) + examples.length);
  }

  scores(text: string): IntentScore[] {
    const textVector = embed(text, { dim: this.options.dim });
    const scores: IntentScore[] = [];
    for (const [intent, centroid] of this.centroids.entries()) {
      scores.push({ intent, score: cosineOf(textVector, centroid) });
    }
    scores.sort((a, b) => b.score - a.score);
    return scores;
  }

  predict(text: string): IntentPrediction {
    const scores = this.scores(text);
    if (scores.length === 0) {
      return { intent: "desconocido", confidence: 0, margin: 0, scores: [] };
    }
    const first = scores[0];
    if (!first) {
      return { intent: "desconocido", confidence: 0, margin: 0, scores };
    }
    const second = scores[1];
    const margin = second ? first.score - second.score : first.score;
    if (first.score < this.options.minConfidence || margin < this.options.minMargin) {
      return { intent: "desconocido", confidence: first.score, margin, scores };
    }
    return { intent: first.intent, confidence: first.score, margin, scores };
  }
}

function cosineOf(a: Float64Array, b: Float64Array): number {
  const denominator = magnitude(a) * magnitude(b);
  if (denominator === 0) return 0;
  let dot = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    dot += (a[index] as number) * (b[index] as number);
  }
  return dot / denominator;
}

function magnitude(vector: Float64Array): number {
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] as number;
    sum += value * value;
  }
  return Math.sqrt(sum);
}

export function seedRdmIntents(options: IntentClassifierOptions = {}): NativeIntentClassifier {
  const classifier = new NativeIntentClassifier(options);
  const seeds: IntentSeed[] = [
    {
      intent: "mineria",
      examples: [
        "historia de la mineria en Real del Monte",
        "minas de plata de Pachuca",
        "extraccion de mineral en el distrito minero",
        "pedro romero de terreros conde de regla",
      ],
    },
    {
      intent: "paste",
      examples: [
        "que es el paste",
        "receta tradicional del paste",
        "donde comer paste en Real del Monte",
        "origen del paste minero",
      ],
    },
    {
      intent: "plateria",
      examples: [
        "plateria de plata 925",
        "artesania en plata de Hidalgo",
        "joyeria de plata pura",
        "taller de plateria",
      ],
    },
    {
      intent: "patrimonio",
      examples: [
        "patrimonio cultural de Real del Monte",
        "sitios historicos de Hidalgo",
        "museo de sitio mina de acosta",
        "iglesias y arquitectura del pueblo magico",
      ],
    },
    {
      intent: "gobernanza",
      examples: [
        "politicas de privacidad de Isabella",
        "como se decide una autorizacion",
        "quien aprueba las acciones del sistema",
        "principios de soberania humana",
      ],
    },
  ];
  for (const seed of seeds) {
    classifier.train(seed.intent, seed.examples);
  }
  return classifier;
}
