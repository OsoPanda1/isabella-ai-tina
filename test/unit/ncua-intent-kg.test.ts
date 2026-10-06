import { describe, expect, it } from "vitest";

import { NativeIntentClassifier, seedRdmIntents } from "@/lib/ncua/intent";
import { SovereignKnowledgeGraph, seedRdmKnowledgeGraph } from "@/lib/ncua/kg";

describe("ncua:intención (centroides online)", () => {
  it("clasifica intenciones sembradas del dominio RDM", () => {
    const classifier = seedRdmIntents();
    const mineria = classifier.predict("¿cómo se inició la minería en Real del Monte?");
    expect(mineria.intent).toBe("mineria");
    const paste = classifier.predict("¿cuál es la receta tradicional del paste?");
    expect(paste.intent).toBe("paste");
  });

  it("abstiene ante intenciones ambiguas (incertidumbre estructurada)", () => {
    const classifier = new NativeIntentClassifier({
      minConfidence: 0.9,
      minMargin: 0.5,
    });
    const prediction = classifier.predict("zzz qqq www vvv bbb nnn");
    expect(prediction.intent).toBe("desconocido");
  });
});

describe("ncua:grafo de conocimiento soberano", () => {
  it("fundamenta narrativa con procedencia y confianza", () => {
    const graph = seedRdmKnowledgeGraph();
    const result = graph.createNarrative("historia del paste minero", {
      topK: 3,
    });
    expect(result.groundedFacts).toBeGreaterThan(0);
    expect(result.text).toContain("paste");
    expect(result.text).toContain("confianza");
  });

  it("rechaza ser promovido a hecho sin procedencia", () => {
    const graph = seedRdmKnowledgeGraph();
    graph.addFact("la alcaldía", "es", "presidencia municipal de Pachuca");
    const fact = graph.factsByPredicate("es")[0];
    expect(fact).toBeDefined();
    expect(fact?.source).toBeDefined();
  });

  it("recupera por embeddings de consulta", () => {
    const graph = seedRdmKnowledgeGraph();
    const hits = graph.retrieve("minas de plata", { topK: 2 });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.score).toBeGreaterThan(0);
    }
  });
});
