/**
 * NCUA — módulo de comprensión continua nativa.
 * Exporta el motor y sus piezas: bytes, embeddings continuos, LSH,
 * intención, grafo de conocimiento, privacidad, federaciones y pipeline.
 */

import { NativeIntentClassifier, seedRdmIntents } from "./intent";
import { SovereignKnowledgeGraph, seedRdmKnowledgeGraph } from "./kg";
import { SimHashLshIndex } from "./lsh";

export * from "./bytes";
export * from "./embed";
export * from "./lsh";
export * from "./intent";
export * from "./kg";
export * from "./privacy";
export * from "./federations";
export * from "./metrics";
export * from "./dataset-contract";
export * from "./audit-bundle";
export * from "./pipeline";
export * from "./entropy-patcher";
export * from "./eri";
export * from "./sophia-epistemics";
export * from "./concept-engine";
export * from "./quantum-align";
export * from "./bookpi-trajectory";
export * from "./academic-pipeline";
export * from "./benchmark";

export interface NativeEngine {
  intent: NativeIntentClassifier;
  knowledgeGraph: SovereignKnowledgeGraph;
  lsh: SimHashLshIndex;
}

export function createNativeEngine(
  memoryCorpus: Array<{ id: string; text: string }> = [],
): NativeEngine {
  const intent = seedRdmIntents();
  const knowledgeGraph = seedRdmKnowledgeGraph();
  const lsh = new SimHashLshIndex({ dim: 192 });
  for (const doc of memoryCorpus) {
    if (doc.text) lsh.add(doc, doc.text);
  }
  return { intent, knowledgeGraph, lsh };
}
