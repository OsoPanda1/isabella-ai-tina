/**
 * NCUA — métricas medidas honestamente en este repositorio.
 * Nada aquí es un reclamo de rendimiento de hardware A100 ni de fidelidad
 * de modelos entrenados: son valores reales obtenidos al ejecutar el motor
 * nativo sobre un corpus dado. La fidelidad medida es el coseno medio entre
 * el vector de una muestra y su recuperado más cercano cuando existe una
 * coincidencia exacta de bytes en el índice.
 */

import { SimHashLshIndex, buildIndex } from "./lsh";
import { compressToLatent } from "./embed";
import { encodeUtf8, decodeUtf8 } from "./bytes";

export interface MeasuredMetrics {
  corpusSize: number;
  samples: number;
  elapsedMs: number;
  bytesProcessed: number;
  chunksProcessed: number;
  latentDim: number;
  chunkSize: number;
  meanFidelity: number;
  exactRecall: number;
  utf8Validity: number;
  bitsPerByte: number;
  efficiencyK: number;
  throughputSamplesPerSecond: number;
  throughputBytesPerSecond: number;
}

export function measureOnCorpus(
  corpus: Array<{ id: string; text: string }>,
  options: { chunkSize?: number; dim?: number } = {},
): MeasuredMetrics {
  const chunkSize = options.chunkSize ?? 32;
  const dim = options.dim ?? 192;
  const startedAt = performance.now();
  const index = buildIndex(corpus, { dim });

  let samples = 0;
  let exactHits = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let chunksProcessed = 0;
  let bytesProcessed = 0;
  let validUtf8 = 0;

  for (const doc of corpus) {
    const encoded = encodeUtf8(doc.text);
    bytesProcessed += encoded.byteLength;
    if (decodeUtf8(encoded) === doc.text) validUtf8 += 1;
    const hits = index.search(doc.text, { topK: 1, maxHamming: 3 });
    if (hits.length > 0) {
      const hit = hits[0];
      if (hit) {
        scoreSum += hit.score;
        scoreCount += 1;
        if (hit.exact) exactHits += 1;
      }
    }
    const latent = compressToLatent(doc.text, { chunkSize, dim });
    chunksProcessed += latent.numChunks;
    samples += 1;
  }

  const elapsedMs = Math.max(performance.now() - startedAt, 0.001);
  const meanFidelity = scoreCount === 0 ? 0 : scoreSum / scoreCount;
  const bits = dim * chunksProcessed * 8;
  const bitsPerByte = bytesProcessed === 0 ? 0 : bits / bytesProcessed;
  const efficiencyK = chunksProcessed === 0 ? 0 : bytesProcessed / chunksProcessed;

  return {
    corpusSize: corpus.length,
    samples,
    elapsedMs,
    bytesProcessed,
    chunksProcessed,
    latentDim: dim,
    chunkSize,
    meanFidelity,
    exactRecall: samples === 0 ? 0 : exactHits / samples,
    utf8Validity: samples === 0 ? 0 : validUtf8 / samples,
    bitsPerByte,
    efficiencyK,
    throughputSamplesPerSecond: samples / (elapsedMs / 1000),
    throughputBytesPerSecond: bytesProcessed / (elapsedMs / 1000),
  };
}

export interface SearchGates {
  index: SimHashLshIndex;
}

export function createSearchGates(corpus: Array<{ id: string; text: string }>): SearchGates {
  return { index: buildIndex(corpus) };
}
