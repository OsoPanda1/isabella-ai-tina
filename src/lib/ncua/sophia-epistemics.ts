/**
 * NCUA v2.0 — SOPHIA Epistemics (niveles E0–E4).
 *
 * Clasifica el texto por nivel epistemológico: E0 juicio personal, E1
 * correlación, E2 evidencia secundaria, E3 experimento reproducible y E4
 * prueba axiomática. Los niveles alimentan la bonificación de evidencia del
 * Índice de Robustez Epistémica (ERI).
 */

import { EVIDENCE_BONUS_PER_LEVEL } from "./eri";

export type SophiaTier = 0 | 1 | 2 | 3 | 4;

export interface SophiaLevelDefinition {
  tier: SophiaTier;
  labelEs: string;
  labelEn: string;
  keywords: readonly string[];
}

export const SOPHIA_LEVELS: readonly SophiaLevelDefinition[] = [
  {
    tier: 0,
    labelEs: "E0 — Juicio personal",
    labelEn: "E0 — Personal opinion",
    keywords: [
      "opino",
      "creo que",
      "me parece",
      "a mi parecer",
      "en mi opinión",
      "siento que",
      "prefiero",
      "i think",
      "in my opinion",
      "i believe",
    ],
  },
  {
    tier: 1,
    labelEs: "E1 — Correlación",
    labelEn: "E1 — Correlation",
    keywords: [
      "correlación",
      "correlaciona",
      "asociación",
      "tendencia",
      "sugiere",
      "indicaría",
      "podría indicar",
      "mayoría",
      "suele",
      "patrón",
      "correlation",
      "trend",
      "suggests",
      "usually",
    ],
  },
  {
    tier: 2,
    labelEs: "E2 — Evidencia secundaria",
    labelEn: "E2 — Secondary evidence",
    keywords: [
      "estudio",
      "evidencia",
      "datos estructurados",
      "encuesta",
      "muestra",
      "medición",
      "reporte",
      "fuente",
      "cita",
      "bibliografía",
      "investigación",
      "study",
      "survey",
      "sample",
      "source",
      "findings",
      "report",
    ],
  },
  {
    tier: 3,
    labelEs: "E3 — Experimento reproducible",
    labelEn: "E3 — Reproducible experiment",
    keywords: [
      "experimento",
      "reproducible",
      "algoritmo",
      "método",
      "métricas",
      "benchmark",
      "medible",
      "protocolo",
      "replicable",
      "resultados publicados",
      "experiment",
      "reproducible",
      "method",
      "metrics",
      "benchmark",
      "protocol",
    ],
  },
  {
    tier: 4,
    labelEs: "E4 — Prueba axiomática",
    labelEn: "E4 — Axiomatic proof",
    keywords: [
      "teorema",
      "axioma",
      "ley física",
      "demostración",
      "ecuación",
      "prueba matemática",
      "invariante",
      "theorem",
      "axiom",
      "proof",
      "physical law",
      "equation",
    ],
  },
];

export interface SophiaObservation {
  tier: SophiaTier;
  label: string;
  matches: string[];
}

export interface SophiaClassification {
  level: SophiaTier;
  label: string;
  score: number;
  observances: SophiaObservation[];
}

export function classifySophiaLevel(text: string): SophiaClassification {
  const normalized = text.toLowerCase();
  const observances: SophiaObservation[] = [];
  let maxTier: SophiaTier = 0;
  for (const definition of SOPHIA_LEVELS) {
    const matches = definition.keywords.filter((keyword) => normalized.includes(keyword));
    if (matches.length === 0) continue;
    observances.push({ tier: definition.tier, label: definition.labelEs, matches });
    if (definition.tier > maxTier) maxTier = definition.tier;
  }
  const top = SOPHIA_LEVELS[maxTier] ?? SOPHIA_LEVELS[0];
  return {
    level: maxTier,
    label: top.labelEs,
    score: maxTier * EVIDENCE_BONUS_PER_LEVEL,
    observances,
  };
}
