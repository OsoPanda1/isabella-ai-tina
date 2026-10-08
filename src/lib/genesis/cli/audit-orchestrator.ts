import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createClaimEngine } from "../engines/claim-engine";
import { getCiRunId, isCiEnvironment, loadConfig } from "../../config";
import { Claim } from "../schemas/claim.schema";
import { DEFAULT_CLAIMS } from "../schemas/claim.schema";
import { createPolicyEngine } from "../engines/policy-engine";
import { createFindingEngine, FindingEngine } from "../engines/finding-engine";
import { createEvidenceGraphBuilder, EvidenceGraph } from "../graph/evidence-graph";
import { createEvidenceStorage, EvidenceStorage } from "../evidence/storage";
import { createSourceScanner, SourceScanner } from "../scanners/source-scanner";
import { createEnvironmentScanner, EnvironmentScanner } from "../scanners/environment-scanner";
import { createSecurityScanner, SecurityScanner } from "../scanners/security-scanner";
import { createDatabaseScanner, DatabaseScanner } from "../scanners/database-scanner";
import { createFinancialScanner, FinancialScanner } from "../scanners/financial-scanner";
import { createAuthScanner, AuthScanner } from "../scanners/auth-scanner";
import { createCIScanner, CIScanner } from "../scanners/ci-scanner";
import { createSupplyChainScanner, SupplyChainScanner } from "../scanners/supply-chain-scanner";
import { createGovernanceScanner, GovernanceScanner } from "../scanners/governance-scanner";
import {
  createTestDiscovery,
  TestDiscovery,
  createTestExecutor,
  TestExecutor,
  TestDiscoveryResult,
  TestExecutionResult,
} from "../runners/test-runner";
import { createStatusDeterminator, StatusDeterminator } from "../verification/status-determinator";
import {
  createContradictionDetector,
  ContradictionDetector,
} from "../verification/status-determinator";
import { createFindingGenerator, FindingGenerator } from "../findings/finding-generator";
import { createJSONReporter, JSONReporter } from "../reporters/json-reporter";
import { createMarkdownReporter, MarkdownReporter } from "../reporters/json-reporter";
import { createHTMLReporter, HTMLReporter } from "../reporters/json-reporter";
import { createSARIFReporter, SARIFReporter } from "../reporters/json-reporter";
import {
  Manifest,
  ManifestContext,
  createEmptyManifest,
  ManifestSummary,
  ManifestIntegrity,
} from "../schemas/manifest.schema";
import { Finding } from "../schemas";
import {
  evaluateReleaseGate,
  createEvidenceCoverageMeasurer,
  isClaimSatisfiedByStatus,
  ReleaseGateInput,
} from "../release-gate";

export interface AuditOrchestratorConfig {
  rootDir?: string;
  outputDir?: string;
  claimsPath?: string;
  policyPath?: string;
  failFast?: boolean;
  verbose?: boolean;
  maxTestFilesToExecute?: number;
}

export class AuditOrchestrator {
  private config: Required<AuditOrchestratorConfig>;

  // Engines
  private claimEngine = createClaimEngine();
  private policyEngine = createPolicyEngine();
  private findingEngine: FindingEngine;
  private evidenceStorage: EvidenceStorage;
  private evidenceGraphBuilder = createEvidenceGraphBuilder();

  // Scanners
  private sourceScanner: SourceScanner;
  private envScanner: EnvironmentScanner;
  private securityScanner: SecurityScanner;
  private dbScanner: DatabaseScanner;
  private financialScanner: FinancialScanner;
  private authScanner: AuthScanner;
  private ciScanner: CIScanner;
  private supplyChainScanner: SupplyChainScanner;
  private governanceScanner: GovernanceScanner;

  // Runners
  private testDiscovery: TestDiscovery;
  private testExecutor: TestExecutor;
  private maxTestFilesToExecute: number;

  // Verification
  private statusDeterminator: StatusDeterminator;
  private contradictionDetector: ContradictionDetector;
  private findingGenerator: FindingGenerator;

  // Reporters
  private jsonReporter: JSONReporter;
  private markdownReporter: MarkdownReporter;
  private htmlReporter: HTMLReporter;
  private sarifReporter: SARIFReporter;

  constructor(config: AuditOrchestratorConfig = {}) {
    this.config = {
      rootDir: config.rootDir ?? process.cwd(),
      outputDir: config.outputDir ?? path.join(process.cwd(), "genesis"),
      claimsPath: config.claimsPath ?? "",
      policyPath: config.policyPath ?? "",
      failFast: config.failFast ?? false,
      verbose: config.verbose ?? false,
      maxTestFilesToExecute: config.maxTestFilesToExecute ?? 8,
    };

    // Initialize engines
    this.findingEngine = createFindingEngine({ claimEngine: this.claimEngine });
    this.evidenceStorage = createEvidenceStorage({
      baseDir: this.config.outputDir,
    });

    // Initialize scanners
    this.sourceScanner = createSourceScanner({ rootDir: this.config.rootDir });
    this.envScanner = createEnvironmentScanner({
      rootDir: this.config.rootDir,
    });
    this.securityScanner = createSecurityScanner({
      rootDir: this.config.rootDir,
    });
    this.dbScanner = createDatabaseScanner({ rootDir: this.config.rootDir });
    this.financialScanner = createFinancialScanner({
      rootDir: this.config.rootDir,
    });
    this.authScanner = createAuthScanner({ rootDir: this.config.rootDir });
    this.ciScanner = createCIScanner({ rootDir: this.config.rootDir });
    this.supplyChainScanner = createSupplyChainScanner({
      rootDir: this.config.rootDir,
    });
    this.governanceScanner = createGovernanceScanner({
      rootDir: this.config.rootDir,
    });

    // Initialize runners
    this.testDiscovery = createTestDiscovery({ rootDir: this.config.rootDir });
    this.testExecutor = createTestExecutor({ rootDir: this.config.rootDir });
    this.maxTestFilesToExecute =
      config.maxTestFilesToExecute ?? loadConfig().GENESIS_MAX_TEST_FILES ?? 8;

    // Initialize verification
    const evidenceGraph = this.evidenceGraphBuilder.build();
    this.statusDeterminator = createStatusDeterminator({
      policyEngine: this.policyEngine,
      evidenceGraph,
    });
    this.contradictionDetector = createContradictionDetector(evidenceGraph);
    this.findingGenerator = createFindingGenerator();

    // Initialize reporters
    this.jsonReporter = createJSONReporter({
      outputDir: path.join(this.config.outputDir, "reports"),
    });
    this.markdownReporter = createMarkdownReporter({
      outputDir: path.join(this.config.outputDir, "reports"),
    });
    this.htmlReporter = createHTMLReporter({
      outputDir: path.join(this.config.outputDir, "reports"),
    });
    this.sarifReporter = createSARIFReporter({
      outputDir: path.join(this.config.outputDir, "reports"),
    });
  }

  async runFullAudit(): Promise<{ manifest: Manifest; success: boolean }> {
    const startTime = Date.now();
    console.log("🌸 Genesis 2.0 Evidence Assurance Engine - Starting Full Audit");
    console.log("=".repeat(60));

    try {
      // Phase 1: Repository Scanning
      console.log("\n📋 Phase 1: Repository Scanning (READ-ONLY)");
      const scanResults = await this.runScanners();

      // Phase 2: Test Discovery & Execution
      console.log("\n🧪 Phase 2: Test Discovery & Execution");
      const testResults = await this.runTests();

      // Phase 3: Evidence Correlation
      console.log("\n🔗 Phase 3: Evidence Correlation & Graph Building");
      await this.correlateEvidence(scanResults, testResults);

      // Phase 4: Verification & Findings
      console.log("\n⚖️ Phase 4: Verification & Finding Generation");
      await this.verifyAndGenerateFindings();

      // Phase 5: Manifest Generation
      console.log("\n📄 Phase 5: Manifest Generation");
      const manifest = await this.generateManifest();

      // Phase 6: Reporting
      console.log("\n📊 Phase 6: Report Generation");
      await this.generateReports(manifest);

      const duration = Date.now() - startTime;
      console.log("\n" + "=".repeat(60));
      console.log(`✅ Audit completed in ${(duration / 1000).toFixed(1)}s`);
      console.log(`📁 Reports saved to: ${path.join(this.config.outputDir, "reports")}`);
      console.log(`📋 Manifest saved to: ${path.join(this.config.outputDir, "manifests")}`);
      console.log("=".repeat(60));

      return { manifest, success: true };
    } catch (error) {
      console.error("\n❌ Audit failed:", error);
      return {
        manifest: createEmptyManifest("", {
          repository: {
            name: "",
            url: "",
            commit: "",
            branch: "",
            snapshotHash: "",
            snapshotTimestamp: "",
          },
          environment: {
            runner: "",
            runnerId: "",
            os: "",
            nodeVersion: "",
            pnpmVersion: "",
            dependencyLockHash: "",
          },
        }),
        success: false,
      };
    }
  }

  private async runScanners(): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    const scanners: Array<{
      name: string;
      scanner: { scan: () => Promise<unknown> | unknown };
    }> = [
      { name: "Source", scanner: this.sourceScanner },
      { name: "Environment", scanner: this.envScanner },
      { name: "Security", scanner: this.securityScanner },
      { name: "Database", scanner: this.dbScanner },
      { name: "Financial", scanner: this.financialScanner },
      { name: "Auth", scanner: this.authScanner },
      { name: "CI/CD", scanner: this.ciScanner },
      {
        name: "Supply Chain",
        scanner: this.supplyChainScanner,
      },
      { name: "Governance", scanner: this.governanceScanner },
    ];

    for (const { name, scanner } of scanners) {
      console.log(`  🔍 Running ${name} Scanner...`);
      try {
        const result = (await Promise.resolve(scanner.scan())) as {
          statistics?: { totalFiles?: number };
          findings?: Array<{ severity: string }>;
        };
        results[name.toLowerCase()] = result;
        console.log(`    ✅ ${name} Scanner completed`);

        if (this.config.failFast && result.statistics) {
          const critical = result.findings?.filter((f) => f.severity === "CRITICAL").length ?? 0;
          if (critical > 0) {
            console.log(`    ⚠️ ${critical} critical findings - failing fast`);
            if (this.config.failFast) throw new Error(`Critical findings in ${name} scanner`);
          }
        }
      } catch (error) {
        console.log(
          `    ❌ ${name} Scanner failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        results[name.toLowerCase()] = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return results;
  }

  private async runTests(): Promise<TestDiscoveryResult & { execution?: TestExecutionResult }> {
    console.log("  🔍 Discovering tests...");
    const discovery = this.testDiscovery.discover();
    console.log(`    Found ${discovery.totalTests} tests in ${discovery.testFiles.length} files`);

    let execution: TestExecutionResult | undefined;
    const filesToRun = discovery.testFiles.slice(0, this.maxTestFilesToExecute);
    if (filesToRun.length > 0) {
      console.log(`  🏃 Executing tests in sandbox (${filesToRun.length} files, best-effort)...`);
      try {
        execution = await this.testExecutor.execute(filesToRun);
        console.log(
          `    ${execution.summary.passed} passed, ${execution.summary.failed} failed, ` +
            `${execution.summary.skipped} skipped in ${(execution.summary.durationMs / 1000).toFixed(1)}s`,
        );
      } catch (error) {
        console.log(
          `    ❌ Test execution failed; no test evidence will be credited: ${error instanceof Error ? error.message : String(error)}`,
        );
        execution = {
          summary: { passed: 0, failed: 1, skipped: 0, durationMs: 0 },
          files: filesToRun,
          output: error instanceof Error ? error.message : String(error),
        } as unknown as TestExecutionResult;
      }
    }

    return { ...discovery, execution };
  }

  private async correlateEvidence(
    scanResults: Record<string, unknown>,
    testResults: TestDiscoveryResult & { execution?: TestExecutionResult },
  ): Promise<void> {
    // Add claims to graph
    for (const claim of DEFAULT_CLAIMS) {
      this.evidenceGraphBuilder.addClaim(claim);
    }

    // Wire scanner + test evidence into the claim engine (recolecta evidencia real)
    this.claimEngine.setScanResults(scanResults);
    this.claimEngine.setTestResults(testResults, testResults?.execution);

    // Add evidence items to the evidence graph
    for (const claim of DEFAULT_CLAIMS) {
      const evidences = this.claimEngine.getEvidences(claim.id);
      for (const evidence of evidences) {
        this.evidenceGraphBuilder.addEvidence(evidence);
      }
    }
  }

  private async verifyAndGenerateFindings(): Promise<void> {
    const claims = this.claimEngine.getAllClaims();

    for (const claim of claims) {
      const evidences = this.claimEngine.getEvidences(claim.id);
      const findings = this.claimEngine.getFindings(claim.id);

      // Determine status
      const verification = this.statusDeterminator.determineStatus(claim, evidences, findings);

      // Generate findings from gaps
      if (!verification.meetsRequirements) {
        const generatedFindings = this.findingGenerator.generateFromClaimEvaluation(
          claim,
          verification,
        );
        for (const f of generatedFindings) {
          this.findingEngine.createFinding(f);
        }
      }

      // Generate findings from low confidence
      if (verification.confidenceScore < 0.7) {
        const generatedFindings = this.findingGenerator.generateFromClaimEvaluation(
          claim,
          verification,
        );
        for (const f of generatedFindings) {
          this.findingEngine.createFinding(f);
        }
      }
    }

    // Check evidence quality
    // This would iterate over all evidence

    // Check contradictions
    const contradictions = this.contradictionDetector.detect();
    for (const contradiction of contradictions.contradictions) {
      const finding = this.findingGenerator.generateFromContradiction(contradiction);
      this.findingEngine.createFinding(finding);
    }
  }

  private async generateManifest(): Promise<Manifest> {
    const claims = this.claimEngine.getAllClaims();
    const findings = this.findingEngine.getAllFindings();
    const graph = this.evidenceGraphBuilder.build();

    // Calculate summary with real evidence + release gate (P0-90)
    const coverageMeasurer = createEvidenceCoverageMeasurer(claims, (claimId: string) =>
      this.claimEngine.getEvidences(claimId),
    );
    const gateInput: ReleaseGateInput = {
      claims,
      findings,
      productionReadiness: this.calculateProductionReadiness(claims, findings),
      evidenceCoverage: coverageMeasurer.overallCoverage,
      claimSatisfied: (claimId: string) =>
        isClaimSatisfiedByStatus(this.claimEngine.evaluateClaimStatus(claimId)),
      domainEvidenceCoverage: (domainId: string) =>
        coverageMeasurer.domainEvidenceCoverage(domainId),
    };
    const summary = this.calculateSummary(claims, findings, gateInput);

    // Create context
    const context: ManifestContext = {
      repository: {
        name: "isabella-ai-genesis",
        url: "https://github.com/OsoPanda1/isabella-ai-genesis",
        commit: this.getGitCommit(),
        branch: this.getGitBranch(),
        snapshotHash: await this.calculateSnapshotHash(),
        snapshotTimestamp: new Date().toISOString(),
      },
      environment: {
        runner: isCiEnvironment() ? "GitHub Actions" : "local",
        runnerId: isCiEnvironment() ? getCiRunId() : "local",
        os: process.platform,
        nodeVersion: process.version,
        pnpmVersion: this.getPnpmVersion(),
        dependencyLockHash: await this.calculateLockfileHash(),
      },
    };

    // Calculate integrity hashes
    const integrity = this.calculateIntegrity(claims, findings, graph);

    const manifest: Manifest = {
      manifest: {
        version: "2.0.1",
        generatedAt: new Date().toISOString(),
        generator: "genesis-audit-engine",
        generatorVersion: "2.0.1",
        generatorHash: await this.calculateGeneratorHash(),
      },
      context,
      summary,
      claims,
      controls: [],
      findings,
      evidenceReferences: [],
      integrity,
    };

    await this.evidenceStorage.saveManifest(manifest);
    return manifest;
  }

  private calculateSummary(
    claims: Claim[],
    findings: Finding[],
    gateInput: ReleaseGateInput,
  ): ManifestSummary {
    const byStatus: Record<string, number> = {};
    for (const claim of claims) {
      const status = this.claimEngine.evaluateClaimStatus(claim.id);
      byStatus[status.toLowerCase().replace("-", "")] =
        (byStatus[status.toLowerCase().replace("-", "")] ?? 0) + 1;
    }

    const bySeverity: Record<string, number> = {};
    for (const finding of findings) {
      bySeverity[finding.severity.toLowerCase()] =
        (bySeverity[finding.severity.toLowerCase()] ?? 0) + 1;
    }

    // Release gate determinista basado en evidencia real (P0-90).
    const gate = evaluateReleaseGate(gateInput);
    const releaseDecision = {
      decision: gate.decision,
      blockingFindings: gate.blockingFindings,
      justification: gate.justification,
    };

    return {
      totalClaims: claims.length,
      totalControls: 0,
      totalTests: 0,
      totalEvidence: 0,
      totalFindings: findings.length,
      bySeverity: {
        critical: bySeverity.critical ?? 0,
        high: bySeverity.high ?? 0,
        medium: bySeverity.medium ?? 0,
        low: bySeverity.low ?? 0,
        informational: bySeverity.informational ?? 0,
      },
      byStatus: {
        planned: byStatus.planned ?? 0,
        designed: byStatus.designed ?? 0,
        partial: byStatus.partial ?? 0,
        implemented: byStatus.implemented ?? 0,
        tested: byStatus.tested ?? 0,
        verified: byStatus.verified ?? 0,
        productionVerified: byStatus.productionverified ?? 0,
        failed: byStatus.failed ?? 0,
        unknown: byStatus.unknown ?? 0,
        notApplicable: byStatus.notapplicable ?? 0,
      },
      scores: {
        engineeringMaturity: this.calculateEngineeringMaturity(claims, findings),
        evidenceMaturity: this.calculateEvidenceMaturity(gateInput),
        productionReadiness: this.calculateProductionReadiness(claims, findings),
      },
      releaseDecision,
    };
  }

  private calculateEngineeringMaturity(claims: Claim[], findings: Finding[]): number {
    const implemented = claims.filter((c) =>
      ["IMPLEMENTED", "TESTED", "VERIFIED", "PRODUCTION-VERIFIED"].includes(
        this.claimEngine.evaluateClaimStatus(c.id),
      ),
    ).length;
    const criticalFindings = findings.filter((f) => f.severity === "CRITICAL").length;
    const highFindings = findings.filter((f) => f.severity === "HIGH").length;

    let score = (implemented / Math.max(claims.length, 1)) * 100;
    score -= criticalFindings * 15;
    score -= highFindings * 5;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private calculateEvidenceMaturity(gateInput: ReleaseGateInput): number {
    // Madurez de evidencia = cobertura real de tipos de evidencia requeridos
    // por los claims (misma métrica que usa el release gate, P0-90).
    return Math.max(0, Math.min(100, Math.round(gateInput.evidenceCoverage)));
  }

  private calculateProductionReadiness(claims: Claim[], findings: Finding[]): number {
    const productionVerified = claims.filter(
      (c) => this.claimEngine.evaluateClaimStatus(c.id) === "PRODUCTION-VERIFIED",
    ).length;
    const criticalFindings = findings.filter((f) => f.severity === "CRITICAL").length;
    const highFindings = findings.filter((f) => f.severity === "HIGH").length;

    let score = (productionVerified / Math.max(claims.length, 1)) * 100;
    score -= criticalFindings * 20;
    score -= highFindings * 10;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private calculateIntegrity(
    claims: Claim[],
    findings: Finding[],
    graph: EvidenceGraph,
  ): ManifestIntegrity {
    const claimsContent = JSON.stringify(
      claims.map((c) => ({
        id: c.id,
        status: this.claimEngine.evaluateClaimStatus(c.id),
      })),
    );
    const findingsContent = JSON.stringify(
      findings.map((f) => ({ id: f.id, severity: f.severity })),
    );
    const controlsContent = JSON.stringify(
      graph.nodes.filter((node) => node.type === "control").map((node) => node.data),
    );
    const evidenceContent = JSON.stringify(
      graph.nodes.filter((node) => node.type === "evidence").map((node) => node.data),
    );
    const hash = (content: string) => createHash("sha3-512").update(content).digest("hex");
    const claimsHash = hash(claimsContent);
    const controlsHash = hash(controlsContent);
    const findingsHash = hash(findingsContent);
    const evidenceHash = hash(evidenceContent);
    return {
      claimsHash,
      controlsHash,
      findingsHash,
      evidenceHash,
      manifestHash: hash(
        [claimsHash, controlsHash, findingsHash, evidenceHash, graph.edges].map(String).join("|"),
      ),
    };
  }

  private async calculateSnapshotHash(): Promise<string> {
    const files = execSync("git ls-files -z", {
      cwd: this.config.rootDir,
      encoding: "buffer",
    })
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .sort();
    const hash = createHash("sha3-512");
    for (const file of files) {
      const content = fs.readFileSync(path.join(this.config.rootDir, file));
      hash.update(file).update("\0").update(content).update("\0");
    }
    return hash.digest("hex");
  }

  private async calculateGeneratorHash(): Promise<string> {
    const files = [
      "src/lib/genesis/cli/audit-orchestrator.ts",
      "src/lib/genesis/schemas/evidence.schema.ts",
    ];
    const hash = createHash("sha3-512");
    for (const file of files) {
      const absolute = path.join(this.config.rootDir, file);
      if (fs.existsSync(absolute)) hash.update(file).update("\0").update(fs.readFileSync(absolute));
    }
    return hash.digest("hex");
  }

  private async calculateLockfileHash(): Promise<string> {
    const lockfilePath = path.join(this.config.rootDir, "pnpm-lock.yaml");
    if (fs.existsSync(lockfilePath)) {
      const content = fs.readFileSync(lockfilePath, "utf8");
      return createHash("sha3-512").update(content).digest("hex");
    }
    return "0".repeat(128);
  }

  private getGitCommit(): string {
    try {
      return execSync("git rev-parse HEAD", {
        cwd: this.config.rootDir,
        encoding: "utf8",
      }).trim();
    } catch {
      return "unknown";
    }
  }

  private getGitBranch(): string {
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: this.config.rootDir,
        encoding: "utf8",
      }).trim();
    } catch {
      return "unknown";
    }
  }

  private getPnpmVersion(): string {
    try {
      return execSync("pnpm --version", {
        cwd: this.config.rootDir,
        encoding: "utf8",
      }).trim();
    } catch {
      return "unknown";
    }
  }

  private async generateReports(manifest: Manifest): Promise<void> {
    this.jsonReporter.generate(manifest);
    this.markdownReporter.generate(manifest);
    this.htmlReporter.generate(manifest);
    this.sarifReporter.generate(manifest.findings);

    const findings = this.findingEngine.getAllFindings();
    this.jsonReporter.generateFindings(findings);

    const graph = this.evidenceGraphBuilder.build();
    this.jsonReporter.generateEvidenceGraph(graph);
  }
}

export function createAuditOrchestrator(config?: AuditOrchestratorConfig): AuditOrchestrator {
  return new AuditOrchestrator(config);
}
