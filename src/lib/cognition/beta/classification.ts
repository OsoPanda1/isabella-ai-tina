/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — BETA / CLASSIFICATION
 * Clasifica datos según niveles:
 * PUBLIC, INTERNAL, PRIVATE, SENSITIVE, RESTRICTED, CRITICAL
 * ================================================================
 */

import type { DataClassification } from "../contracts";

export interface ClassificationResult {
  classification: DataClassification;
  confidence: number;
  reason: string;
  factors: string[];
}

export class ClassificationEngine {
  private classificationRules: Array<{
    pattern: RegExp;
    classification: DataClassification;
    weight: number;
  }> = [
    {
      pattern: /\b(password|secret|token|key|credential)\b/i,
      classification: "critical",
      weight: 1.0,
    },
    {
      pattern: /\b(ssn|social security|credit card|bank account)\b/i,
      classification: "restricted",
      weight: 0.95,
    },
    {
      pattern: /\b(personal|private|confidential)\b/i,
      classification: "sensitive",
      weight: 0.8,
    },
    {
      pattern: /\b(internal|team|organization)\b/i,
      classification: "internal",
      weight: 0.7,
    },
    {
      pattern: /\b(public|open|shared)\b/i,
      classification: "public",
      weight: 0.6,
    },
  ];

  /**
   * Classify input based on content analysis.
   */
  classify(
    input: string,
    context?: {
      intentCategory?: string;
      entities?: Array<{ type: string }>;
    },
  ): ClassificationResult {
    const factors: string[] = [];
    let maxWeight = 0;
    let suggestedClassification: DataClassification = "public";

    for (const rule of this.classificationRules) {
      if (rule.pattern.test(input)) {
        factors.push(`Matched pattern: ${rule.pattern.source}`);
        if (rule.weight > maxWeight) {
          maxWeight = rule.weight;
          suggestedClassification = rule.classification;
        }
      }
    }

    if (context?.intentCategory === "governance") {
      if (suggestedClassification === "public") {
        suggestedClassification = "internal";
        factors.push("Governance intent elevates classification");
      }
    }

    if (context?.entities?.some((e) => e.type === "email" || e.type === "url")) {
      if (suggestedClassification === "public") {
        suggestedClassification = "internal";
        factors.push("PII entities detected");
      }
    }

    return {
      classification: suggestedClassification,
      confidence: maxWeight > 0 ? maxWeight : 0.5,
      reason: factors.length > 0 ? factors.join("; ") : "No specific classification rules matched",
      factors,
    };
  }

  /**
   * Check if a classification allows access at the required level.
   */
  allowsAccess(dataClassification: DataClassification, requiredLevel: DataClassification): boolean {
    const levels: DataClassification[] = [
      "public",
      "internal",
      "private",
      "sensitive",
      "restricted",
      "critical",
    ];
    const dataIndex = levels.indexOf(dataClassification);
    const requiredIndex = levels.indexOf(requiredLevel);

    return dataIndex <= requiredIndex;
  }
}

export const classificationEngine = new ClassificationEngine();
