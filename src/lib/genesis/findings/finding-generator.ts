import {
  Finding,
  FindingSeverity,
  FindingCategory,
  validateFinding,
  calculateCVSS,
  calculatePriority,
} from "../schemas/finding.schema";
import { Claim, Evidence } from "../schemas";

export type FindingGeneratorConfig = Record<string, never>;

export class FindingGenerator {
  constructor(_config: FindingGeneratorConfig = {}) {}

  generateFromClaimEvaluation(
    claim: Claim,
    verificationResult: {
      status: string;
      meetsRequirements: boolean;
      gaps: string[];
      confidenceScore: number;
      blockingFindings: Finding[];
    },
  ): Finding[] {
    const findings: Finding[] = [];

    if (!verificationResult.meetsRequirements) {
      for (const gap of verificationResult.gaps) {
        const severity = this.determineGapSeverity(claim, gap);
        findings.push(
          this.createFinding({
            title: `Claim ${claim.id} gap: ${gap}`,
            description: `El claim ${claim.id} (${claim.title}) no cumple requisitos: ${gap}`,
            severity,
            category: claim.category as FindingCategory,
            claimId: claim.id,
            location: { file: "claims registry" },
            remediation: {
              description: `Resolver gap: ${gap}`,
              effort: "MEDIUM",
              verificationSteps: [
                "Verificar evidencia",
                "Ejecutar tests",
                "Actualizar documentación",
              ],
            },
          }),
        );
      }
    }

    if (verificationResult.confidenceScore < 0.7) {
      findings.push(
        this.createFinding({
          title: `Low confidence for claim ${claim.id}`,
          description: `Confianza baja (${(verificationResult.confidenceScore * 100).toFixed(0)}%) para claim ${claim.id}`,
          severity: verificationResult.confidenceScore < 0.4 ? "HIGH" : "MEDIUM",
          category: claim.category as FindingCategory,
          claimId: claim.id,
          location: { file: "claims registry" },
          remediation: {
            description: "Mejorar calidad y cantidad de evidencia",
            effort: "HIGH",
            verificationSteps: [
              "Revisar evidencia existente",
              "Generar evidencia faltante",
              "Re-ejecutar tests",
            ],
          },
        }),
      );
    }

    return findings;
  }

  generateFromEvidenceQuality(
    evidence: Evidence,
    quality: {
      sourceVerification: boolean;
      reproducibility: boolean;
      independence: boolean;
      recency: boolean;
      completeness: number;
      immutability: boolean;
      overallScore: number;
    },
  ): Finding[] {
    const findings: Finding[] = [];

    if (!quality.sourceVerification) {
      findings.push(
        this.createFinding({
          title: `Evidence ${evidence.id} not independently verifiable`,
          description: `La evidencia ${evidence.id} no puede verificarse independientemente`,
          severity: "HIGH",
          category: "AUDIT",
          evidence: [
            {
              type: evidence.type,
              hash: evidence.content.hash,
              description: evidence.metadata.collectedAt,
            },
          ],
          remediation: {
            description: "Hacer la evidencia verificable independientemente",
            effort: "MEDIUM",
          },
        }),
      );
    }

    if (!quality.reproducibility) {
      findings.push(
        this.createFinding({
          title: `Evidence ${evidence.id} not reproducible`,
          description: `La evidencia ${evidence.id} no es reproducible`,
          severity: "HIGH",
          category: "AUDIT",
          evidence: [
            {
              type: evidence.type,
              hash: evidence.content.hash,
              description: evidence.metadata.collectedAt,
            },
          ],
          remediation: {
            description: "Asegurar que la evidencia se pueda reproducir",
            effort: "HIGH",
          },
        }),
      );
    }

    if (!quality.recency) {
      findings.push(
        this.createFinding({
          title: `Evidence ${evidence.id} expired`,
          description: `La evidencia ${evidence.id} ha expirado (TTL: ${evidence.metadata.ttlDays} días)`,
          severity: "MEDIUM",
          category: "AUDIT",
          evidence: [
            {
              type: evidence.type,
              hash: evidence.content.hash,
              description: evidence.metadata.collectedAt,
            },
          ],
          remediation: {
            description: "Regenerar evidencia fresca",
            effort: "MEDIUM",
          },
        }),
      );
    }

    if (!quality.immutability) {
      findings.push(
        this.createFinding({
          title: `Evidence ${evidence.id} not tamper-evident`,
          description: `La evidencia ${evidence.id} no tiene evidencia de manipulación`,
          severity: "CRITICAL",
          category: "AUDIT",
          evidence: [
            {
              type: evidence.type,
              hash: evidence.content.hash,
              description: evidence.metadata.collectedAt,
            },
          ],
          remediation: {
            description: "Implementar hash chain y firma criptográfica",
            effort: "HIGH",
          },
        }),
      );
    }

    return findings;
  }

  generateFromContradiction(contradiction: {
    type: "claim_vs_code" | "docs_vs_implementation" | "test_vs_behavior" | "evidence_vs_claim";
    description: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM";
    nodes: string[];
  }): Finding {
    return this.createFinding({
      title: `Contradiction detected: ${contradiction.type}`,
      description: contradiction.description,
      severity: contradiction.severity,
      category: this.mapContradictionTypeToCategory(contradiction.type),
      location: { file: contradiction.nodes.join(", ") },
      remediation: {
        description: `Resolver contradicción entre ${contradiction.nodes.join(" y ")}`,
        effort: "HIGH",
        verificationSteps: [
          "Identificar fuente de verdad",
          "Corregir implementación o documentación",
          "Re-verificar",
        ],
      },
    });
  }

  generateFromMissingEvidence(claim: Claim, missingTypes: string[]): Finding[] {
    return missingTypes.map((type) =>
      this.createFinding({
        title: `Missing evidence for claim ${claim.id}: ${type}`,
        description: `El claim ${claim.id} (${claim.title}) requiere evidencia de tipo ${type} que no se encontró`,
        severity: claim.requiredStatus === "PRODUCTION-VERIFIED" ? "CRITICAL" : "HIGH",
        category: claim.category as FindingCategory,
        claimId: claim.id,
        location: { file: "claims registry" },
        remediation: {
          description: `Generar evidencia de tipo ${type}`,
          effort: "HIGH",
          verificationSteps: [
            `Ejecutar tests para ${type}`,
            "Verificar resultados",
            "Registrar evidencia",
          ],
        },
      }),
    );
  }

  private determineGapSeverity(claim: Claim, gap: string): FindingSeverity {
    if (claim.requiredStatus === "PRODUCTION-VERIFIED") return "CRITICAL";
    if (claim.requiredStatus === "VERIFIED") return "HIGH";
    if (gap.includes("EXTERNAL_AUDIT") || gap.includes("CONCURRENCY_TEST")) return "HIGH";
    return "MEDIUM";
  }

  private mapContradictionTypeToCategory(type: string): FindingCategory {
    const map: Record<string, FindingCategory> = {
      claim_vs_code: "SECURITY",
      docs_vs_implementation: "MAINTAINABILITY",
      test_vs_behavior: "RELIABILITY",
      evidence_vs_claim: "AUDIT",
    };
    return map[type] ?? "SECURITY";
  }

  private createFinding(params: {
    title: string;
    description: string;
    severity: FindingSeverity;
    category: FindingCategory;
    claimId?: string;
    controlId?: string;
    location?: {
      file: string;
      line?: number;
      column?: number;
      function?: string;
    };
    evidence?: Array<{ type: string; hash: string; description: string }>;
    remediation?: {
      description: string;
      effort: "LOW" | "MEDIUM" | "HIGH";
      owner?: string;
      dueDate?: string;
      compensatingControl?: string;
      verificationSteps?: string[];
    };
  }): Finding {
    const baseFinding: Finding = {
      id: `GEN-${params.category}-${Date.now().toString(36).toUpperCase()}`,
      title: params.title,
      description: params.description,
      severity: params.severity,
      category: params.category,
      claimId: params.claimId,
      controlId: params.controlId,
      location: params.location,
      evidence: params.evidence ?? [],
      impact: {
        confidentiality: 0,
        integrity: 0,
        availability: 0,
        financial: 0,
        reputational: 0,
        compliance: 0,
      },
      exploitability: {
        attackVector: "NETWORK",
        attackComplexity: "LOW",
        privilegesRequired: "NONE",
        userInteraction: "NONE",
        scope: "UNCHANGED",
      } as const,
      blastRadius: "COMPONENT" as const,
      priority: { score: 0, rank: 0, shouldBlockRelease: false, slaHours: 24 },
      remediation: (() => {
        const configured = params.remediation;
        return {
          description: configured?.description ?? "Remediation needed",
          effort: configured?.effort ?? "MEDIUM",
          verificationSteps: configured?.verificationSteps ?? [],
          owner: configured?.owner,
          dueDate: configured?.dueDate,
          compensatingControl: configured?.compensatingControl,
        } satisfies Finding["remediation"];
      })(),
      status: "OPEN" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const cvss = calculateCVSS(baseFinding);
    const priority = calculatePriority(baseFinding);

    const completeFinding: Finding = {
      ...baseFinding,
      cvss: {
        ...cvss,
        temporalScore: cvss.baseScore,
        environmentalScore: cvss.baseScore,
      },
      priority,
    };

    return validateFinding(completeFinding);
  }
}

export function createFindingGenerator(config?: FindingGeneratorConfig): FindingGenerator {
  return new FindingGenerator(config);
}
