import * as fs from "node:fs";
import * as path from "node:path";

export interface CIScannerConfig {
  rootDir?: string;
}

export interface CIScanResult {
  workflows: WorkflowAnalysis[];
  gates: GateAnalysis[];
  artifacts: ArtifactAnalysis[];
  findings: CIFinding[];
  statistics: {
    totalWorkflows: number;
    totalJobs: number;
    gatesImplemented: number;
    gatesMissing: number;
    artifactIntegrity: boolean;
  };
}

export interface WorkflowAnalysis {
  file: string;
  name: string;
  triggers: string[];
  jobs: JobAnalysis[];
  permissions: string[];
  secretsUsed: string[];
}

export interface JobAnalysis {
  id: string;
  name: string;
  runsOn: string[];
  steps: StepAnalysis[];
  needs: string[];
  ifCondition?: string;
  timeoutMinutes?: number;
}

export interface StepAnalysis {
  name: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  continueOnError?: boolean;
}

export interface GateAnalysis {
  gate: string;
  implemented: boolean;
  workflow: string;
  job: string;
  step?: string;
  description: string;
}

export interface ArtifactAnalysis {
  type: string;
  generated: boolean;
  verified: boolean;
  location: string;
}

export interface CIFinding {
  id: string;
  type:
    | "MISSING_GATE"
    | "NODE_VERSION_MISMATCH"
    | "SECRET_IN_WORKFLOW"
    | "MISSING_ARTIFACT_VERIFICATION"
    | "INSUFFICIENT_PERMISSIONS"
    | "NO_SBOM"
    | "NO_DEPENDENCY_SCAN"
    | "RELEASE_GATE_INCOMPLETE"
    | "RUNTIME_CI_MISMATCH";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  location: string;
  remediation: string;
}

const REQUIRED_GATES = {
  preCommit: ["secret_scan", "lint", "typecheck"],
  preMerge: ["build", "unit_test", "integration_test", "security_scan"],
  preRelease: [
    "build",
    "unit_test",
    "integration_test",
    "security_test",
    "concurrency_test",
    "e2e_test",
    "performance_test",
    "security_audit",
    "dependency_scan",
    "sbom_generation",
  ],
  postRelease: ["health_check", "smoke_test", "monitoring_verification"],
};

export class CIScanner {
  private config: Required<CIScannerConfig>;

  constructor(config: CIScannerConfig = {}) {
    this.config = {
      rootDir: config.rootDir ?? process.cwd(),
    };
  }

  scan(): CIScanResult {
    const workflows = this.scanWorkflows();
    const gates = this.analyzeGates(workflows);
    const artifacts = this.analyzeArtifacts();
    const findings = this.generateFindings(workflows, gates, artifacts);

    return {
      workflows,
      gates,
      artifacts,
      findings,
      statistics: {
        totalWorkflows: workflows.length,
        totalJobs: workflows.reduce((sum, w) => sum + w.jobs.length, 0),
        gatesImplemented: gates.filter((g) => g.implemented).length,
        gatesMissing: gates.filter((g) => !g.implemented).length,
        artifactIntegrity: artifacts.every((a) => a.verified),
      },
    };
  }

  private scanWorkflows(): WorkflowAnalysis[] {
    const workflows: WorkflowAnalysis[] = [];
    const workflowsDir = path.join(this.config.rootDir, ".github", "workflows");

    if (!fs.existsSync(workflowsDir)) return workflows;

    const files = fs
      .readdirSync(workflowsDir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(workflowsDir, file), "utf8");
        const workflow = this.parseWorkflow(file, content);
        workflows.push(workflow);
      } catch {
        /* intentional empty: skip unreadable workflows */
      }
    }

    return workflows;
  }

  private parseWorkflow(file: string, content: string): WorkflowAnalysis {
    const lines = content.split("\n");
    let name = "";
    const triggers: string[] = [];
    const jobs: JobAnalysis[] = [];
    const permissions: string[] = [];
    const secretsUsed: string[] = [];

    let inJobs = false;
    let currentJob: JobAnalysis | null = null;
    let inSteps = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("name:")) {
        name = line
          .replace("name:", "")
          .trim()
          .replace(/^["']|["']$/g, "");
      }

      if (line.startsWith("on:")) {
        let j = i + 1;
        while (j < lines.length && (lines[j].startsWith("  ") || lines[j].startsWith("\t"))) {
          const triggerLine = lines[j].trim();
          if (triggerLine && !triggerLine.startsWith("#")) {
            triggers.push(triggerLine.replace(/-/, "").trim());
          }
          j++;
        }
      }

      if (line.startsWith("permissions:")) {
        let j = i + 1;
        while (j < lines.length && (lines[j].startsWith("  ") || lines[j].startsWith("\t"))) {
          const permLine = lines[j].trim();
          if (permLine && !permLine.startsWith("#")) {
            permissions.push(permLine);
          }
          j++;
        }
      }

      if (line === "jobs:") {
        inJobs = true;
        continue;
      }

      if (inJobs && line && !line.startsWith(" ") && !line.startsWith("\t")) {
        inJobs = false;
      }

      if (inJobs) {
        const jobMatch = line.match(/^(\w+):$/);
        if (jobMatch) {
          if (currentJob) jobs.push(currentJob);
          currentJob = {
            id: jobMatch[1],
            name: jobMatch[1],
            runsOn: [],
            steps: [],
            needs: [],
          };
          inSteps = false;
          continue;
        }

        if (currentJob) {
          if (line.startsWith("runs-on:")) {
            const runsOn = line.replace("runs-on:", "").trim();
            currentJob.runsOn = runsOn.startsWith("[")
              ? JSON.parse(runsOn)
              : [runsOn.replace(/^["']|["']$/g, "")];
          } else if (line.startsWith("needs:")) {
            const needs = line.replace("needs:", "").trim();
            currentJob.needs = needs.startsWith("[")
              ? JSON.parse(needs)
              : [needs.replace(/^["']|["']$/g, "")];
          } else if (line.startsWith("if:")) {
            currentJob.ifCondition = line.replace("if:", "").trim();
          } else if (line.startsWith("timeout-minutes:")) {
            currentJob.timeoutMinutes = parseInt(line.replace("timeout-minutes:", "").trim(), 10);
          } else if (line.trim() === "steps:") {
            inSteps = true;
            continue;
          } else if (inSteps && line.startsWith("- ")) {
            const step = this.parseStep(lines, i);
            if (step) {
              currentJob.steps.push(step.step);
              i = step.nextIndex;
            }
          }
        }
      }

      const secretMatches = content.match(/\$\{\{\s*secrets\.(\w+)\s*\}\}/g) ?? [];
      for (const match of secretMatches) {
        const secret = match.match(/secrets\.(\w+)/);
        if (secret) secretsUsed.push(secret[1]);
      }
    }

    if (currentJob) jobs.push(currentJob);

    return { file, name, triggers, jobs, permissions, secretsUsed };
  }

  private parseStep(
    lines: string[],
    startIndex: number,
  ): { step: StepAnalysis; nextIndex: number } | null {
    let i = startIndex;
    const step: StepAnalysis = { name: "", continueOnError: false };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith("name:")) {
        step.name = trimmed
          .replace("name:", "")
          .trim()
          .replace(/^["']|["']$/g, "");
      } else if (trimmed.startsWith("uses:")) {
        step.uses = trimmed
          .replace("uses:", "")
          .trim()
          .replace(/^["']|["']$/g, "");
      } else if (trimmed.startsWith("run:")) {
        let runContent = trimmed.replace("run:", "").trim();
        let j = i + 1;
        while (j < lines.length && (lines[j].startsWith("      ") || lines[j].startsWith("\t\t"))) {
          runContent += "\n" + lines[j].trim();
          j++;
        }
        step.run = runContent;
        i = j - 1;
      } else if (trimmed.startsWith("env:")) {
        step.env = {};
        let j = i + 1;
        while (j < lines.length && (lines[j].startsWith("      ") || lines[j].startsWith("\t\t"))) {
          const envLine = lines[j].trim();
          const eqIndex = envLine.indexOf(":");
          if (eqIndex > 0) {
            const key = envLine.slice(0, eqIndex).trim();
            const value = envLine
              .slice(eqIndex + 1)
              .trim()
              .replace(/^["']|["']$/g, "");
            step.env![key] = value;
          }
          j++;
        }
        i = j - 1;
      } else if (trimmed.startsWith("continue-on-error:")) {
        step.continueOnError = trimmed.replace("continue-on-error:", "").trim() === "true";
      } else if (
        trimmed &&
        !trimmed.startsWith(" ") &&
        !trimmed.startsWith("\t") &&
        !trimmed.startsWith("-")
      ) {
        return { step, nextIndex: i - 1 };
      }

      i++;
      if (i >= lines.length) break;
    }

    return { step, nextIndex: i };
  }

  private analyzeGates(workflows: WorkflowAnalysis[]): GateAnalysis[] {
    const gates: GateAnalysis[] = [];

    for (const [phase, required] of Object.entries(REQUIRED_GATES)) {
      for (const gate of required) {
        let implemented = false;
        let workflow = "";
        let job = "";
        let step = "";

        for (const wf of workflows) {
          for (const j of wf.jobs) {
            for (const s of j.steps) {
              const stepText = `${s.name} ${s.uses ?? ""} ${s.run ?? ""}`.toLowerCase();
              if (this.gateMatches(gate, stepText)) {
                implemented = true;
                workflow = wf.file;
                job = j.id;
                step = s.name;
                break;
              }
            }
            if (implemented) break;
          }
          if (implemented) break;
        }

        gates.push({
          gate: `${phase}.${gate}`,
          implemented,
          workflow,
          job,
          step,
          description: `Gate ${gate} en fase ${phase}`,
        });
      }
    }

    return gates;
  }

  private gateMatches(gate: string, stepText: string): boolean {
    const gatePatterns: Record<string, string[]> = {
      secret_scan: ["trufflehog", "secret", "gitleaks", "detect-secrets"],
      lint: ["lint", "eslint", "biome"],
      typecheck: ["typecheck", "tsc", "ts-check"],
      build: ["build", "vite build", "next build"],
      unit_test: ["test", "vitest", "jest", "unit"],
      integration_test: ["integration", "e2e", "playwright", "cypress"],
      security_scan: ["security", "audit", "snyk", "trivy", "codeql"],
      security_test: ["security", "penetration", "owasp", "zap"],
      concurrency_test: ["concurrency", "race", "parallel"],
      e2e_test: ["e2e", "end-to-end", "playwright", "cypress"],
      performance_test: ["performance", "load", "k6", "artillery"],
      security_audit: ["audit", "security-audit"],
      dependency_scan: ["dependency", "dependabot", "snyk", "npm audit"],
      sbom_generation: ["sbom", "cyclonedx", "spdx", "syft"],
      health_check: ["health", "healthcheck"],
      smoke_test: ["smoke", "smoke-test"],
      monitoring_verification: ["monitoring", "observability", "otel"],
    };

    const patterns = gatePatterns[gate] ?? [gate];
    return patterns.some((p) => stepText.includes(p.toLowerCase()));
  }

  private analyzeArtifacts(): ArtifactAnalysis[] {
    return [
      { type: "SBOM", generated: false, verified: false, location: "" },
      { type: "Docker Image", generated: false, verified: false, location: "" },
      {
        type: "Build Artifacts",
        generated: false,
        verified: false,
        location: "",
      },
      { type: "Test Results", generated: false, verified: false, location: "" },
      {
        type: "Security Report",
        generated: false,
        verified: false,
        location: "",
      },
    ];
  }

  private generateFindings(
    workflows: WorkflowAnalysis[],
    gates: GateAnalysis[],
    artifacts: ArtifactAnalysis[],
  ): CIFinding[] {
    const findings: CIFinding[] = [];

    const missingGates = gates.filter((g) => !g.implemented);
    for (const gate of missingGates) {
      findings.push({
        id: `CI-MISSING-${gate.gate.replace(".", "-")}-${Date.now().toString(36)}`,
        type: "MISSING_GATE",
        severity: gate.gate.startsWith("preRelease")
          ? "CRITICAL"
          : gate.gate.startsWith("preMerge")
            ? "HIGH"
            : "MEDIUM",
        description: `Gate requerido no implementado: ${gate.gate}`,
        location: `.github/workflows/`,
        remediation: `Añadir job/step para ${gate.gate} en workflow apropiado`,
      });
    }

    const packageJsonPath = path.join(this.config.rootDir, "package.json");
    let requiredNodeVersion = "";
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (pkg.engines?.node) {
        requiredNodeVersion = pkg.engines.node;
      }
    }

    for (const wf of workflows) {
      for (const job of wf.jobs) {
        for (const runsOn of job.runsOn) {
          const versions = runsOn.split(/[,\s]+/).filter((v) => v.match(/^\d+$/));
          for (const version of versions) {
            if (requiredNodeVersion && !requiredNodeVersion.includes(version)) {
              findings.push({
                id: `CI-NODE-MISMATCH-${Date.now().toString(36)}`,
                type: "NODE_VERSION_MISMATCH",
                severity: "HIGH",
                description: `CI usa Node ${version} pero package.json requiere ${requiredNodeVersion}`,
                location: `.github/workflows/${wf.file}`,
                remediation: `Actualizar matrix node-version en CI para coincidir con engines.node en package.json`,
              });
            }
          }
        }
      }
    }

    for (const wf of workflows) {
      for (const secret of wf.secretsUsed) {
        if (
          secret.toLowerCase().includes("key") ||
          secret.toLowerCase().includes("secret") ||
          secret.toLowerCase().includes("token")
        ) {
          findings.push({
            id: `CI-SECRET-IN-WF-${secret}-${Date.now().toString(36)}`,
            type: "SECRET_IN_WORKFLOW",
            severity: "MEDIUM",
            description: `Secreto referenciado en workflow: ${secret}`,
            location: `.github/workflows/${wf.file}`,
            remediation:
              "Asegurar que los secretos solo se usan en jobs necesarios y no se loguean",
          });
        }
      }
    }

    if (!artifacts.some((a) => a.type === "SBOM" && a.generated)) {
      findings.push({
        id: `CI-NO-SBOM-${Date.now().toString(36)}`,
        type: "NO_SBOM",
        severity: "HIGH",
        description: "No se genera SBOM en pipeline",
        location: ".github/workflows/",
        remediation: "Añadir step de syft/cyclonedx para generar SBOM en preRelease",
      });
    }

    if (!artifacts.some((a) => a.type === "Security Report" && a.generated)) {
      findings.push({
        id: `CI-NO-SECURITY-REPORT-${Date.now().toString(36)}`,
        type: "NO_DEPENDENCY_SCAN",
        severity: "HIGH",
        description: "No se genera reporte de seguridad/dependencias",
        location: ".github/workflows/",
        remediation: "Añadir npm audit, snyk o trivy en preRelease",
      });
    }

    const preReleaseGates = gates.filter((g) => g.gate.startsWith("preRelease"));
    const missingPreRelease = preReleaseGates.filter((g) => !g.implemented);
    if (missingPreRelease.length > 0) {
      findings.push({
        id: `CI-RELEASE-INCOMPLETE-${Date.now().toString(36)}`,
        type: "RELEASE_GATE_INCOMPLETE",
        severity: "CRITICAL",
        description: `Release gate incompleto: faltan ${missingPreRelease.map((g) => g.gate).join(", ")}`,
        location: ".github/workflows/",
        remediation: "Implementar todos los gates de preRelease requeridos por la política",
      });
    }

    return findings;
  }
}

export function createCIScanner(config?: CIScannerConfig): CIScanner {
  return new CIScanner(config);
}
