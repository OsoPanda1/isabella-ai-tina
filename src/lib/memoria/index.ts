/**
 * MEMORIA — Session Memory + FTS Search
 *
 * Sistema de memoria sesional para Isabella Villaseñor AI.
 * Patrón adaptado de Hermes Agent SessionDB (MIT) con renombramiento.
 *
 * Almacena interacciones por sesión con búsqueda full-text.
 * Cada recuerdo tiene: origen, control, expiración, propietario.
 */

// ============================================================================
// TYPES
// ============================================================================

export type MemoryScope = "turn" | "session" | "project" | "territorial" | "historical";

export type MemorySensitivity = "public" | "internal" | "personal" | "restricted";

export interface MemoryEntry {
  id: string;
  sessionId: string;
  scope: MemoryScope;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  sensitivity: MemorySensitivity;
  origin: string;
  owner?: string;
  tags: string[];
  tokensEstimate: number;
  createdAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  scope?: MemoryScope[];
  search?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  sensitivity?: MemorySensitivity;
}

export interface MemoryStats {
  totalEntries: number;
  byScope: Record<MemoryScope, number>;
  totalTokens: number;
  oldestEntry?: string | undefined;
  newestEntry?: string | undefined;
}

// ============================================================================
// MEMORY STORE
// ============================================================================

export class MEMORIAStore {
  private entries: MemoryEntry[] = [];
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(options: { maxEntries?: number; defaultTtlMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.defaultTtlMs = options.defaultTtlMs ?? 3600000; // 1 hour
  }

  add(entry: Omit<MemoryEntry, "id" | "createdAt" | "tokensEstimate">): MemoryEntry {
    const id = `mem-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const tokensEstimate = Math.ceil(entry.content.length / 4);

    const full: MemoryEntry = {
      ...entry,
      id,
      createdAt: now,
      tokensEstimate,
      expiresAt: entry.expiresAt ?? new Date(Date.now() + this.defaultTtlMs).toISOString(),
    };

    this.entries.push(full);
    this.evict();
    return full;
  }

  query(query: MemoryQuery = {}): MemoryEntry[] {
    let results = [...this.entries];

    // Filter expired
    const now = Date.now();
    results = results.filter((e) => !e.expiresAt || new Date(e.expiresAt).getTime() > now);

    // Filter scope
    if (query.scope && query.scope.length > 0) {
      results = results.filter((e) => query.scope!.includes(e.scope));
    }

    // Filter sensitivity
    if (query.sensitivity) {
      results = results.filter((e) => e.sensitivity === query.sensitivity);
    }

    // Filter tags
    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) => query.tags!.some((t) => e.tags.includes(t)));
    }

    // Full-text search
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      results = results.filter(
        (e) =>
          e.content.toLowerCase().includes(searchLower) ||
          e.tags.some((t) => t.toLowerCase().includes(searchLower)),
      );
    }

    // Sort by creation (newest first)
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Paginate
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  get(id: string): MemoryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  remove(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  clear(scope?: MemoryScope): number {
    const before = this.entries.length;
    if (scope) {
      this.entries = this.entries.filter((e) => e.scope !== scope);
    } else {
      this.entries = [];
    }
    return before - this.entries.length;
  }

  stats(): MemoryStats {
    const byScope: Record<MemoryScope, number> = {
      turn: 0,
      session: 0,
      project: 0,
      territorial: 0,
      historical: 0,
    };

    let totalTokens = 0;
    for (const entry of this.entries) {
      byScope[entry.scope]++;
      totalTokens += entry.tokensEstimate;
    }

    return {
      totalEntries: this.entries.length,
      byScope,
      totalTokens,
      oldestEntry: this.entries[0]?.createdAt,
      newestEntry: this.entries[this.entries.length - 1]?.createdAt,
    };
  }

  private evict(): void {
    if (this.entries.length <= this.maxEntries) return;

    // Remove expired first
    const now = Date.now();
    this.entries = this.entries.filter(
      (e) => !e.expiresAt || new Date(e.expiresAt).getTime() > now,
    );

    // If still over limit, remove oldest turns
    while (this.entries.length > this.maxEntries) {
      const turnIdx = this.entries.findIndex((e) => e.scope === "turn");
      if (turnIdx !== -1) {
        this.entries.splice(turnIdx, 1);
      } else {
        break;
      }
    }
  }
}

export const memoriaStore = new MEMORIAStore();
