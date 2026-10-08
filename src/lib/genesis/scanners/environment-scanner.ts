import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { EnvironmentFinding } from "../schemas/environment.schema";

export interface EnvScannerConfig {
  rootDir?: string;
  schemaPath?: string;
  examplePath?: string;
}

export interface EnvScanResult {
  variables: EnvVariable[];
  findings: EnvironmentFinding[];
  statistics: {
    totalInSchema: number;
    totalInExample: number;
    totalInCode: number;
    totalInCI: number;
    consistent: number;
    inconsistent: number;
    orphans: number;
    stale: number;
    missingRequired: number;
  };
}

export interface EnvVariable {
  name: string;
  inSchema: boolean;
  inExample: boolean;
  inCode: boolean;
  inCI: boolean;
  inProduction: boolean;
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
  codeLocations: CodeLocation[];
}

export interface CodeLocation {
  file: string;
  line: number;
  context: string;
}

z.object({
  $schema: z.string().optional(),
  env: z.record(
    z.object({
      type: z.enum(["string", "number", "boolean", "json"]).default("string"),
      required: z.boolean().default(false),
      default: z.unknown().optional(),
      description: z.string().optional(),
      sensitive: z.boolean().default(false),
      runtime: z.enum(["client", "server", "both"]).default("server"),
    }),
  ),
});

export class EnvironmentScanner {
  private config: Required<EnvScannerConfig>;

  constructor(config: EnvScannerConfig = {}) {
    this.config = {
      rootDir: config.rootDir ?? process.cwd(),
      schemaPath: config.schemaPath ?? path.join(process.cwd(), "src/lib/env-schema.ts"),
      examplePath: config.examplePath ?? path.join(process.cwd(), ".env.example"),
    };
  }

  scan(): EnvScanResult {
    const schemaVars = this.parseSchema();
    const exampleVars = this.parseExample();
    const codeVars = this.parseCodeUsage();
    const ciVars = this.parseCIConfig();
    const prodVars = this.parseProductionEnv();

    const allNames = new Set([
      ...schemaVars.keys(),
      ...exampleVars.keys(),
      ...codeVars.keys(),
      ...ciVars.keys(),
      ...prodVars.keys(),
    ]);

    const variables: EnvVariable[] = [];
    const findings: EnvironmentFinding[] = [];

    for (const name of allNames) {
      const schemaEntry = schemaVars.get(name);
      const defaultRaw = schemaEntry?.default;
      const defaultValue: string | undefined =
        typeof defaultRaw === "string" ||
        typeof defaultRaw === "number" ||
        typeof defaultRaw === "boolean"
          ? String(defaultRaw)
          : undefined;
      const variable: EnvVariable = {
        name,
        inSchema: schemaVars.has(name),
        inExample: exampleVars.has(name),
        inCode: codeVars.has(name),
        inCI: ciVars.has(name),
        inProduction: prodVars.has(name),
        type: schemaEntry?.type ?? "string",
        required: schemaEntry?.required ?? false,
        defaultValue,
        description: schemaEntry?.description,
        codeLocations: codeVars.get(name) ?? [],
      };
      variables.push(variable);
    }

    for (const variable of variables) {
      this.checkVariable(variable, findings);
    }

    const stats = this.calculateStatistics(variables);

    return { variables, findings, statistics: stats };
  }

  private parseSchema(): Map<
    string,
    { type: string; required: boolean; default?: unknown; description?: string }
  > {
    const result = new Map();

    try {
      const content = fs.readFileSync(this.config.schemaPath, "utf8");

      const exportMatch = content.match(/export\s+const\s+\w+\s*=\s*({[\s\S]*?})\s*;/);
      if (exportMatch) {
        try {
          const normalizedSchema = exportMatch[1]
            .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
            .replace(/'([^']*)'/g, '"$1"');
          const schemaObj: unknown = JSON.parse(normalizedSchema);
          if (schemaObj && typeof schemaObj === "object") {
            for (const [key, value] of Object.entries(schemaObj)) {
              if (value && typeof value === "object") {
                const v = value as Record<string, unknown>;
                result.set(key, {
                  type: (v.type as string) ?? "string",
                  required: v.required === true,
                  default: v.default,
                  description: v.description as string,
                });
              }
            }
          }
        } catch {
          /* intentional empty: skip parse errors */
        }
      }
    } catch {
      /* intentional empty: skip schema read errors */
    }

    return result;
  }

  private parseExample(): Map<string, { value: string; description?: string }> {
    const result = new Map();

    try {
      const content = fs.readFileSync(this.config.examplePath, "utf8");
      const lines = content.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const name = trimmed.slice(0, eqIndex).trim();
          const value = trimmed.slice(eqIndex + 1).trim();
          result.set(name, { value });
        }
      }
    } catch {
      /* intentional empty: skip example parse errors */
    }

    return result;
  }

  private parseCodeUsage(): Map<string, CodeLocation[]> {
    const result = new Map<string, CodeLocation[]>();

    const files = this.collectFiles(this.config.rootDir, ["**/*.ts", "**/*.tsx"]);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf8");
        const relativePath = path.relative(this.config.rootDir, file);
        const lines = content.split("\n");

        const patterns = [
          /process\.env\.(\w+)/g,
          /config\(\)\.(\w+)/g,
          /config\(\)\[(\w+)\]/g,
          /import\.meta\.env\.(\w+)/g,
        ];

        for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const varName = match[1];
            const lineIndex = content.substring(0, match.index).split("\n").length - 1;
            const context = lines[lineIndex]?.trim().slice(0, 200) ?? "";

            const existing = result.get(varName) ?? [];
            existing.push({ file: relativePath, line: lineIndex + 1, context });
            result.set(varName, existing);
          }
        }
      } catch {
        /* intentional empty: skip file read errors */
      }
    }

    return result;
  }

  private parseCIConfig(): Map<string, { source: string }> {
    const result = new Map<string, { source: string }>();

    const ciDirs = [
      path.join(this.config.rootDir, ".github", "workflows"),
      path.join(this.config.rootDir, ".gitlab", "ci"),
    ];

    for (const ciDir of ciDirs) {
      if (!fs.existsSync(ciDir)) continue;

      const files = fs.readdirSync(ciDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(ciDir, file), "utf8");
          const envMatches = content.match(/(\w+):\s*\$\{\{\s*secrets\.(\w+)\s*\}\}/g) ?? [];

          for (const match of envMatches) {
            const secretMatch = match.match(/secrets\.(\w+)/);
            if (secretMatch) {
              result.set(secretMatch[1], { source: file });
            }
          }
        } catch {
          /* intentional empty: skip match errors */
        }
      }
    }

    return result;
  }

  private parseProductionEnv(): Map<string, { source: string }> {
    const result = new Map<string, { source: string }>();

    const vercelPath = path.join(this.config.rootDir, "vercel.json");
    if (fs.existsSync(vercelPath)) {
      try {
        const content = fs.readFileSync(vercelPath, "utf8");
        const parsed = JSON.parse(content);
        if (parsed.env) {
          for (const [key, _value] of Object.entries(parsed.env)) {
            result.set(key, { source: "vercel.json" });
          }
        }
      } catch {
        /* intentional empty: skip vercel.json parse errors */
      }
    }

    return result;
  }

  private checkVariable(variable: EnvVariable, findings: EnvironmentFinding[]): void {
    if (variable.inCode && !variable.inSchema) {
      findings.push({
        findingId: `ENV-ORPHAN-${variable.name}`,
        type: "ORPHAN_VARIABLE",
        variable_name: variable.name,
        severity: "HIGH",
        details: {
          expected_in: ["env-schema.ts"],
          found_in: ["code"],
          code_locations: variable.codeLocations,
        },
        remediation: `Add ${variable.name} to env-schema.ts with type and required fields`,
      });
    }

    if (variable.inSchema && !variable.inCode && !variable.required) {
      findings.push({
        findingId: `ENV-STALE-${variable.name}`,
        type: "STALE_VARIABLE",
        variable_name: variable.name,
        severity: "LOW",
        details: {
          expected_in: ["code"],
          found_in: ["env-schema.ts"],
        },
        remediation: `Remove ${variable.name} from env-schema.ts or add usage in code`,
      });
    }

    if (variable.required && !variable.inExample) {
      findings.push({
        findingId: `ENV-MISSING-EXAMPLE-${variable.name}`,
        type: "REQUIRED_NOT_MARKED",
        variable_name: variable.name,
        severity: "HIGH",
        details: {
          expected_in: [".env.example"],
          found_in: ["env-schema.ts"],
        },
        remediation: `Add ${variable.name} to .env.example with placeholder value`,
      });
    }

    if (variable.required && !variable.inProduction && variable.inCode) {
      findings.push({
        findingId: `ENV-MISSING-PROD-${variable.name}`,
        type: "PRODUCTION_MISSING",
        variable_name: variable.name,
        severity: "CRITICAL",
        details: {
          expected_in: ["vercel.json", "production environment"],
          found_in: ["code", "env-schema.ts"],
          code_locations: variable.codeLocations,
        },
        remediation: `Configure ${variable.name} in production environment (Vercel dashboard)`,
      });
    }

    if (variable.inSchema && variable.inExample) {
      const schemaEntry = this.parseSchema().get(variable.name);
      const exampleEntry = this.parseExample().get(variable.name);
      if (schemaEntry && exampleEntry && schemaEntry.type !== "string") {
        findings.push({
          findingId: `ENV-TYPE-MISMATCH-${variable.name}`,
          type: "TYPE_MISMATCH",
          variable_name: variable.name,
          severity: "MEDIUM",
          details: {
            expected_in: ["env-schema.ts"],
            found_in: [".env.example"],
            expected_type: schemaEntry.type,
            actual_type: "string",
          },
          remediation: `Ensure example value matches schema type ${schemaEntry.type}`,
        });
      }
    }
  }

  private calculateStatistics(variables: EnvVariable[]): EnvScanResult["statistics"] {
    let inSchema = 0,
      inExample = 0,
      inCode = 0,
      inCI = 0;
    let consistent = 0,
      inconsistent = 0,
      orphans = 0,
      stale = 0,
      missingRequired = 0;

    for (const v of variables) {
      if (v.inSchema) inSchema++;
      if (v.inExample) inExample++;
      if (v.inCode) inCode++;
      if (v.inCI) inCI++;

      const sources = [v.inSchema, v.inExample, v.inCode, v.inCI].filter(Boolean).length;
      if (sources === 4) consistent++;
      else if (sources > 1) inconsistent++;

      if (v.inCode && !v.inSchema) orphans++;
      if (v.inSchema && !v.inCode && !v.required) stale++;
      if (v.required && !v.inExample) missingRequired++;
    }

    return {
      totalInSchema: inSchema,
      totalInExample: inExample,
      totalInCode: inCode,
      totalInCI: inCI,
      consistent,
      inconsistent,
      orphans,
      stale,
      missingRequired,
    };
  }

  private collectFiles(dir: string, patterns: string[]): string[] {
    const files: string[] = [];
    const excludePatterns = [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/coverage/**",
      "**/genesis/**",
    ];

    const walk = (currentDir: string): void => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          const relativePath = path.relative(this.config.rootDir, fullPath);

          const excluded = excludePatterns.some((p) => this.matchPattern(relativePath, p));
          if (excluded) continue;

          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            const included = patterns.some((p) => this.matchPattern(relativePath, p));
            if (included) files.push(fullPath);
          }
        }
      } catch {
        /* intentional empty: skip vercel.json parse errors */
      }
    };

    walk(dir);
    return files;
  }

  private matchPattern(filePath: string, pattern: string): boolean {
    const regexPattern = pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }
}

export function createEnvironmentScanner(config?: EnvScannerConfig): EnvironmentScanner {
  return new EnvironmentScanner(config);
}
