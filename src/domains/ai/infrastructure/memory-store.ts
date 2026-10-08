import { createHash } from "node:crypto";
import { IsabellaMemoryItem, IsabellaMemoryScope } from "../../../contracts/isabella";
import { getDatabase } from "../../../lib/persistence/sqlite";

const fallbackStore: IsabellaMemoryItem[] = [];

const SEED_ITEMS: Omit<IsabellaMemoryItem, "checksum" | "createdAt" | "updatedAt">[] = [
  {
    memoryId: "mem-territorial-001",
    tenantId: "nodo-cero-rdm",
    scope: "territorial",
    content:
      "Real del Monte (Mineral del Monte), Hidalgo: Pueblo Mágico minero, cuna del paste y del fútbol en México. Altitud 2,700 msnm.",
    sourceType: "system",
    relevance: 1.0,
  },
  {
    memoryId: "mem-historical-002",
    tenantId: "nodo-cero-rdm",
    scope: "historical",
    content:
      "Nodo Cero: Primer nodo de soberanía tecnológica e inteligencia contextualizada en Latinoamérica fundado por RDM Digital.",
    sourceType: "system",
    relevance: 0.98,
  },
  {
    memoryId: "mem-project-003",
    tenantId: "nodo-cero-rdm",
    scope: "project",
    content:
      "Isabella Villaseñor AI: Arquitectura cognitiva híbrida estructurada en 5 pilares (ISA, SOPHIA, ORION, ARGUS, CROWN Gateway).",
    sourceType: "system",
    relevance: 0.99,
  },
];

let seeded = false;

function tryGetDb(): ReturnType<typeof getDatabase> | null {
  try {
    const db = getDatabase();
    return db;
  } catch {
    return null;
  }
}

function ensureSeed(): void {
  if (seeded) return;
  seeded = true;

  const db = tryGetDb();
  if (!db) {
    new Date(Date.now() - 3600000 * 24 * 7).toISOString();
    fallbackStore.push(
      ...SEED_ITEMS.map((s, i) => ({
        ...s,
        checksum: `sha256_${s.memoryId}`,
        createdAt: new Date(Date.now() - 3600000 * 24 * (7 - i)).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 24 * (7 - i)).toISOString(),
      })),
    );
    return;
  }

  const count = db.prepare("SELECT COUNT(*) as cnt FROM memory_items").get() as { cnt: number };
  if (count.cnt === 0) {
    const insert = db.prepare(
      "INSERT INTO memory_items (memoryId, tenantId, sessionId, scope, content, contentJson, sourceType, relevance, expiresAt, checksum, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    new Date().toISOString();
    const tx = db.transaction(() => {
      for (const [i, item] of SEED_ITEMS.entries()) {
        const created = new Date(Date.now() - 3600000 * 24 * (7 - i)).toISOString();
        insert.run(
          item.memoryId,
          item.tenantId ?? null,
          null,
          item.scope,
          item.content,
          null,
          item.sourceType,
          item.relevance,
          null,
          `sha256_${item.memoryId}`,
          created,
          created,
        );
      }
    });
    tx();
  }
}

function computeChecksum(content: string, scope: string): string {
  return `sha256_${createHash("sha256")
    .update(content + scope)
    .digest("hex")}`;
}

function rowToItem(row: Record<string, unknown>): IsabellaMemoryItem {
  return {
    memoryId: row.memoryId as string,
    tenantId: (row.tenantId as string) ?? undefined,
    sessionId: (row.sessionId as string) ?? undefined,
    scope: row.scope as IsabellaMemoryScope,
    content: row.content as string,
    contentJson: row.contentJson ? JSON.parse(row.contentJson as string) : undefined,
    sourceType: row.sourceType as IsabellaMemoryItem["sourceType"],
    relevance: row.relevance as number,
    expiresAt: (row.expiresAt as string) ?? undefined,
    checksum: row.checksum as string,
    createdAt: (row.createdAt as string) ?? undefined,
    updatedAt: (row.updatedAt as string) ?? undefined,
  };
}

export async function addMemoryItem(
  item: Omit<IsabellaMemoryItem, "memoryId" | "checksum" | "createdAt" | "updatedAt">,
): Promise<IsabellaMemoryItem> {
  ensureSeed();

  const memoryId = `mem-${item.scope}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const checksum = computeChecksum(item.content, item.scope || "");

  const fullItem: IsabellaMemoryItem = {
    ...item,
    memoryId,
    checksum,
    createdAt: now,
    updatedAt: now,
  };

  const db = tryGetDb();
  if (db) {
    try {
      db.prepare(
        "INSERT INTO memory_items (memoryId, tenantId, sessionId, scope, content, contentJson, sourceType, relevance, expiresAt, checksum, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        memoryId,
        item.tenantId ?? null,
        item.sessionId ?? null,
        item.scope,
        item.content,
        item.contentJson ? JSON.stringify(item.contentJson) : null,
        item.sourceType,
        item.relevance,
        item.expiresAt ?? null,
        checksum,
        now,
        now,
      );
      // Dual-write to PostgreSQL (fire-and-forget)
      import("./../../../lib/persistence/postgres")
        .then(({ pgExecute }) =>
          pgExecute(
            `INSERT INTO memory_items (memoryId, tenantId, sessionId, scope, content, contentJson, sourceType, relevance, expiresAt, checksum, createdAt, updatedAt)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (memoryId) DO NOTHING`,
            [
              memoryId,
              item.tenantId ?? null,
              item.sessionId ?? null,
              item.scope,
              item.content,
              item.contentJson ? JSON.stringify(item.contentJson) : null,
              item.sourceType,
              item.relevance,
              item.expiresAt ?? null,
              checksum,
              now,
              now,
            ],
          ).catch(() => {}),
        )
        .catch(() => {});
      return fullItem;
    } catch {
      // fall through to in-memory
    }
  }

  fallbackStore.unshift(fullItem);
  return fullItem;
}

export function queryMemory(filter?: {
  scope?: IsabellaMemoryScope;
  minRelevance?: number;
  searchQuery?: string;
}): IsabellaMemoryItem[] {
  ensureSeed();

  const db = tryGetDb();
  if (db) {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filter?.scope) {
        conditions.push("scope = ?");
        params.push(filter.scope);
      }
      if (typeof filter?.minRelevance === "number") {
        conditions.push("relevance >= ?");
        params.push(filter.minRelevance);
      }
      if (filter?.searchQuery) {
        conditions.push("content LIKE ?");
        params.push(`%${filter.searchQuery}%`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = db.prepare(`SELECT * FROM memory_items ${where}`).all(...params) as Record<
        string,
        unknown
      >[];
      return rows.map(rowToItem);
    } catch {
      // fall through to in-memory
    }
  }

  let results = [...fallbackStore];
  if (filter?.scope) {
    results = results.filter((m) => m.scope === filter.scope);
  }
  if (typeof filter?.minRelevance === "number") {
    results = results.filter((m) => m.relevance >= (filter.minRelevance || 0));
  }
  if (filter?.searchQuery) {
    const q = filter.searchQuery.toLowerCase();
    results = results.filter((m) => m.content.toLowerCase().includes(q));
  }
  return results;
}

export function getAllMemories(): IsabellaMemoryItem[] {
  ensureSeed();

  const db = tryGetDb();
  if (db) {
    try {
      const rows = db.prepare("SELECT * FROM memory_items").all() as Record<string, unknown>[];
      return rows.map(rowToItem);
    } catch {
      // fall through to in-memory
    }
  }

  return [...fallbackStore];
}

export function clearMemoryScope(scope: IsabellaMemoryScope): void {
  ensureSeed();

  const db = tryGetDb();
  if (db) {
    try {
      db.prepare("DELETE FROM memory_items WHERE scope = ?").run(scope);
      return;
    } catch {
      // fall through to in-memory
    }
  }

  for (let i = fallbackStore.length - 1; i >= 0; i--) {
    if (fallbackStore[i].scope === scope) {
      fallbackStore.splice(i, 1);
    }
  }
}
