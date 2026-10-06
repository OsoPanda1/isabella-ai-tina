/**
 * Alpha — Hypothesis
 *
 * Produce hipótesis, analogías, alternativas, riesgos y experimentos.
 */

export interface Hypothesis {
  id: string;
  statement: string;
  confidence: number;
  alternatives: string[];
  analogies: string[];
  risks: string[];
  experiments: string[];
  supportingEvidence: string[];
  contradictingEvidence: string[];
  category: "causal" | "predictive" | "exploratory" | "comparative";
  createdAt: string;
}

export class HypothesisEngine {
  /**
   * Generate hypotheses from research results and context.
   */
  generate(params: {
    query: string;
    researchConfidence: number;
    entities: Array<{ type: string; value: string }>;
    intentCategory: string;
  }): Hypothesis[] {
    const hypotheses: Hypothesis[] = [];

    // Generate primary hypothesis
    hypotheses.push({
      id: crypto.randomUUID(),
      statement: `Based on available evidence, the most likely interpretation is: ${params.query}`,
      confidence: params.researchConfidence * 0.9,
      alternatives: [
        "Alternative interpretation may exist with different context",
        "Additional information could change the assessment",
      ],
      analogies: this.findAnalogies(params.query, params.entities),
      risks: this.identifyRisks(params.query, params.intentCategory),
      experiments: this.suggestExperiments(params.query, params.intentCategory),
      supportingEvidence: [],
      contradictingEvidence: [],
      category: "predictive",
      createdAt: new Date().toISOString(),
    });

    // Generate exploratory hypothesis if confidence is low
    if (params.researchConfidence < 0.7) {
      hypotheses.push({
        id: crypto.randomUUID(),
        statement: "Low confidence suggests multiple valid interpretations may exist",
        confidence: 0.5,
        alternatives: [
          "Consider gathering more specific information",
          "The query may benefit from rephrasing",
          "Domain-specific expertise may be needed",
        ],
        analogies: [],
        risks: ["May lead to suboptimal decisions if based on incomplete information"],
        experiments: ["Request clarification from user", "Search for additional context"],
        supportingEvidence: [],
        contradictingEvidence: [],
        category: "exploratory",
        createdAt: new Date().toISOString(),
      });
    }

    return hypotheses;
  }

  private findAnalogies(query: string, entities: Array<{ type: string; value: string }>): string[] {
    const analogies: string[] = [];

    if (entities.some((e) => e.type === "territory")) {
      analogies.push("Similar to territorial management patterns in other regions");
    }

    if (entities.some((e) => e.type === "number")) {
      analogies.push("Numerical patterns may indicate a trend or threshold");
    }

    return analogies;
  }

  private identifyRisks(query: string, intentCategory: string): string[] {
    const risks: string[] = [];

    if (intentCategory === "command") {
      risks.push("Command execution may have irreversible effects");
    }
    if (intentCategory === "monetization") {
      risks.push("Financial decisions should be verified before execution");
    }
    if (intentCategory === "governance") {
      risks.push("Governance changes may affect multiple stakeholders");
    }

    return risks;
  }

  private suggestExperiments(query: string, intentCategory: string): string[] {
    const experiments: string[] = [];

    if (intentCategory === "analysis") {
      experiments.push("Run comparative analysis with different parameters");
    }
    if (intentCategory === "creation") {
      experiments.push("Create a minimal prototype first");
    }

    experiments.push("Validate assumptions with the user");

    return experiments;
  }
}

export const hypothesisEngine = new HypothesisEngine();
