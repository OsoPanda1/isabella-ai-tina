import { config } from "../config";
import type {
  IRepository,
  RepositoryFactory,
  ApiKey,
  AuditEntry,
  Tenant,
  Session,
} from "./repository";
import { JsonRepositoryFactory } from "./adapters/json-adapter";
import { NeonRepository } from "./adapters/neon-adapter";

class ProductionRepositoryFactory implements RepositoryFactory {
  private readonly neonFactory = new Map<string, IRepository<unknown>>();
  private readonly jsonFactory = new JsonRepositoryFactory();

  private isProduction(): boolean {
    try {
      const cfg = config();
      const mode = (cfg.ISABELLA_RUNTIME_MODE || "").toLowerCase();
      if (mode === "development" || mode === "test" || mode === "local") {
        return false;
      }
      return cfg.NODE_ENV === "production" || mode === "production" || mode === "staging";
    } catch {
      // La configuración es una frontera de seguridad: si no puede resolverse,
      // asumir runtime productivo evita cualquier fallback a persistencia local.
      return true;
    }
  }

  private isDurableJsonAllowed(): boolean {
    try {
      const cfg = config() as unknown as Record<string, unknown>;
      if (typeof cfg.DURABLE_JSON_ALLOWED === "boolean") return cfg.DURABLE_JSON_ALLOWED as boolean;
      if (typeof cfg.DURABLE_JSON_ALLOWED === "string")
        return (cfg.DURABLE_JSON_ALLOWED as string) === "true";
    } catch {
      // Ignored
    }
    return false;
  }

  private assertProductionPersistence(): void {
    if (!this.isProduction()) {
      return;
    }

    if (this.isDurableJsonAllowed()) {
      throw new Error(
        "[FATAL] JSON persistence is forbidden in staging/production. Set DURABLE_JSON_ALLOWED=false.",
      );
    }

    const cfg = config();
    const hasPostgres = Boolean(cfg.DATABASE_URL);

    if (!hasPostgres) {
      throw new Error(
        "[FATAL] Production persistence misconfigured. Configure DATABASE_URL for the dedicated PostgreSQL authoritative database. Supabase is Identity Provider only — not state authority.",
      );
    }

    // Proveedor explícito (P0-5): una app financiera no debe decidir por
    // presencia de variables ("tengo DATABASE_URL, entonces..."). Exige que
    // ISABELLA_STORAGE_PROVIDER declare postgres|neon; json|supabase|memory
    // son no autoritativos y quedan PROHIBIDOS en staging/production.
    const provider = (cfg as unknown as Record<string, unknown>).ISABELLA_STORAGE_PROVIDER;
    const normalized =
      typeof provider === "string" ? (provider as string).trim().toLowerCase() : "";

    if (!normalized) {
      throw new Error(
        "[FATAL] ISABELLA_STORAGE_PROVIDER must be explicitly set to postgres|neon in staging/production. Ambiguous or missing provider is a deployment blocker.",
      );
    }
    if (!["postgres", "neon"].includes(normalized)) {
      throw new Error(
        `[FATAL] ISABELLA_STORAGE_PROVIDER="${normalized}" is not an authoritative durable provider in production. Allowed: postgres|neon.`,
      );
    }
  }

  private getNeonRepo<T extends { id: string }>(type: string): IRepository<T> {
    this.assertProductionPersistence();
    let repo = this.neonFactory.get(type) as IRepository<T> | undefined;
    if (!repo) {
      repo = new NeonRepository<T>(type);
      this.neonFactory.set(type, repo as IRepository<unknown>);
    }
    return repo;
  }

  getAdapter<T extends { id: string }>(type: "neon" | "redis"): IRepository<T> {
    if (type === "neon") return this.getNeonRepo<T>("neon");
    // redis not yet implemented — fail closed in production
    if (this.isProduction()) {
      throw new Error(
        `[FATAL] Adapter ${type} not implemented for production — deployment blocker`,
      );
    }
    return new JsonRepositoryFactory().getAdapter<T>(type);
  }

  getApiKeyRepository(): IRepository<ApiKey> {
    if (this.isProduction()) return this.getNeonRepo<ApiKey>("apiKey");
    return this.jsonFactory.getApiKeyRepository();
  }

  getAuditRepository(): IRepository<AuditEntry> {
    if (this.isProduction()) return this.getNeonRepo<AuditEntry>("audit");
    return this.jsonFactory.getAuditRepository();
  }

  getTenantRepository(): IRepository<Tenant> {
    if (this.isProduction()) return this.getNeonRepo<Tenant>("tenant");
    return this.jsonFactory.getTenantRepository();
  }

  getSessionRepository(): IRepository<Session> {
    if (this.isProduction()) return this.getNeonRepo<Session>("session");
    return this.jsonFactory.getSessionRepository();
  }
}

export const repositoryFactory: RepositoryFactory = new ProductionRepositoryFactory();

// Legacy export for direct JSON access in dev/test only — not for production routes
export { JsonRepositoryFactory } from "./adapters/json-adapter";
export { NeonRepository } from "./adapters/neon-adapter";
export { createBookpiPostgresRepository } from "../repositories/bookpi-postgres-runtime";
