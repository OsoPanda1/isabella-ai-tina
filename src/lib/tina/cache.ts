/**
 * TINA cache key — segregated by tenant, principal, scopes, versions (src/lib/tina/cache.ts)
 */
import { sha256Hex } from "./ethical";
import type { TinaExecutionPath } from "./types";

export interface TinaCacheInput {
  tenantId: string;
  principalId: string;
  scopes: string[];
  prompt: string;
  policyVersion: string;
  knowledgeVersion: string;
  modelVersion: string;
  territoryId: string;
  path: TinaExecutionPath;
}

function canonicalize(input: TinaCacheInput): string {
  return JSON.stringify({
    ...input,
    scopes: [...input.scopes].sort(),
    prompt: input.prompt.normalize("NFKC").trim(),
  });
}

export async function buildTinaCacheKey(input: TinaCacheInput): Promise<string> {
  return `tina:cache:${sha256Hex(canonicalize(input))}`;
}

export function buildTinaCacheKeySync(input: TinaCacheInput): string {
  return `tina:cache:${sha256Hex(canonicalize(input))}`;
}
