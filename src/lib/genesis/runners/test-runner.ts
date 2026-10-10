import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

export interface TestRunnerConfig {
  rootDir?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
}

export interface TestDiscoveryResult {
  testFiles: TestFile[];
  totalTests: number;
  byCategory: Record<string, number>;
}

export interface TestFile {
  file: string;
  category: "unit" | "integration" | "security" | "concurrency" | "e2e" | "performance";
  framework: "vitest" | "jest" | "playwright" | "cypress" | "k6" | "unknown";
  tests: TestCase[];
}

export interface TestCase {
  name: string;
  line: number;
  async: boolean;
}

export interface TestExecutionResult {
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
  };
  coverage?: CoverageReport;
  outputs: TestOutput[];
}

export interface TestResult {
  file: string;
  testName: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  category: string;
}

export interface TestOutput {
  file: string;
  testName: string;
  stdout: string;
  stderr: string;
  hash: string;
}

export interface CoverageReport {
  lines: { total: number; covered: number; percentage: number };
  functions: { total: number; covered: number; percentage: number };
  branches: { total: number; covered: number; percentage: number };
  statements: { total: number; covered: number; percentage: number };
}

export interface ConcurrencyTestConfig {
  name: string;
  description: string;
  setup: () => Promise<void>;
  execute: () => Promise<ConcurrencyTestResult>;
  teardown: () => Promise<void>;
  expectedResult: string;
  timeoutMs: number;
}

export interface ConcurrencyTestResult {
  passed: boolean;
  actualResult: string;
  expectedResult: string;
  metrics: {
    operationsCompleted: number;
    operationsFailed: number;
    lostUpdates: number;
    duplicateUpdates: number;
    deadlocks: number;
    timeouts: number;
    durationMs: number;
  };
}

export class TestDiscovery {
  private config: Required<TestRunnerConfig>;

  constructor(config: TestRunnerConfig = {}) {
    this.config = {
      rootDir: config.rootDir ?? process.cwd(),
      timeoutMs: config.timeoutMs ?? 120000,
      maxConcurrency: config.maxConcurrency ?? 4,
    };
  }

  discover(): TestDiscoveryResult {
    const testFiles: TestFile[] = [];
    const files = this.collectTestFiles(this.config.rootDir);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf8");
        const testFile = this.analyzeTestFile(file, content);
        testFiles.push(testFile);
      } catch {
        /* intentional empty: skip unreadable files */
      }
    }

    const byCategory: Record<string, number> = {};
    for (const tf of testFiles) {
      byCategory[tf.category] = (byCategory[tf.category] ?? 0) + tf.tests.length;
    }

    return {
      testFiles,
      totalTests: testFiles.reduce((sum, tf) => sum + tf.tests.length, 0),
      byCategory,
    };
  }

  private collectTestFiles(dir: string): string[] {
    const files: string[] = [];
    const patterns = ["**/*.test.ts", "**/*.spec.ts", "**/*.test.tsx", "**/*.spec.tsx"];
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
        /* intentional empty: skip inaccessible dirs */
      }
    };

    walk(dir);
    return files;
  }

  private analyzeTestFile(file: string, content: string): TestFile {
    const relativePath = path.relative(this.config.rootDir, file);
    const lines = content.split("\n");

    let category: TestFile["category"] = "unit";
    let framework: TestFile["framework"] = "unknown";

    if (content.includes("playwright") || content.includes("@playwright/test")) {
      framework = "playwright";
      category = "e2e";
    } else if (content.includes("cypress")) {
      framework = "cypress";
      category = "e2e";
    } else if (content.includes("k6")) {
      framework = "k6";
      category = "performance";
    } else if (
      content.includes("vitest") ||
      content.includes("vi.test") ||
      content.includes("describe(") ||
      content.includes("it(")
    ) {
      framework = "vitest";
      if (relativePath.includes("integration") || content.includes("integration"))
        category = "integration";
      else if (relativePath.includes("security") || content.includes("security"))
        category = "security";
      else if (relativePath.includes("concurrency") || content.includes("concurrency"))
        category = "concurrency";
      else if (relativePath.includes("performance") || content.includes("performance"))
        category = "performance";
    } else if (content.includes("jest") || content.includes("test(")) {
      framework = "jest";
    }

    const tests: TestCase[] = [];
    const testPatterns = [
      /(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      /(?:it|test)\.only\s*\(\s*['"`]([^'"`]+)['"`]/g,
    ];

    for (const pattern of testPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineIndex = content.substring(0, match.index).split("\n").length - 1;
        const lineContent = lines[lineIndex] ?? "";
        tests.push({
          name: match[1],
          line: lineIndex + 1,
          async: lineContent.includes("async"),
        });
      }
    }

    return { file: relativePath, category, framework, tests };
  }

  private matchPattern(filePath: string, pattern: string): boolean {
    const regexPattern = pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }
}

export class TestExecutor {
  private config: Required<TestRunnerConfig>;

  constructor(config: TestRunnerConfig = {}) {
    this.config = {
      rootDir: config.rootDir ?? process.cwd(),
      timeoutMs: config.timeoutMs ?? 120000,
      maxConcurrency: config.maxConcurrency ?? 4,
    };
  }

  async execute(testFiles: TestFile[]): Promise<TestExecutionResult> {
    const results: TestResult[] = [];
    const outputs: TestOutput[] = [];
    let passed = 0,
      failed = 0;
    const skipped = 0;
    const startTime = Date.now();

    for (const testFile of testFiles) {
      try {
        const fileResult = await this.executeTestFile(testFile);
        results.push(...fileResult.results);
        outputs.push(...fileResult.outputs);

        for (const r of fileResult.results) {
          if (r.passed) passed++;
          else failed++;
        }
      } catch (error) {
        failed++;
        results.push({
          file: testFile.file,
          testName: "FILE_EXECUTION_ERROR",
          passed: false,
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error),
          category: testFile.category,
        });
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      results,
      summary: { total: results.length, passed, failed, skipped, durationMs },
      outputs,
    };
  }

  private async executeTestFile(
    testFile: TestFile,
  ): Promise<{ results: TestResult[]; outputs: TestOutput[] }> {
    const results: TestResult[] = [];
    const outputs: TestOutput[] = [];

    const command = this.getTestCommand(testFile);
    if (!command) {
      return { results, outputs };
    }

    const [cmd, ...args] = command.split(" ");

    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: this.config.rootDir,
        timeout: this.config.timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (_code) => {
        const hash = createHash("sha3-512")
          .update(stdout + stderr)
          .digest("hex");

        outputs.push({
          file: testFile.file,
          testName: "ALL",
          stdout,
          stderr,
          hash,
        });

        const parsedResults = this.parseTestOutput(stdout, stderr, testFile);
        resolve({ results: parsedResults, outputs });
      });

      child.on("error", (error) => {
        const hash = createHash("sha3-512").update(error.message).digest("hex");
        outputs.push({
          file: testFile.file,
          testName: "ERROR",
          stdout: "",
          stderr: error.message,
          hash,
        });
        resolve({
          results: [
            {
              file: testFile.file,
              testName: "SPAWN_ERROR",
              passed: false,
              durationMs: 0,
              error: error.message,
              category: testFile.category,
            },
          ],
          outputs,
        });
      });
    });
  }

  private getTestCommand(testFile: TestFile): string | null {
    switch (testFile.framework) {
      case "vitest":
        return `npx vitest run ${testFile.file} --reporter=json`;
      case "jest":
        return `npx jest ${testFile.file} --json`;
      case "playwright":
        return `npx playwright test ${testFile.file} --reporter=json`;
      case "cypress":
        return `npx cypress run --spec ${testFile.file} --reporter json`;
      case "k6":
        return `k6 run ${testFile.file} --out json=stdout`;
      default:
        return null;
    }
  }

  private parseTestOutput(stdout: string, _stderr: string, testFile: TestFile): TestResult[] {
    const results: TestResult[] = [];

    try {
      if (testFile.framework === "vitest" || testFile.framework === "jest") {
        const jsonStart = stdout.indexOf("{");
        if (jsonStart >= 0) {
          const jsonStr = stdout.slice(jsonStart);
          const parsed = JSON.parse(jsonStr);
          if (parsed.testResults) {
            for (const tr of parsed.testResults) {
              for (const ar of tr.assertionResults ?? []) {
                results.push({
                  file: testFile.file,
                  testName: ar.fullName ?? ar.title ?? "unknown",
                  passed: ar.status === "passed",
                  durationMs: ar.duration ?? 0,
                  error: ar.failureMessages?.[0],
                  category: testFile.category,
                });
              }
            }
          }
        }
      }
    } catch {
      /* intentional empty: best-effort validation */
    }

    return results;
  }
}

export class ConcurrencyTestRunner {
  constructor(_config: TestRunnerConfig = {}) {}

  async runConcurrencyTest(testConfig: ConcurrencyTestConfig): Promise<ConcurrencyTestResult> {
    await testConfig.setup();

    try {
      const result = await Promise.race([
        testConfig.execute(),
        new Promise<ConcurrencyTestResult>((_, reject) =>
          setTimeout(() => reject(new Error("Concurrency test timeout")), testConfig.timeoutMs),
        ),
      ]);

      await testConfig.teardown();
      return result;
    } catch (error) {
      await testConfig.teardown();
      throw error;
    }
  }

  async runStandardConcurrencyTests(): Promise<ConcurrencyTestResult[]> {
    const tests: ConcurrencyTestConfig[] = [
      {
        name: "concurrent_balance_updates",
        description: "100 actualizaciones concurrentes de balance",
        setup: async () => {},
        execute: async () => {
          // This would run actual concurrent operations against the system
          return {
            passed: false,
            actualResult: "pending_implementation",
            expectedResult: "balance = expected",
            metrics: {
              operationsCompleted: 0,
              operationsFailed: 0,
              lostUpdates: 0,
              duplicateUpdates: 0,
              deadlocks: 0,
              timeouts: 0,
              durationMs: 0,
            },
          };
        },
        teardown: async () => {},
        expectedResult: "balance = expected",
        timeoutMs: 60000,
      },
      {
        name: "concurrent_audit_writes",
        description: "Escrituras concurrentes en audit log",
        setup: async () => {},
        execute: async () => {
          return {
            passed: false,
            actualResult: "pending_implementation",
            expectedResult: "hash_chain_valid = true",
            metrics: {
              operationsCompleted: 0,
              operationsFailed: 0,
              lostUpdates: 0,
              duplicateUpdates: 0,
              deadlocks: 0,
              timeouts: 0,
              durationMs: 0,
            },
          };
        },
        teardown: async () => {},
        expectedResult: "hash_chain_valid = true",
        timeoutMs: 60000,
      },
      {
        name: "webhook_delivery_storm",
        description: "Tormenta de entregas de webhooks",
        setup: async () => {},
        execute: async () => {
          return {
            passed: false,
            actualResult: "pending_implementation",
            expectedResult: "all_processed = true, idempotency_maintained = true",
            metrics: {
              operationsCompleted: 0,
              operationsFailed: 0,
              lostUpdates: 0,
              duplicateUpdates: 0,
              deadlocks: 0,
              timeouts: 0,
              durationMs: 0,
            },
          };
        },
        teardown: async () => {},
        expectedResult: "all_processed = true, idempotency_maintained = true",
        timeoutMs: 60000,
      },
    ];

    const results: ConcurrencyTestResult[] = [];
    for (const test of tests) {
      try {
        const result = await this.runConcurrencyTest(test);
        results.push(result);
      } catch (error) {
        results.push({
          passed: false,
          actualResult: `error: ${error instanceof Error ? error.message : String(error)}`,
          expectedResult: test.expectedResult,
          metrics: {
            operationsCompleted: 0,
            operationsFailed: 1,
            lostUpdates: 0,
            duplicateUpdates: 0,
            deadlocks: 0,
            timeouts: 1,
            durationMs: 0,
          },
        });
      }
    }

    return results;
  }
}

export function createTestDiscovery(config?: TestRunnerConfig): TestDiscovery {
  return new TestDiscovery(config);
}

export function createTestExecutor(config?: TestRunnerConfig): TestExecutor {
  return new TestExecutor(config);
}

export function createConcurrencyTestRunner(config?: TestRunnerConfig): ConcurrencyTestRunner {
  return new ConcurrencyTestRunner(config);
}
