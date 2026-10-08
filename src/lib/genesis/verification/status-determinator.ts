import { Claim, ClaimStatus, Evidence, Finding } from "../schemas";
import { PolicyEngine } from "../engines/policy-engine";
import { EvidenceGraph, createEvidenceGraphAnalyzer } from "../graph/evidence-graph";

export interface VerificationConfig {
  policyEngine: PolicyEngine;
  evidenceGraph: EvidenceGraph;
}

interface GraphAnalysisView {
  coverageAnalysis?: { coveragePercentage?: number };
  confidenceAnalysis?: Array<{ claimId: string; confidenceScore: number }>;
  contradictions?: Array<{ severity: "CRITICAL" | string }>;
}

export interface ClaimVerificationResult {
  claimId: string;
  status: ClaimStatus;
  meetsRequirements: boolean;
  gaps: string[];
  confidenceScore: number;
  evidenceQuality: number;
  blockingFindings: Finding[];
}

export interface EvidenceQualityAssessment {
  evidenceId: string;
  sourceVerification: boolean;
  reproducibility: boolean;
  independence: boolean;
  recency: boolean;
  completeness: number;
  immutability: boolean;
  overallScore: number;
}

export interface ContradictionDetection {
  contradictions: Array<{
    type: "claim_vs_code" | "docs_vs_implementation" | "test_vs_behavior" | "evidence_vs_claim";
    description: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM";
    nodes: string[];
  }>;
}

export class StatusDeterminator {
  private policyEngine: PolicyEngine;
  private evidenceGraph: EvidenceGraph;

  constructor(config: VerificationConfig) {
    this.policyEngine = config.policyEngine;
    this.evidenceGraph = config.evidenceGraph;
  }

  determineStatus(
    claim: Claim,
    evidences: Evidence[],
    findings: Finding[],
  ): ClaimVerificationResult {
    const policyEvaluation = this.policyEngine.evaluateClaim(claim, evidences, findings);
    const graphAnalyzer = createEvidenceGraphAnalyzer(this.evidenceGraph);
    const analysis = graphAnalyzer.analyze();

    const confidence = this.calculateConfidence(claim, evidences, analysis);
    const evidenceQuality = this.assessEvidenceQuality(evidences);

    let status: ClaimStatus = "UNKNOWN";

    if (policyEvaluation.blockingFindings.length > 0) {
      status = "FAILED";
    } else if (!policyEvaluation.meetsRequirements) {
      const missingCount = policyEvaluation.gaps.length;
      if (missingCount === claim.evidenceRequired.length) status = "PLANNED";
      else if (missingCount > claim.evidenceRequired.length / 2) status = "PARTIAL";
      else status = "IMPLEMENTED";
    } else {
      status = claim.requiredStatus;
    }

    return {
      claimId: claim.id,
      status,
      meetsRequirements: policyEvaluation.meetsRequirements,
      gaps: policyEvaluation.gaps,
      confidenceScore: confidence,
      evidenceQuality,
      blockingFindings: policyEvaluation.blockingFindings,
    };
  }

  private calculateConfidence(
    claim: Claim,
    _evidences: Evidence[],
    analysis: GraphAnalysisView,
  ): number {
    const coverage = analysis.coverageAnalysis?.coveragePercentage ?? 0;
    const avgConfidence =
      analysis.confidenceAnalysis?.find((c) => c.claimId === claim.id)?.confidenceScore ?? 0;
    const hasBlockingFindings =
      analysis.contradictions?.some((c) => c.severity === "CRITICAL") ?? false;

    let confidence = (coverage / 100) * 0.4 + avgConfidence * 0.6;
    if (hasBlockingFindings) confidence *= 0.5;

    return Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;
  }

  private assessEvidenceQuality(evidences: Evidence[]): number {
    if (evidences.length === 0) return 0;

    let qualitySum = 0;
    for (const ev of evidences) {
      let q = 0;
      if (ev.metadata.independentlyVerifiable) q += 0.25;
      if (ev.metadata.reproducible) q += 0.25;
      if (ev.metadata.tamperEvident) q += 0.25;
      if (ev.metadata.cryptographicallySigned) q += 0.25;
      qualitySum += q;
    }

    return Math.round((qualitySum / evidences.length) * 100) / 100;
  }
}

export class CriteriaEvaluator {
  private policyEngine: PolicyEngine;

  constructor(policyEngine: PolicyEngine) {
    this.policyEngine = policyEngine;
  }

  evaluateClaimCriteria(
    claim: Claim,
    evidences: Evidence[],
  ): {
    passed: boolean;
    criteria: Array<{ criterion: string; passed: boolean; details: string }>;
  } {
    const requirements = this.policyEngine.getClaimRequirements(claim.requiredStatus);
    const criteria: Array<{
      criterion: string;
      passed: boolean;
      details: string;
    }> = [];

    const evidenceCount = evidences.length;
    criteria.push({
      criterion: `Minimum evidence count (${requirements.minEvidence})`,
      passed: evidenceCount >= requirements.minEvidence,
      details: `Found ${evidenceCount} evidence items`,
    });

    const coveredTypes = new Set<string>(evidences.map((e) => e.type));
    for (const requiredType of requirements.requiredEvidenceTypes) {
      const covered = coveredTypes.has(requiredType);
      criteria.push({
        criterion: `Required evidence type: ${requiredType}`,
        passed: covered,
        details: covered ? "Found" : "Missing",
      });
    }

    if (requirements.minCodeCoverage !== undefined) {
      const coverageEvidence = evidences.find((e) => e.metadata.testResult?.coverage !== undefined);
      const coverage = coverageEvidence?.metadata.testResult?.coverage ?? 0;
      criteria.push({
        criterion: `Code coverage >= ${(requirements.minCodeCoverage * 100).toFixed(0)}%`,
        passed: coverage >= requirements.minCodeCoverage,
        details: `Current coverage: ${(coverage * 100).toFixed(1)}%`,
      });
    }

    if (requirements.stabilityDays !== undefined) {
      const oldestEvidence = evidences.reduce((oldest, ev) => {
        const date = new Date(ev.metadata.collectedAt);
        return date < oldest ? date : oldest;
      }, new Date());
      const daysSince = (Date.now() - oldestEvidence.getTime()) / (1000 * 60 * 60 * 24);
      criteria.push({
        criterion: `Stability period >= ${requirements.stabilityDays} days`,
        passed: daysSince >= requirements.stabilityDays,
        details: `${Math.round(daysSince)} days since oldest evidence`,
      });
    }

    if (requirements.externalReviewRequired) {
      const hasExternalAudit = evidences.some((e) => e.type === "EXTERNAL_AUDIT");
      criteria.push({
        criterion: "External audit/review completed",
        passed: hasExternalAudit,
        details: hasExternalAudit ? "External audit evidence found" : "No external audit evidence",
      });
    }

    const passed = criteria.every((c) => c.passed);
    return { passed, criteria };
  }
}

export class EvidenceQualityChecker {
  assess(evidence: Evidence): EvidenceQualityAssessment {
    const checks = {
      sourceVerification: this.verifySource(evidence),
      reproducibility: this.checkReproducibility(evidence),
      independence: this.checkIndependence(evidence),
      recency: this.checkRecency(evidence),
      completeness: this.checkCompleteness(evidence),
      immutability: this.checkImmutability(evidence),
    };

    const passed = Object.values(checks).filter(Boolean).length;
    const overallScore = passed / Object.keys(checks).length;

    return {
      evidenceId: evidence.id,
      ...checks,
      overallScore: Math.round(overallScore * 100) / 100,
    };
  }

  private verifySource(evidence: Evidence): boolean {
    return evidence.metadata.independentlyVerifiable === true;
  }

  private checkReproducibility(evidence: Evidence): boolean {
    return evidence.metadata.reproducible === true;
  }

  private checkIndependence(evidence: Evidence): boolean {
    return evidence.source === "external" || evidence.metadata.independentlyVerifiable === true;
  }

  private checkRecency(evidence: Evidence): boolean {
    const ageDays =
      (Date.now() - new Date(evidence.metadata.collectedAt).getTime()) / (1000 * 60 * 60 * 24);
    return ageDays <= (evidence.metadata.ttlDays ?? 90);
  }

  private checkCompleteness(evidence: Evidence): number {
    let score = 0;
    if (evidence.content.hash) score += 0.2;
    if (evidence.content.size > 0) score += 0.2;
    if (evidence.location?.file) score += 0.2;
    if (evidence.metadata.environment) score += 0.2;
    if (evidence.metadata.testResult) score += 0.2;
    return score;
  }

  private checkImmutability(evidence: Evidence): boolean {
    return evidence.metadata.tamperEvident === true;
  }
}

export class ContradictionDetector {
  private evidenceGraph: EvidenceGraph;

  constructor(evidenceGraph: EvidenceGraph) {
    this.evidenceGraph = evidenceGraph;
  }

  detect(): ContradictionDetection {
    const analyzer = createEvidenceGraphAnalyzer(this.evidenceGraph);
    const analysis = analyzer.analyze();

    return {
      contradictions: analysis.contradictions.map((c) => ({
        type: c.contradictionType,
        description: c.description,
        severity: c.severity,
        nodes: [c.nodeA, c.nodeB],
      })),
    };
  }
}

export function createStatusDeterminator(config: VerificationConfig): StatusDeterminator {
  return new StatusDeterminator(config);
}

export function createCriteriaEvaluator(policyEngine: PolicyEngine): CriteriaEvaluator {
  return new CriteriaEvaluator(policyEngine);
}

export function createEvidenceQualityChecker(): EvidenceQualityChecker {
  return new EvidenceQualityChecker();
}

export function createContradictionDetector(evidenceGraph: EvidenceGraph): ContradictionDetector {
  return new ContradictionDetector(evidenceGraph);
}
