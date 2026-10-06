/**
 * Alpha — Proposal Engine
 *
 * Transforma el análisis en una propuesta viable con:
 * objetivo, valor, alternativas, recursos, costo, tiempo,
 * riesgo, métricas, primer entregable.
 */

import type { Proposal, ProposalAlternative } from "../../contracts";

export interface ProposalInput {
  query: string;
  intent: string;
  hypothesis: string;
  alternatives: string[];
  risks: string[];
  experiments: string[];
  constraints?: {
    maxCostUsd?: number;
    maxLatencyMs?: number;
    maxSteps?: number;
  };
}

export class ProposalEngine {
  /**
   * Generate a structured proposal from analysis results.
   */
  generate(input: ProposalInput): Proposal {
    const alternatives = this.generateAlternatives(input);
    const assumptions = this.extractAssumptions(input);
    const uncertainties = this.extractUncertainties(input);
    const metrics = this.defineMetrics(input);

    return {
      proposalId: crypto.randomUUID(),
      title: this.generateTitle(input.query),
      problem: input.hypothesis,
      valueProposition: this.generateValueProposition(input),
      audience: this.identifyAudience(input.intent),
      alternatives,
      assumptions,
      uncertainties,
      firstDeliverable: this.defineFirstDeliverable(input),
      metrics,
      status: "draft",
      createdAt: new Date().toISOString(),
    };
  }

  private generateTitle(query: string): string {
    const words = query.split(" ").slice(0, 8).join(" ");
    return `Proposal: ${words}`;
  }

  private generateValueProposition(input: ProposalInput): string {
    return `Addressing: ${input.query}. This proposal provides a structured approach with ${input.alternatives.length} alternatives and ${input.risks.length} identified risks.`;
  }

  private generateAlternatives(input: ProposalInput): ProposalAlternative[] {
    const alternatives: ProposalAlternative[] = [
      {
        name: "Direct approach",
        cost: 0,
        currency: "USD",
        risk: "low",
        timeToFirstResult: "immediate",
      },
      {
        name: "Research-first approach",
        cost: 50,
        currency: "USD",
        risk: "low",
        timeToFirstResult: "1-2 hours",
      },
      {
        name: "Full implementation",
        cost: 200,
        currency: "USD",
        risk: "medium",
        timeToFirstResult: "1-3 days",
      },
    ];

    // Adjust based on constraints
    if (input.constraints?.maxCostUsd) {
      return alternatives.filter((a) => a.cost <= input.constraints!.maxCostUsd!);
    }

    return alternatives;
  }

  private identifyAudience(intent: string): string[] {
    const audiences: Record<string, string[]> = {
      question: ["user"],
      command: ["user", "system"],
      request: ["user"],
      creation: ["user", "team"],
      analysis: ["user", "analysts"],
      governance: ["admin", "team"],
      monetization: ["user", "finance"],
      system: ["admin"],
    };

    return audiences[intent] ?? ["user"];
  }

  private extractAssumptions(input: ProposalInput): string[] {
    return [
      "Available information is accurate and up-to-date",
      "User has necessary permissions for requested actions",
      "System resources are available for execution",
      "No conflicting operations are in progress",
    ];
  }

  private extractUncertainties(input: ProposalInput): string[] {
    const uncertainties = [
      "External system availability may affect execution",
      "User intent may differ from literal interpretation",
    ];

    if (input.risks.length > 0) {
      uncertainties.push(`Identified risks: ${input.risks.join(", ")}`);
    }

    return uncertainties;
  }

  private defineFirstDeliverable(input: ProposalInput): string {
    return `Initial response addressing: ${input.query.slice(0, 100)}`;
  }

  private defineMetrics(input: ProposalInput): string[] {
    return [
      "User satisfaction score",
      "Response accuracy",
      "Execution time",
      "Resource utilization",
      "Error rate",
    ];
  }
}

export const proposalEngine = new ProposalEngine();
