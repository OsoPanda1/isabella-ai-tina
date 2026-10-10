/**
 * NCUA — índice LSH de SimHash sobre representaciones de bytes.
 * Búsqueda aproximada de vecinos en dos etapas: bucket grueso de 16 bits
 * + reranking por distancia de Hamming y coseno dentro del pool. Escala
 * sub-lineal en el tamaño del corpus, determinista, sin dependencias.
 */

import { embedBytes, simHash, hammingDistance, cosine, SimHashSignature } from "./embed";
import { encodeUtf8 } from "./bytes";

export interface LshDocument {
  id: string;
  text?: string;
}

const COARSE_BITS = 16;
const MAX_INDEXED_CHARS = 100_000;

/**
 * Higiene de corpus al ingerir (ISA-083 / ISA-179): el texto de un índice de
 * recuperación es dato no confiable. Se eliminan caracteres de control y
 * separadores de ancho cero, y se limita el tamaño para que una pieza
 * envenenada no ocupe el índice ni sobreviva byte a byte hasta la respuesta.
 */
function sanitizeCorpusText(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    const isControl =
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f;
    const isZeroWidth = code === 0x200b || code === 0x200d || code === 0xfeff;
    if (!isControl && !isZeroWidth) out += raw[i];
  }
  return out.trim().slice(0, MAX_INDEXED_CHARS);
}

export interface LshSearchHit {
  id: string;
  score: number;
  hammingDistance: number;
  exact?: boolean;
}

export class SimHashLshIndex {
  private readonly dim: number;
  private readonly coarseBits: number;
  private readonly buckets = new Map<number, string[]>();
  private readonly signatures = new Map<string, SimHashSignature>();
  private readonly vectors = new Map<string, Float64Array>();
  private readonly texts = new Map<string, string>();
  private readonly byteHashes = new Map<string, number>();
  private documentCount = 0;

  constructor(options: { dim?: number; coarseBits?: number } = {}) {
    this.dim = options.dim ?? 192;
    this.coarseBits = options.coarseBits ?? COARSE_BITS;
  }

  get size(): number {
    return this.documentCount;
  }

  get bucketCount(): number {
    return this.buckets.size;
  }

  add(doc: LshDocument, text: string): void {
    const cleanText = sanitizeCorpusText(text);
    if (!doc.id || cleanText.length === 0) return;
    const bytes = encodeUtf8(cleanText);
    const vector = embedBytes(bytes, { dim: this.dim });
    const signature = simHash(vector, 64);
    const coarseKey = (signature.words[0] as number) & ((1 << this.coarseBits) - 1);
    const bucket = this.buckets.get(coarseKey) ?? [];
    bucket.push(doc.id);
    this.buckets.set(coarseKey, bucket);
    this.signatures.set(doc.id, signature);
    this.vectors.set(doc.id, vector);
    this.texts.set(doc.id, cleanText);
    let hash = 2166136261 >>> 0;
    for (let index = 0; index < bytes.length; index += 1) {
      hash ^= bytes[index] as number;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    this.byteHashes.set(doc.id, hash >>> 0);
    this.documentCount += 1;
  }

  remove(id: string): void {
    const signature = this.signatures.get(id);
    if (!signature) return;
    const coarseKey = (signature.words[0] as number) & ((1 << this.coarseBits) - 1);
    const bucket = this.buckets.get(coarseKey);
    if (bucket) {
      const filtered = bucket.filter((candidate) => candidate !== id);
      if (filtered.length === 0) {
        this.buckets.delete(coarseKey);
      } else {
        this.buckets.set(coarseKey, filtered);
      }
    }
    this.signatures.delete(id);
    this.vectors.delete(id);
    this.texts.delete(id);
    this.byteHashes.delete(id);
    this.documentCount = Math.max(0, this.documentCount - 1);
  }

  search(
    text: string,
    options: { topK?: number; maxHamming?: number; minScore?: number } = {},
  ): LshSearchHit[] {
    const topK = options.topK ?? 4;
    const maxHamming = options.maxHamming ?? 3;
    const minScore = options.minScore ?? 0.2;
    const bytes = encodeUtf8(text);
    const vector = embedBytes(bytes, { dim: this.dim });
    const signature = simHash(vector, 64);
    const coarseKey = (signature.words[0] as number) & ((1 << this.coarseBits) - 1);
    const pool = this.buckets.get(coarseKey) ?? [];

    let hash = 2166136261 >>> 0;
    for (let index = 0; index < bytes.length; index += 1) {
      hash ^= bytes[index] as number;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    const queryHash = hash >>> 0;

    const hits: LshSearchHit[] = [];
    for (const id of pool) {
      const candidateSignature = this.signatures.get(id);
      if (!candidateSignature) continue;
      const distance = hammingDistance(signature, candidateSignature);
      if (distance > maxHamming) continue;
      const candidateVector = this.vectors.get(id);
      if (!candidateVector) continue;
      const score = cosine(vector, candidateVector);
      if (score < minScore) continue;
      const exact = (this.byteHashes.get(id) ?? 0) === queryHash;
      hits.push({ id, score, hammingDistance: distance, exact });
    }

    hits.sort((a, b) => b.score - a.score || a.hammingDistance - b.hammingDistance);
    return hits.slice(0, topK);
  }

  retrieve(id: string): LshDocument | undefined {
    if (!this.texts.has(id)) return undefined;
    return { id, text: this.texts.get(id) };
  }

  stats(): { documents: number; buckets: number; vectorsPerBucket: number } {
    const total = Array.from(this.buckets.values()).reduce((sum, bucket) => sum + bucket.length, 0);
    return {
      documents: this.documentCount,
      buckets: this.buckets.size,
      vectorsPerBucket: this.buckets.size === 0 ? 0 : total / this.buckets.size,
    };
  }
}

export function buildIndex(
  documents: { id: string; text?: string }[],
  options: { dim?: number } = {},
): SimHashLshIndex {
  const index = new SimHashLshIndex(options);
  for (const doc of documents) {
    if (doc.text) index.add(doc, doc.text);
  }
  return index;
}
