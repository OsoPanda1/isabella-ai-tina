import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { config } from "../../config";
import type {
  IRepository,
  AuditEntry,
  ApiKey,
  Tenant,
  Session,
  RepositoryError,
  RepositoryFactory,
} from "../repository";

const PERSISTENCE_DIR = path.join(process.cwd(), "isabella_data");
const FILES: Record<string, string> = {
  tenant: "tenants.json",
  session: "sessions.json",
  apiKey: "apiKeys.json",
  audit: "auditLogs.json",
};

function assertJsonAllowed(): void {
  // Contrato canónico vía config() (§12). Si la configuración no carga,
  // fail-closed: JSON prohibido (nunca asumir entorno no productivo).
  let isProd = true;
  let allowed = false;
  try {
    const cfg = config();
    isProd =
      cfg.NODE_ENV === "production" ||
      cfg.ISABELLA_RUNTIME_MODE === "production" ||
      cfg.ISABELLA_RUNTIME_MODE === "staging";
    allowed = cfg.DURABLE_JSON_ALLOWED === true;
  } catch {
    isProd = true;
    allowed = false;
  }
  if (isProd && !allowed) {
    throw Object.assign(
      new Error("[FATAL] JSON persistence forbidden in production — DURABLE_JSON_ALLOWED=false"),
      {
        code: "REPOSITORY_FORBIDDEN",
        statusCode: 500,
        retryable: false,
      },
    );
  }
}

function ensureDir() {
  if (!fs.existsSync(PERSISTENCE_DIR)) {
    fs.mkdirSync(PERSISTENCE_DIR, { recursive: true });
  }
}

function filePath(type: string): string {
  return path.join(PERSISTENCE_DIR, FILES[type as keyof typeof FILES] ?? "");
}

function load<T>(type: string): T[] {
  try {
    ensureDir();
    const fp = filePath(type);
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, "utf8")) as T[];
    }
  } catch {
    // fail-open to empty
  }
  return [];
}

function save<T>(type: string, items: T[]): void {
  ensureDir();
  const fp = filePath(type);
  const tmp = fp + ".tmp." + crypto.randomUUID().slice(0, 8);
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}

function toRepositoryError(err: unknown): RepositoryError {
  const e = err instanceof Error ? err : new Error(String(err));
  const rep: RepositoryError = Object.assign(e, {
    code: "REPOSITORY_ERROR",
    statusCode: 500,
    retryable: true,
  });
  return rep;
}

function recordTenantId(record: unknown): string | undefined {
  const r = record as Record<string, unknown>;
  return (r.tenantId as string) ?? (r.tenant_id as string) ?? (r.tenant_id as string) ?? undefined;
}

function isTenantIsolated<T>(record: T, tenantId: string): boolean {
  if (!tenantId) return false; // deny: sólo findByPrefix cruza tenants
  const tid = recordTenantId(record);
  // For Tenant records, id === tenantId
  const id = (record as { id: string }).id;
  if (tid === undefined && id === tenantId) return true;
  return tid === tenantId;
}

export class JsonFileRepository<T extends { id: string }> implements IRepository<T> {
  private readonly type: string;

  constructor(type: string) {
    this.type = type;
    assertJsonAllowed();
  }

  async create(tenantId: string, data: Partial<T>): Promise<T> {
    assertJsonAllowed();
    if (!tenantId) throw toRepositoryError(new Error("tenantId required for create"));
    const items = load<T>(this.type);
    const record = {
      ...data,
      id: (data as Record<string, unknown>).id ?? crypto.randomUUID(),
      tenantId,
      tenant_id: tenantId,
    } as unknown as T;
    // Ensure tenant isolation field set
    (record as Record<string, unknown>).tenantId = tenantId;
    (record as Record<string, unknown>).tenant_id = tenantId;
    items.push(record);
    save(this.type, items);
    return record;
  }

  async read(tenantId: string, id: string): Promise<T | null> {
    assertJsonAllowed();
    // S14: sin tenantId no hay lookup — sería lectura cross-tenant.
    // El lookup por prefijo (auth) usa findByPrefix, que es el único cruce.
    if (!tenantId) throw toRepositoryError(new Error("tenantId required for read"));
    const items = load<T>(this.type);
    const found = items.find((r) => r.id === id && isTenantIsolated(r, tenantId)) ?? null;
    return found;
  }

  async list(
    tenantId: string,
    _filters?: Record<string, unknown>,
    limit?: number,
    offset?: number,
  ): Promise<{ items: T[]; total: number }> {
    assertJsonAllowed();
    // S14: list("") devolvía TODOS los tenants. Denegar salvo lookup por
    // prefijo, que se resuelve con findByPrefix().
    if (!tenantId) {
      throw toRepositoryError(new Error("tenantId required for list (cross-tenant denied)"));
    }
    const items = load<T>(this.type);
    let result = items;
    result = result.filter((r) => isTenantIsolated(r, tenantId));
    if (_filters) {
      result = result.filter((r) =>
        Object.entries(_filters).every(([k, v]) => {
          const rv =
            (r as Record<string, unknown>)[k] ??
            (r as Record<string, unknown>)[toSnake(k)] ??
            (r as Record<string, unknown>)[toCamel(k)];
          return rv === v;
        }),
      );
    }
    const total = result.length;
    const sliced =
      offset !== undefined
        ? result.slice(offset, offset + (limit ?? total))
        : limit !== undefined
          ? result.slice(0, limit)
          : result;
    return { items: sliced, total };
  }

  async update(tenantId: string, id: string, data: Partial<T>): Promise<T> {
    assertJsonAllowed();
    if (!tenantId) throw toRepositoryError(new Error("tenantId required for update"));
    const items = load<T>(this.type);
    const idx = items.findIndex((r) => r.id === id && isTenantIsolated(r, tenantId));
    if (idx < 0) {
      throw toRepositoryError(new Error(`Record ${id} not found for tenant ${tenantId}`));
    }
    // Prevent tenantId tampering
    const sanitized = { ...data } as Record<string, unknown>;
    delete sanitized.tenantId;
    delete sanitized.tenant_id;
    items[idx] = { ...items[idx], ...sanitized } as T;
    save(this.type, items);
    return items[idx];
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    assertJsonAllowed();
    if (!tenantId) throw toRepositoryError(new Error("tenantId required for delete"));
    const items = load<T>(this.type);
    const idx = items.findIndex((r) => r.id === id && isTenantIsolated(r, tenantId));
    if (idx < 0) return false;
    items.splice(idx, 1);
    save(this.type, items);
    return true;
  }

  async findByPrefix(prefix: string): Promise<T | null> {
    // Único lookup autorizado SIN tenantId: se usa antes de conocer el tenant
    // (validación de llave API por prefijo). El caller compara el hash.
    assertJsonAllowed();
    const items = load<T>(this.type);
    return (
      (items.find(
        (r) =>
          (r as Record<string, unknown>).keyPrefix === prefix ||
          (r as Record<string, unknown>).prefix === prefix ||
          (r as Record<string, unknown>).key_prefix === prefix,
      ) as T | undefined) ?? null
    );
  }

  async audit(entry: AuditEntry): Promise<void> {
    assertJsonAllowed();
    const items = load<AuditEntry>("audit");
    items.unshift(entry);
    save("audit", items);
  }

  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = performance.now();
    try {
      assertJsonAllowed();
      ensureDir();
      fs.accessSync(filePath(this.type));
      return { ok: true, latencyMs: performance.now() - start };
    } catch {
      return { ok: false, latencyMs: performance.now() - start };
    }
  }
}

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

type BaseRecord = { id: string; [key: string]: unknown };

export class JsonRepositoryFactory implements RepositoryFactory {
  private readonly adapters = new Map<string, JsonFileRepository<BaseRecord>>();

  private adapter<T extends { id: string }>(type: string): JsonFileRepository<T> {
    const existing = this.adapters.get(type) as unknown as JsonFileRepository<T> | undefined;
    if (existing) return existing;
    const a = new JsonFileRepository<T>(type);
    this.adapters.set(type, a as unknown as JsonFileRepository<BaseRecord>);
    return a;
  }

  getAdapter<T extends { id: string }>(type: "supabase" | "neon" | "redis"): IRepository<T> {
    assertJsonAllowed();
    return new JsonFileRepository<T>(type);
  }

  getApiKeyRepository(): IRepository<ApiKey> {
    return this.adapter<ApiKey>("apiKey");
  }

  getAuditRepository(): IRepository<AuditEntry> {
    return this.adapter<AuditEntry>("audit");
  }

  getTenantRepository(): IRepository<Tenant> {
    return this.adapter<Tenant>("tenant");
  }

  getSessionRepository(): IRepository<Session> {
    return this.adapter<Session>("session");
  }
}

export const repositoryFactory = new JsonRepositoryFactory();
