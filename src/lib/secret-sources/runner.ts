/**
 * Bounded child-process runner shared by the `command` and `bitwarden`
 * sources.
 *
 * Hard guarantees, ported from Hermes' `subprocess` usage:
 * - non-interactive: stdin is `ignore` (the DEVNULL equivalent), so a helper
 *   that prompts can never wedge a request;
 * - `windowsHide: true`, so no console window flashes on Windows;
 * - hard timeout: the promise settles at the deadline (and the child group is
 *   killed), so a hung helper cannot outlive it even if a grandchild keeps
 *   the pipes open;
 * - byte cap on stdout/stderr: an oversized helper degrades to a typed
 *   outcome instead of growing without bound;
 * - structured outcomes only: callers get an outcome + exit code, never a
 *   reason string built from child output.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export type RunOutcome = "ok" | "exit_error" | "timeout" | "output_too_large" | "spawn_error";

export interface RunProcessRequest {
  /** Executable path, or a shell command string when `shell` is true. */
  command: string;
  args?: string[];
  shell: boolean;
  /** Minimal child environment; never inherits the parent's secrets implicitly. */
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface RunProcessResult {
  outcome: RunOutcome;
  exitCode: number | null;
  /** Child stdout; empty unless `outcome` is `ok`, so failures never carry bytes. */
  stdout: string;
  /**
   * Capped stderr of a failed run. Used only to classify failures (auth vs
   * generic); never logged and never embedded in an error message.
   */
  stderr: string;
  /** `errno` of a spawn failure (e.g. `ENOENT`). Never contains child output. */
  spawnErrorCode?: string;
}

type PipedChild = ChildProcessByStdio<null, Readable, Readable>;

function errnoOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

/**
 * Clamps a requested limit to a positive integer that never exceeds the hard
 * `limit`: callers may tighten a bound (tests, stricter deployments) but can
 * never widen the timeout or the output cap.
 */
export function boundedLimit(limit: number, requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return limit;
  return Math.min(Math.max(Math.floor(requested), 1), limit);
}

export function runProcess(request: RunProcessRequest): Promise<RunProcessResult> {
  return new Promise((resolve) => {
    const { command, shell, env, timeoutMs, maxOutputBytes } = request;
    const args = request.args ?? [];

    let child: PipedChild;
    try {
      child = spawn(command, args, {
        shell,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      resolve({
        outcome: "spawn_error",
        exitCode: null,
        stdout: "",
        stderr: "",
        spawnErrorCode: errnoOf(error),
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const killChild = (): void => {
      if (child.pid === undefined) return;
      if (process.platform !== "win32") {
        try {
          // Negative pid targets the whole group, so grandchildren of a shell
          // helper die with it instead of outliving the timeout.
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // Group already gone (or we are not the group leader): fall through.
        }
      }
      child.kill("SIGKILL");
    };

    // Early settle (timeout / cap): drop our end of the pipes so a grandchild
    // that outlives its parent cannot keep this process' event loop alive.
    const releaseStreams = (): void => {
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    };

    child.stdout.on("error", () => {
      // Teardown races are expected once the run has settled.
    });
    child.stderr.on("error", () => {
      // Teardown races are expected once the run has settled.
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killChild();
      releaseStreams();
      resolve({ outcome: "timeout", exitCode: null, stdout: "", stderr });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        settled = true;
        clearTimeout(timer);
        killChild();
        releaseStreams();
        resolve({ outcome: "output_too_large", exitCode: null, stdout: "", stderr });
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) return;
      stderrBytes += chunk.length;
      if (stderrBytes > maxOutputBytes) return;
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      releaseStreams();
      resolve({
        outcome: "spawn_error",
        exitCode: null,
        stdout: "",
        stderr: "",
        spawnErrorCode: errnoOf(error),
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ outcome: "ok", exitCode: 0, stdout, stderr });
        return;
      }
      resolve({ outcome: "exit_error", exitCode: code, stdout: "", stderr });
    });
  });
}
