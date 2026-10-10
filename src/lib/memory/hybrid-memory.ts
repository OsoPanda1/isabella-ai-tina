/** Tenant/territory-scoped hybrid memory with provenance. No silent cross-tenant retrieval. */
import { createHash, randomUUID } from "node:crypto";
export type MemoryKind = "EPISODIC" | "SEMANTIC" | "PROCEDURAL" | "GOVERNANCE" | "LEARNING";
export interface MemoryItem {
  id: string;
  tenantId: string;
  territoryId: string;
  kind: MemoryKind;
  content: string;
  sourceUri?: string;
  contentHash: string;
  createdAt: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
}
export interface MemoryStore {
  put(item: MemoryItem): Promise<void> | void;
  list(
    tenantId: string,
    territoryId: string,
    kind?: MemoryKind,
  ): Promise<MemoryItem[]> | MemoryItem[];
}
export class InMemoryHybridMemory implements MemoryStore {
  private readonly items = new Map<string, MemoryItem>();
  put(item: MemoryItem) {
    this.items.set(item.id, { ...item, metadata: { ...item.metadata } });
  }
  list(tenantId: string, territoryId: string, kind?: MemoryKind) {
    const now = Date.now();
    return [...this.items.values()]
      .filter(
        (x) =>
          x.tenantId === tenantId &&
          x.territoryId === territoryId &&
          (!kind || x.kind === kind) &&
          (!x.expiresAt || new Date(x.expiresAt).getTime() > now),
      )
      .map((x) => ({ ...x, metadata: { ...x.metadata } }));
  }
}
export function createMemory(
  input: Omit<MemoryItem, "id" | "contentHash" | "createdAt">,
): MemoryItem {
  return {
    ...input,
    id: randomUUID(),
    contentHash: createHash("sha256").update(input.content).digest("hex"),
    createdAt: new Date().toISOString(),
  };
}
