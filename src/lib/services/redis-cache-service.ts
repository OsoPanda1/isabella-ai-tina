/**
 * @file redis-cache-service.ts
 * @description Módulo de servicio para gestión de caché con Redis (Upstash / Redis URL)
 * y fallback transparente en memoria para garantizar ultra-baja latencia y alta resiliencia.
 * Autoría: Edwin Oswaldo Castillo Trejo (Anubis Villaseñor)
 * Ecosistema: TAMV ONLINE NETWORK / Nodo Cero (Real del Monte, Hidalgo, México)
 */

import { Redis } from "@upstash/redis";
import { config } from "../config";

export interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
  createdAt: number;
}

export interface CachePingResult {
  ok: boolean;
  provider: "redis" | "memory";
  latencyMs: number;
  error?: string;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
  lastLatencyMs: number;
  provider: "redis" | "memory";
}

class InMemoryFallbackStore {
  private store = new Map<string, CacheEntry<unknown>>();
  private maxCapacity = 1000;

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds?: number): boolean {
    if (this.store.size >= this.maxCapacity) {
      // Evict oldest entries
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      createdAt: Date.now(),
    });
    return true;
  }

  del(key: string): boolean {
    return this.store.delete(key);
  }

  exists(key: string): boolean {
    return this.get(key) !== null;
  }

  expire(key: string, ttlSeconds: number): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  flush(prefix?: string): boolean {
    if (!prefix) {
      this.store.clear();
      return true;
    }
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
    return true;
  }

  size(): number {
    return this.store.size;
  }
}

export class RedisCacheService {
  private static instance: RedisCacheService | null = null;
  private redisClient: Redis | null = null;
  private memoryFallback = new InMemoryFallbackStore();
  private isRedisConfigured = false;
  private initPromise: Promise<void> | null = null;
  private prefix = "isabella";

  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
    lastLatencyMs: 0,
    provider: "memory",
  };

  private constructor() {
    this.ensureInitialized();
  }

  public static getInstance(): RedisCacheService {
    if (!RedisCacheService.instance) {
      RedisCacheService.instance = new RedisCacheService();
    }
    return RedisCacheService.instance;
  }

  private ensureInitialized(): void {
    if (this.initPromise) return;

    this.initPromise = (async () => {
      try {
        const cfg = config();
        const redisUrl = cfg.REDIS_URL || cfg.KV_URL;
        const redisToken = cfg.REDIS_TOKEN || cfg.KV_REST_API_TOKEN || cfg.UPSTASH_REDIS_TOKEN;
        this.prefix = cfg.REDIS_PREFIX || "isabella";

        if (redisUrl && redisToken) {
          this.redisClient = new Redis({
            url: redisUrl,
            token: redisToken,
            retry: {
              retries: 2,
              backoff: (retryCount: number) => Math.min(100 * Math.pow(2, retryCount), 500),
            },
          } as unknown as ConstructorParameters<typeof Redis>[0]);
          this.isRedisConfigured = true;
          this.metrics.provider = "redis";
        } else {
          this.isRedisConfigured = false;
          this.metrics.provider = "memory";
        }
      } catch (err) {
        this.isRedisConfigured = false;
        this.metrics.provider = "memory";
        console.warn(
          "[RedisCacheService] Redis no configurado o inválido; operando en memoria local resiliente:",
          err,
        );
      }
    })();
  }

  private formatKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private recordMetric(kind: "hit" | "miss" | "set" | "del" | "error", latencyMs: number) {
    this.metrics.lastLatencyMs = Number(latencyMs.toFixed(2));
    if (kind === "hit") this.metrics.hits++;
    else if (kind === "miss") this.metrics.misses++;
    else if (kind === "set") this.metrics.sets++;
    else if (kind === "del") this.metrics.deletes++;
    else if (kind === "error") this.metrics.errors++;
  }

  /**
   * Obtiene un valor tipado desde la caché
   */
  public async get<T>(key: string): Promise<T | null> {
    const started = performance.now();
    await this.initPromise;
    const fullKey = this.formatKey(key);

    if (this.isRedisConfigured && this.redisClient) {
      try {
        const value = await this.redisClient.get<T>(fullKey);
        const elapsed = performance.now() - started;
        if (value !== null && value !== undefined) {
          this.recordMetric("hit", elapsed);
          return value;
        }
        this.recordMetric("miss", elapsed);
        return null;
      } catch (error) {
        this.recordMetric("error", performance.now() - started);
        console.warn(
          `[RedisCacheService] Error leyendo clave ${key} de Redis, recurriendo a memoria:`,
          error,
        );
        return this.memoryFallback.get<T>(fullKey);
      }
    }

    const value = this.memoryFallback.get<T>(fullKey);
    const elapsed = performance.now() - started;
    this.recordMetric(value !== null ? "hit" : "miss", elapsed);
    return value;
  }

  /**
   * Guarda un valor en la caché con TTL opcional en segundos
   */
  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    const started = performance.now();
    await this.initPromise;
    const fullKey = this.formatKey(key);

    if (this.isRedisConfigured && this.redisClient) {
      try {
        if (ttlSeconds && ttlSeconds > 0) {
          await this.redisClient.set(fullKey, value, { ex: ttlSeconds });
        } else {
          await this.redisClient.set(fullKey, value);
        }
        this.recordMetric("set", performance.now() - started);
        return true;
      } catch (error) {
        this.recordMetric("error", performance.now() - started);
        console.warn(
          `[RedisCacheService] Error escribiendo clave ${key} en Redis, respaldando en memoria:`,
          error,
        );
        return this.memoryFallback.set(fullKey, value, ttlSeconds);
      }
    }

    const result = this.memoryFallback.set(fullKey, value, ttlSeconds);
    this.recordMetric("set", performance.now() - started);
    return result;
  }

  /**
   * Elimina una clave o lista de claves
   */
  public async del(keys: string | string[]): Promise<number> {
    const started = performance.now();
    await this.initPromise;
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const fullKeys = keyArray.map((k) => this.formatKey(k));

    if (this.isRedisConfigured && this.redisClient) {
      try {
        const count = await this.redisClient.del(...fullKeys);
        this.recordMetric("del", performance.now() - started);
        return count;
      } catch (error) {
        this.recordMetric("error", performance.now() - started);
        console.warn(`[RedisCacheService] Error eliminando claves en Redis:`, error);
      }
    }

    let count = 0;
    for (const k of fullKeys) {
      if (this.memoryFallback.del(k)) count++;
    }
    this.recordMetric("del", performance.now() - started);
    return count;
  }

  /**
   * Verifica la existencia de una clave
   */
  public async exists(key: string): Promise<boolean> {
    await this.initPromise;
    const fullKey = this.formatKey(key);

    if (this.isRedisConfigured && this.redisClient) {
      try {
        const result = await this.redisClient.exists(fullKey);
        return result === 1;
      } catch {
        return this.memoryFallback.exists(fullKey);
      }
    }

    return this.memoryFallback.exists(fullKey);
  }

  /**
   * Asigna un tiempo de vida (TTL) a una clave existente
   */
  public async expire(key: string, ttlSeconds: number): Promise<boolean> {
    await this.initPromise;
    const fullKey = this.formatKey(key);

    if (this.isRedisConfigured && this.redisClient) {
      try {
        const result = await this.redisClient.expire(fullKey, ttlSeconds);
        return result === 1;
      } catch {
        return this.memoryFallback.expire(fullKey, ttlSeconds);
      }
    }

    return this.memoryFallback.expire(fullKey, ttlSeconds);
  }

  /**
   * Obtiene múltiples claves en una sola operación optimizada
   */
  public async mget<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    await this.initPromise;
    const fullKeys = keys.map((k) => this.formatKey(k));

    if (this.isRedisConfigured && this.redisClient) {
      try {
        const values = await this.redisClient.mget<T[]>(...fullKeys);
        return values.map((v) => (v !== undefined ? v : null));
      } catch {
        return fullKeys.map((k) => this.memoryFallback.get<T>(k));
      }
    }

    return fullKeys.map((k) => this.memoryFallback.get<T>(k));
  }

  /**
   * Limpia el prefijo del espacio de nombres
   */
  public async flush(prefixOnly = true): Promise<boolean> {
    await this.initPromise;
    if (this.isRedisConfigured && this.redisClient && !prefixOnly) {
      try {
        await this.redisClient.flushdb();
      } catch (err) {
        console.warn("[RedisCacheService] Error en flushdb Redis:", err);
      }
    }
    return this.memoryFallback.flush(prefixOnly ? this.prefix : undefined);
  }

  /**
   * Diagnóstico de ping y latencia
   */
  public async ping(): Promise<CachePingResult> {
    const started = performance.now();
    await this.initPromise;

    if (this.isRedisConfigured && this.redisClient) {
      try {
        const response = await this.redisClient.ping();
        const latencyMs = Number((performance.now() - started).toFixed(2));
        return {
          ok: response === "PONG" || Boolean(response),
          provider: "redis",
          latencyMs,
        };
      } catch (error) {
        const latencyMs = Number((performance.now() - started).toFixed(2));
        return {
          ok: false,
          provider: "redis",
          latencyMs,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const latencyMs = Number((performance.now() - started).toFixed(2));
    return {
      ok: true,
      provider: "memory",
      latencyMs,
    };
  }

  /**
   * Métricas y estado del servicio
   */
  public getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }
}

export const redisCache = RedisCacheService.getInstance();
