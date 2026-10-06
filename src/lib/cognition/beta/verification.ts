/**
 * ================================================================
 * ISABELLA VILLASEÑOR AI — BETA / VERIFICATION
 * Valida resultado, seguridad, coherencia, evidencia,
 * costo, reversibilidad y provenance.
 * ================================================================
 */

import type { CrownDecision, EvidenceRecord, ProvenanceRecord } from "../contracts";

export interface VerificationResult {
  verified: boolean;
  checks: VerificationCheck[];
  overallScore: number;
  requiresCorrection: boolean;
  correctionSuggestions: string[];
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  score: number;
  details: string;
}

export class VerificationEngine {
  /**
   * Verify a response against all verification criteria.
   */
  verify(params: {
    response: string;
    governance: CrownDecision;
    evidence: EvidenceRecord[];
    provenance: ProvenanceRecord;
    costUsd: number;
    reversible: boolean;
  }): VerificationResult {
    const checks: VerificationCheck[] = [];

    checks.push(this.checkSecurity(params.response));
    checks.push(this.checkCoherence(params.response));
    checks.push(this.checkEvidence(params.evidence));
    checks.push(this.checkCost(params.costUsd));
    checks.push(this.checkReversibility(params.reversible, params.governance));
    checks.push(this.checkProvenance(params.provenance));
    checks.push(this.checkPolicyCompliance(params.governance));

    const passedChecks = checks.filter((c) => c.passed).length;
    const overallScore = passedChecks / checks.length;
    const requiresCorrection = overallScore < 0.7;
    const correctionSuggestions = checks
      .filter((c) => !c.passed)
      .map((c) => `Fix: ${c.name} - ${c.details}`);

    return {
      verified: overallScore >= 0.7,
      checks,
      overallScore,
      requiresCorrection,
      correctionSuggestions,
    };
  }

  private checkSecurity(response: string): VerificationCheck {
    const hasSensitiveData = /\b(password|secret|token|key)\b/i.test(response);
    const hasExternalUrls = /\bhttps?:\/\/(?!localhost)\b/i.test(response);

    return {
      name: "Security",
      passed: !hasSensitiveData,
      score: hasSensitiveData ? 0 : 1,
      details: hasSensitiveData
        ? "Response contains potentially sensitive data"
        : "No sensitive data detected",
    };
  }

  private checkCoherence(response: string): VerificationCheck {
    const hasContent = response.length > 10;
    const hasStructure = response.includes(".") || response.includes("\n");

    return {
      name: "Coherence",
      passed: hasContent && hasStructure,
      score: hasContent && hasStructure ? 1 : 0.5,
      details:
        hasContent && hasStructure
          ? "Response has adequate content and structure"
          : "Response may be too short or unstructured",
    };
  }

  private checkEvidence(evidence: EvidenceRecord[]): VerificationCheck {
    const hasEvidence = evidence.length > 0;
    const avgConfidence = hasEvidence
      ? evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length
      : 0;

    return {
      name: "Evidence",
      passed: hasEvidence && avgConfidence > 0.5,
      score: avgConfidence,
      details: hasEvidence
        ? `${evidence.length} evidence records, avg confidence: ${avgConfidence.toFixed(2)}`
        : "No evidence records provided",
    };
  }

  private checkCost(costUsd: number): VerificationCheck {
    const acceptable = costUsd < 10;

    return {
      name: "Cost",
      passed: acceptable,
      score: acceptable ? 1 : 0.5,
      details: `Cost: $${costUsd.toFixed(2)} USD`,
    };
  }

  private checkReversibility(reversible: boolean, governance: CrownDecision): VerificationCheck {
    const appropriate = reversible || governance.result === "allow";

    return {
      name: "Reversibility",
      passed: appropriate,
      score: appropriate ? 1 : 0.5,
      details: reversible ? "Operation is reversible" : "Operation is irreversible but approved",
    };
  }

  private checkProvenance(provenance: ProvenanceRecord): VerificationCheck {
    const hasProvenance = !!provenance.auditId;
    const hasHashes = !!provenance.requestHash && !!provenance.outputHash;

    return {
      name: "Provenance",
      passed: hasProvenance && hasHashes,
      score: hasProvenance && hasHashes ? 1 : 0.5,
      details:
        hasProvenance && hasHashes ? "Provenance record complete" : "Provenance record incomplete",
    };
  }

  private checkPolicyCompliance(governance: CrownDecision): VerificationCheck {
    const isCompliant = governance.result !== "deny";

    return {
      name: "Policy Compliance",
      passed: isCompliant,
      score: isCompliant ? 1 : 0,
      details: isCompliant
        ? `Policy decision: ${governance.result}`
        : `Policy denied: ${governance.reason}`,
    };
  }
}

export const verificationEngine = new VerificationEngine();
