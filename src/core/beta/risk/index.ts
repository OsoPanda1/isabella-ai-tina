/**
 * Beta — Risk Assessment
 *
 * Evalúa riesgo en niveles: R0-R4
 */

import type { RiskLevel } from "../../contracts";

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  factors: string[];
  mitigations: string[];
  requiresApproval: boolean;
}

export class RiskEngine {
  /**
   * Assess risk based on intent, classification, and context.
   */
  assess(params: {
    intent: string;
    classification: string;
    hasExternalData?: boolean;
    isIrreversible?: boolean;
    involvesFinancial?: boolean;
    involvesGovernance?: boolean;
  }): RiskAssessment {
    let score = 0;
    const factors: string[] = [];
    const mitigations: string[] = [];

    // Classification risk
    const classificationRisks: Record<string, number> = {
      critical: 40,
      restricted: 30,
      sensitive: 20,
      private: 10,
      internal: 5,
      public: 0,
    };
    const classRisk = classificationRisks[params.classification] ?? 0;
    if (classRisk > 0) {
      score += classRisk;
      factors.push(`Classification: ${params.classification} (+${classRisk})`);
    }

    // Intent risk
    if (params.involvesGovernance) {
      score += 20;
      factors.push("Governance involvement (+20)");
    }
    if (params.involvesFinancial) {
      score += 15;
      factors.push("Financial operations (+15)");
    }
    if (params.isIrreversible) {
      score += 25;
      factors.push("Irreversible action (+25)");
    }
    if (params.hasExternalData) {
      score += 10;
      factors.push("External data involved (+10)");
    }

    // Determine level
    let level: RiskLevel;
    let requiresApproval = false;

    if (score >= 60) {
      level = "R4_critical";
      requiresApproval = true;
      mitigations.push("Requires explicit approval");
      mitigations.push("Full audit trail required");
    } else if (score >= 40) {
      level = "R3_high";
      requiresApproval = true;
      mitigations.push("Requires approval");
      mitigations.push("Review recommended");
    } else if (score >= 20) {
      level = "R2_moderate";
      mitigations.push("Standard monitoring");
    } else if (score >= 5) {
      level = "R1_low";
      mitigations.push("Basic logging");
    } else {
      level = "R0_informational";
    }

    return {
      level,
      score,
      factors,
      mitigations,
      requiresApproval,
    };
  }
}

export const riskEngine = new RiskEngine();
