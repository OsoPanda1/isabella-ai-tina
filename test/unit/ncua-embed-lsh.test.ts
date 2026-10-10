import { describe, expect, it } from "vitest";

import {
  embed,
  embedBytes,
  cosine,
  simHash,
  hammingDistance,
  compressToLatent,
} from "@/lib/ncua/embed";
import { SimHashLshIndex } from "@/lib/ncua/lsh";
import { measureOnCorpus } from "@/lib/ncua/metrics";

describe("ncua:embeddings continuos", () => {
  it("produce vectores densos deterministas de dimensión fija", () => {
    const a = embed("paste minero", { dim: 192 });
    const b = embed("paste minero", { dim: 192 });
    expect(a).toEqual(b);
    expect(a.length).toBe(192);
  });

  it("codifica distinto byte stream en vectores distintos (sin vocabulario/OOV)", () => {
    const paste = embed("mineria de plata", { dim: 192 });
    const turismo = embed("turismo y patrimonio", { dim: 192 });
    expect(cosine(paste, turismo)).toBeLessThan(
      cosine(paste, embed("mineria de plata", { dim: 192 })),
    );
  });

  it("normaliza a norma unitaria", () => {
    const vector = embed("acueducto de padre tembleque", { dim: 192 });
    let norm = 0;
    for (let index = 0; index < vector.length; index += 1) norm += vector[index] * vector[index];
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it("simhash: cercanos en el espacio duro tienen distancia Hamming baja", () => {
    const base = embed("Real del Monte es un pueblo minero", { dim: 192 });
    const near = embed("Real del Monte es un pueblo minero de Hidalgo", {
      dim: 192,
    });
    const far = embed("receta de tamales oaxaqueños", { dim: 192 });
    const nearDistance = hammingDistance(simHash(base), simHash(near));
    const farDistance = hammingDistance(simHash(base), simHash(far));
    expect(nearDistance).toBeLessThanOrEqual(farDistance);
    expect(nearDistance).toBeLessThan(6);
  });

  it("comprime bytes a latente por chunks", () => {
    const latent = compressToLatent("compresión continua sin tokens para auditoría", {
      chunkSize: 8,
    });
    expect(latent.numChunks).toBeGreaterThan(0);
    expect(latent.latentDim).toBe(192);
    expect(latent.bytesPerChunk).toBeGreaterThan(0);
  });
});

describe("ncua:LSH (memoria aproximada sub-lineal)", () => {
  const corpus = [
    { id: "a", text: "Real del Monte es un pueblo minero en Hidalgo" },
    { id: "b", text: "el paste fue traído por los mineros córnico-alemanes" },
    { id: "c", text: "la plata de ley 925 se trabaja en platerías de Pachuca" },
    { id: "d", text: "receta tradicional del paste de papa con picadillo" },
  ];

  it("recupera vecinos por similitud de bytes", () => {
    const index = new SimHashLshIndex({ dim: 192 });
    for (const doc of corpus) index.add(doc, doc.text);
    const hits = index.search("¿dónde se trabaja la plata?", { topK: 2 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBeDefined();
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("marca coincidencias exactas de bytes", () => {
    const index = new SimHashLshIndex({ dim: 192 });
    for (const doc of corpus) index.add(doc, doc.text);
    const hits = index.search(corpus[0]!.text, { topK: 1 });
    expect(hits[0]?.exact).toBe(true);
    expect(hits[0]?.id).toBe("a");
  });

  it("mide métricas honestas sobre el corpus", () => {
    const metrics = measureOnCorpus(corpus, { chunkSize: 32 });
    expect(metrics.corpusSize).toBe(4);
    expect(metrics.samples).toBe(4);
    expect(metrics.meanFidelity).toBeGreaterThan(0);
    expect(metrics.bitsPerByte).toBeGreaterThan(0);
    expect(metrics.throughputBytesPerSecond).toBeGreaterThan(0);
  });
});
