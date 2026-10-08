import * as fs from "node:fs";
import * as path from "node:path";
import { Claim, DEFAULT_CLAIMS } from "../schemas/claim.schema";

export interface GovernanceScannerConfig {
  rootDir?: string;
  charterPath?: string;
}

export interface GovernanceScanResult {
  claims: ClaimAnalysis[];
  policies: PolicyAnalysis[];
  docsCodeReconciliation: DocsCodeReconciliation[];
  findings: GovernanceFinding[];
  statistics: {
    totalClaims: number;
    claimsWithEvidence: number;
    policiesImplemented: number;
    docsCodeMatch: number;
  };
}

export interface ClaimAnalysis {
  claim: Claim;
  evidenceFound: boolean;
  codeImplemented: boolean;
  testsPassing: boolean;
  status:
    | "PLANNED"
    | "DESIGNED"
    | "PARTIAL"
    | "IMPLEMENTED"
    | "TESTED"
    | "VERIFIED"
    | "PRODUCTION-VERIFIED"
    | "FAILED"
    | "UNKNOWN"
    | "NOT-APPLICABLE";
  gaps: string[];
}

export interface PolicyAnalysis {
  id: string;
  title: string;
  implemented: boolean;
  location: string;
  tests: string[];
}

export interface DocsCodeReconciliation {
  docFile: string;
  codeFile: string;
  match: boolean;
  discrepancies: string[];
}

export interface GovernanceFinding {
  id: string;
  type:
    | "CLAIM_WITHOUT_EVIDENCE"
    | "CLAIM_WITHOUT_CODE"
    | "CLAIM_WITHOUT_TESTS"
    | "POLICY_NOT_IMPLEMENTED"
    | "DOCS_CODE_MISMATCH"
    | "CHARTER_CLAIM_MISSING"
    | "EVIDENCE_EXPIRED"
    | "STATUS_INFLATED";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  location: string;
  remediation: string;
}

const CHARTER_PATHS = [
  "docs/governance/01-FGAIS-Governance-Constitution.md",
  "docs/governance/CHARTER.md",
  "CHARTER.md",
];

export class GovernanceScanner {
  private config: Required<GovernanceScannerConfig>;

  constructor(config: GovernanceScannerConfig = {}) {
    this.config = {
      rootDir: config.rootDir ?? process.cwd(),
      charterPath:
        config.charterPath ??
        CHARTER_PATHS.find((p) => fs.existsSync(path.join(process.cwd(), p))) ??
        CHARTER_PATHS[0],
    };
  }

  scan(): GovernanceScanResult {
    const claims = this.scanClaims();
    const policies = this.scanPolicies();
    const docsCodeReconciliation = this.reconcileDocsCode();
    const findings = this.generateFindings(claims, policies, docsCodeReconciliation);

    return {
      claims,
      policies,
      docsCodeReconciliation,
      findings,
      statistics: {
        totalClaims: claims.length,
        claimsWithEvidence: claims.filter((c) => c.evidenceFound).length,
        policiesImplemented: policies.filter((p) => p.implemented).length,
        docsCodeMatch: docsCodeReconciliation.filter((r) => r.match).length,
      },
    };
  }

  private scanClaims(): ClaimAnalysis[] {
    const results: ClaimAnalysis[] = [];

    for (const claim of DEFAULT_CLAIMS) {
      const evidenceFound = this.checkClaimEvidence(claim);
      const codeImplemented = this.checkClaimCode(claim);
      const testsPassing = this.checkClaimTests(claim);
      const status = this.determineStatus(claim, evidenceFound, codeImplemented, testsPassing);
      const gaps = this.identifyGaps(claim, evidenceFound, codeImplemented, testsPassing);

      results.push({
        claim,
        evidenceFound,
        codeImplemented,
        testsPassing,
        status,
        gaps,
      });
    }

    return results;
  }

  private checkClaimEvidence(claim: Claim): boolean {
    const evidenceTypes = claim.evidenceRequired;
    let found = 0;

    for (const type of evidenceTypes) {
      if (this.checkEvidenceTypeExists(type)) found++;
    }

    return found >= evidenceTypes.length * 0.5;
  }

  private checkEvidenceTypeExists(type: string): boolean {
    const typeToPath: Record<string, string[]> = {
      SOURCE_CODE: ["src/"],
      UNIT_TEST: ["src/**/*.test.ts", "src/**/*.spec.ts"],
      INTEGRATION_TEST: ["src/**/*.integration.test.ts", "tests/integration/"],
      SECURITY_TEST: ["tests/security/", "security.test.ts"],
      CONCURRENCY_TEST: ["tests/concurrency/", "concurrency.test.ts"],
      EXTERNAL_AUDIT: ["audit/", "reports/audit/"],
      DEPLOYMENT_RECORD: ["vercel.json", ".github/workflows/"],
      HEALTH_CHECK: ["src/routes/api/health/"],
      MONITORING_DATA: ["src/lib/otel-exporter.ts", "src/lib/latam-aegis-x.ts"],
      INCIDENT_REPORT: ["incidents/", "docs/incidents/"],
      ARCHITECTURE_DOCUMENT: ["docs/architecture/", "docs/ARCHITECTURE.md"],
      ADR: ["docs/adr/", "docs/architecture/decisions/"],
      DPIA: ["docs/privacy/", "DPIA.md"],
      DPA: ["docs/privacy/", "DPA.md"],
      PRIVACY_POLICY: ["PRIVACY.md", "docs/privacy/"],
      TEST_HITL: ["tests/hitl/", "hitl.test.ts"],
      POLICY_DOCUMENT: ["docs/policy/", "src/lib/policy/"],
      TEST_AUDIT_CHAIN: ["tests/audit/", "audit-chain.test.ts"],
      TEST_CONCURRENCY: ["tests/concurrency/"],
      WORM_CONFIG: ["src/lib/worm/", "worm.config.ts"],
      TEST_DATA_HANDLING: ["tests/privacy/", "data-handling.test.ts"],
      GIT_HISTORY: [".git/"],
      DESIGN_RECORDS: ["docs/design/", "DESIGN.md"],
      DATED_ARTIFACTS: ["docs/artifacts/", "CHANGELOG.md"],
    };

    const paths = typeToPath[type] ?? [];
    for (const p of paths) {
      if (this.pathExists(p)) return true;
    }
    return false;
  }

  private pathExists(pattern: string): boolean {
    const fullPath = path.join(this.config.rootDir, pattern.replace("**/", ""));
    try {
      if (fs.existsSync(fullPath)) return true;
      if (pattern.includes("*")) {
        const dir = path.dirname(fullPath);
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          const regex = pattern.replace("**/", "").replace("*", ".*");
          return files.some((f) => new RegExp(regex).test(f));
        }
      }
    } catch {
      /* intentional empty: skip unreadable files */
    }
    return false;
  }

  private checkClaimCode(claim: Claim): boolean {
    const claimKeywords: Record<string, string[]> = {
      "CLAIM-001": ["provenance", "git", "history"],
      "CLAIM-002": ["hitl", "approval", "human-in-the-loop"],
      "CLAIM-003": [
        "audit",
        "hash-chain",
        "tamper-evident",
        "verifyAuditChain",
        "verifyLedgerIntegrity",
      ],
      "CLAIM-004": ["privacy", "gdpr", "dpa", "dipa", "data-protection"],
      "CLAIM-005": ["atomic", "transaction", "ledger", "bookpi", "quotaBalance"],
      "CLAIM-006": ["DATABASE_URL", "postgresql", "authority", "repository-factory"],
      "CLAIM-007": ["sovereign", "transactional", "persistence", "sovereign-state-repository"],
      "CLAIM-008": ["kill-switch", "approval-store", "emergency"],
      "CLAIM-009": ["mfa", "step-up", "multi-factor"],
      "CLAIM-010": ["csp", "content-security-policy", "nonce"],
    };

    const keywords = claimKeywords[claim.id] ?? [];
    if (keywords.length === 0) return true;

    const files = this.collectCodeFiles();
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf8").toLowerCase();
        if (keywords.some((k) => content.includes(k.toLowerCase()))) {
          return true;
        }
      } catch {
        /* intentional empty: skip unreadable files */
      }
    }
    return false;
  }

  private checkClaimTests(_claim: Claim): boolean {
    const testPaths = ["src/tests/", "tests/", "**/*.test.ts", "**/*.spec.ts"];

    for (const testPath of testPaths) {
      if (this.pathExists(testPath)) return true;
    }
    return false;
  }

  private determineStatus(
    _claim: Claim,
    evidenceFound: boolean,
    codeImplemented: boolean,
    testsPassing: boolean,
  ): ClaimAnalysis["status"] {
    if (!evidenceFound && !codeImplemented) return "PLANNED";
    if (!codeImplemented) return "DESIGNED";
    if (!testsPassing) return "PARTIAL";
    if (!evidenceFound) return "IMPLEMENTED";
    return "TESTED";
  }

  private identifyGaps(
    _claim: Claim,
    evidenceFound: boolean,
    codeImplemented: boolean,
    testsPassing: boolean,
  ): string[] {
    const gaps: string[] = [];
    if (!evidenceFound) gaps.push("Evidencia requerida no encontrada");
    if (!codeImplemented) gaps.push("Implementación de código no detectada");
    if (!testsPassing) gaps.push("Pruebas automatizadas no encontradas o fallando");
    return gaps;
  }

  private scanPolicies(): PolicyAnalysis[] {
    const policies: PolicyAnalysis[] = [
      {
        id: "POL-001",
        title: "Zero Trust Tool Whitelist",
        implemented: false,
        location: "",
        tests: [],
      },
      {
        id: "POL-002",
        title: "Territorial Data Boundary",
        implemented: false,
        location: "",
        tests: [],
      },
      {
        id: "POL-003",
        title: "Human in the Loop Escalation",
        implemented: false,
        location: "",
        tests: [],
      },
      {
        id: "POL-004",
        title: "Ephemeral Token Lifecycle",
        implemented: false,
        location: "",
        tests: [],
      },
      {
        id: "POL-005",
        title: "Sovereignty Check",
        implemented: false,
        location: "",
        tests: [],
      },
    ];

    const policyKeywords: Record<string, string[]> = {
      "POL-001": ["whitelist", "tool.*whitelist", "zero.*trust"],
      "POL-002": ["territorial", "data.*boundary", "anonymiz"],
      "POL-003": ["hitl", "human.*in.*the.*loop", "escalation", "approval"],
      "POL-004": ["ephemeral", "token.*lifecycle", "token.*expir"],
      "POL-005": ["sovereignty", "soberan", "bias", "cultural"],
    };

    const files = this.collectCodeFiles();
    for (const policy of policies) {
      const keywords = policyKeywords[policy.id] ?? [];
      for (const file of files) {
        try {
          const content = fs.readFileSync(file, "utf8").toLowerCase();
          if (keywords.some((k) => content.includes(k.toLowerCase()))) {
            policy.implemented = true;
            policy.location = file;
            break;
          }
        } catch {
          /* intentional empty: skip unreadable files */
        }
      }
    }

    return policies;
  }

  private reconcileDocsCode(): DocsCodeReconciliation[] {
    const results: DocsCodeReconciliation[] = [];

    const docFiles = this.findDocFiles();
    for (const docFile of docFiles) {
      try {
        const docContent = fs.readFileSync(docFile, "utf8");
        const codeFiles = this.extractCodeReferences(docContent);

        for (const codeFile of codeFiles) {
          const fullCodePath = path.join(this.config.rootDir, codeFile);
          if (fs.existsSync(fullCodePath)) {
            const codeContent = fs.readFileSync(fullCodePath, "utf8");
            const match = this.compareDocCode(docContent, codeContent);
            results.push({
              docFile: path.relative(this.config.rootDir, docFile),
              codeFile: codeFile,
              match: match.match,
              discrepancies: match.discrepancies,
            });
          }
        }
      } catch {
        /* intentional empty: skip match errors */
      }
    }

    return results;
  }

  private findDocFiles(): string[] {
    const files: string[] = [];
    const docDirs = ["docs/", "README.md", "CHANGELOG.md", "CONTRIBUTING.md"];

    for (const dir of docDirs) {
      const fullPath = path.join(this.config.rootDir, dir);
      if (fs.existsSync(fullPath)) {
        if (fs.statSync(fullPath).isDirectory()) {
          const walk = (d: string) => {
            try {
              const entries = fs.readdirSync(d, { withFileTypes: true });
              for (const entry of entries) {
                const p = path.join(d, entry.name);
                if (entry.isDirectory()) walk(p);
                else if (entry.name.endsWith(".md")) files.push(p);
              }
            } catch {
              /* intentional empty: skip doc dirs */
            }
          };
          walk(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  private extractCodeReferences(docContent: string): string[] {
    const refs: string[] = [];
    const patterns = [
      /`([^`]+\.(ts|tsx|js|jsx|json|yaml|yml))`/g,
      /\[([^\]]+)\]\(([^)]+\.(ts|tsx|js|jsx|json|yaml|yml))\)/g,
      /src\/[\w/]+\.(ts|tsx|js|jsx)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(docContent)) !== null) {
        const ref = match[1] ?? match[2];
        if (ref && ref.includes(".")) refs.push(ref);
      }
    }

    return [...new Set(refs)];
  }

  private compareDocCode(
    docContent: string,
    codeContent: string,
  ): { match: boolean; discrepancies: string[] } {
    const discrepancies: string[] = [];

    const docFunctions = this.extractFunctions(docContent);
    const codeFunctions = this.extractFunctions(codeContent);

    for (const fn of docFunctions) {
      if (!codeFunctions.includes(fn)) {
        discrepancies.push(`Función documentada pero no implementada: ${fn}`);
      }
    }

    return { match: discrepancies.length === 0, discrepancies };
  }

  private extractFunctions(content: string): string[] {
    const fns: string[] = [];
    const patterns = [
      /export\s+(?:async\s+)?function\s+(\w+)/g, // eslint-disable-line security/detect-unsafe-regex -- bounded identifier extraction
      /export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(/g, // eslint-disable-line security/detect-unsafe-regex -- bounded identifier extraction
      /class\s+(\w+)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        fns.push(match[1]);
      }
    }

    return fns;
  }

  private generateFindings(
    claims: ClaimAnalysis[],
    policies: PolicyAnalysis[],
    docsCode: DocsCodeReconciliation[],
  ): GovernanceFinding[] {
    const findings: GovernanceFinding[] = [];

    for (const claim of claims) {
      if (!claim.evidenceFound) {
        findings.push({
          id: `GOV-CLAIM-NO-EVID-${claim.claim.id}-${Date.now().toString(36)}`,
          type: "CLAIM_WITHOUT_EVIDENCE",
          severity: claim.claim.requiredStatus === "PRODUCTION-VERIFIED" ? "CRITICAL" : "HIGH",
          description: `Claim ${claim.claim.id} (${claim.claim.title}) sin evidencia suficiente`,
          location: "docs/governance/",
          remediation: `Generar evidencia: ${claim.claim.evidenceRequired.join(", ")}`,
        });
      }

      if (!claim.codeImplemented) {
        findings.push({
          id: `GOV-CLAIM-NO-CODE-${claim.claim.id}-${Date.now().toString(36)}`,
          type: "CLAIM_WITHOUT_CODE",
          severity: "HIGH",
          description: `Claim ${claim.claim.id} sin implementación de código detectada`,
          location: "src/",
          remediation: "Implementar código que cumpla el claim",
        });
      }

      if (!claim.testsPassing) {
        findings.push({
          id: `GOV-CLAIM-NO-TESTS-${claim.claim.id}-${Date.now().toString(36)}`,
          type: "CLAIM_WITHOUT_TESTS",
          severity: "HIGH",
          description: `Claim ${claim.claim.id} sin tests automatizados pasando`,
          location: "src/tests/",
          remediation: "Añadir tests unitarios, de integración y de seguridad",
        });
      }

      if (claim.status !== claim.claim.requiredStatus) {
        const statusOrder = [
          "PLANNED",
          "DESIGNED",
          "PARTIAL",
          "IMPLEMENTED",
          "TESTED",
          "VERIFIED",
          "PRODUCTION-VERIFIED",
        ];
        const currentIdx = statusOrder.indexOf(claim.status);
        const requiredIdx = statusOrder.indexOf(claim.claim.requiredStatus);

        if (currentIdx > requiredIdx) {
          findings.push({
            id: `GOV-STATUS-INFLATED-${claim.claim.id}-${Date.now().toString(36)}`,
            type: "STATUS_INFLATED",
            severity: "CRITICAL",
            description: `Claim ${claim.claim.id} reporta estado ${claim.status} pero requiere ${claim.claim.requiredStatus}`,
            location: "docs/governance/",
            remediation: "Corregir estado del claim o implementar requisitos faltantes",
          });
        }
      }
    }

    for (const policy of policies) {
      if (!policy.implemented) {
        findings.push({
          id: `GOV-POLICY-NOT-IMPL-${policy.id}-${Date.now().toString(36)}`,
          type: "POLICY_NOT_IMPLEMENTED",
          severity: "HIGH",
          description: `Política ${policy.id} (${policy.title}) no implementada`,
          location: "src/lib/",
          remediation: "Implementar política en código",
        });
      }
    }

    for (const reconciliation of docsCode) {
      if (!reconciliation.match) {
        findings.push({
          id: `GOV-DOCS-MISMATCH-${Date.now().toString(36)}`,
          type: "DOCS_CODE_MISMATCH",
          severity: "MEDIUM",
          description: `Documentación y código no coinciden: ${reconciliation.docFile} vs ${reconciliation.codeFile}`,
          location: reconciliation.docFile,
          remediation: `Corregir discrepancias: ${reconciliation.discrepancies.join("; ")}`,
        });
      }
    }

    return findings;
  }

  private collectCodeFiles(): string[] {
    const files: string[] = [];
    const includePatterns = ["**/*.ts", "**/*.tsx"];
    const excludePatterns = [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/coverage/**",
      "**/genesis/**",
      "**/*.test.ts",
      "**/*.spec.ts",
    ];

    const walk = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(this.config.rootDir, fullPath);

          const excluded = excludePatterns.some((p) => this.matchPattern(relativePath, p));
          if (excluded) continue;

          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            const included = includePatterns.some((p) => this.matchPattern(relativePath, p));
            if (included) files.push(fullPath);
          }
        }
      } catch {
        /* intentional empty: skip inaccessible dirs */
      }
    };

    walk(this.config.rootDir);
    return files;
  }

  private matchPattern(filePath: string, pattern: string): boolean {
    const regexPattern = pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }
}

export function createGovernanceScanner(config?: GovernanceScannerConfig): GovernanceScanner {
  return new GovernanceScanner(config);
}
