export interface PackageManagerDetection {
  name: string | null;
  version: string | null;
  lockfile: string | null;
  lockfiles: string[];
}

export interface FrameworkDetection {
  kind: string;
  label: string;
  markers: string[];
}

export interface ScriptResolution {
  script: string | null;
  command: string | null;
}

export type VerifyScriptRole = "install" | "typecheck" | "lint" | "test" | "build" | "verify";

export type VerifyScripts = Record<VerifyScriptRole, ScriptResolution>;

export interface EnvironmentManifest {
  schema: string;
  schemaVersion: number;
  project: { name: string | null; version: string | null };
  packageManager: PackageManagerDetection;
  runtime: { node: string | null; nvmrc: string | null };
  framework: FrameworkDetection;
  scripts: VerifyScripts;
  integrity: { packageJsonSha256: string; lockfileSha256: string | null; contentHash: string };
}

export interface ManifestCheck {
  ok: boolean;
  differences: string[];
}

export const SCHEMA: string;
export const SCHEMA_VERSION: number;
export const MANIFEST_RELATIVE_PATH: string;

export function detectPackageManager(root: string): PackageManagerDetection;
export function detectFramework(pkg: unknown): FrameworkDetection;
export function resolveScripts(
  root: string,
  pkg: unknown,
  packageManager: string | null,
): VerifyScripts;
export function buildEnvironmentManifest(root: string): EnvironmentManifest;
export function serializeManifest(manifest: EnvironmentManifest): string;
export function manifestPath(root: string): string;
export function loadManifest(root: string): Record<string, unknown> | null;
export function checkManifest(root: string): ManifestCheck;
