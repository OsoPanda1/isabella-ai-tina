/**
 * POLICY AS CODE — REPOSITORIO POSTGRES (src/lib/repositories/policy-repository.ts)
 * -----------------------------------------------------------------
 * Carga las reglas versionadas de `isabella_policies` (migración
 * 20260926030000_isabella_policy_as_code.sql) para que la política viva en la
 * base de datos y no sólo en código: operador-tunable, versionada y con
 * seed en la propia migración.
 *
 * Origen: integración de piezas de nodo-cero-isabella (policy gate desde DB),
 * reescrito a las convenciones de este repositorio:
 *  - process.env sólo vía `config()` (§21),
 *  - sin adapters de test fuera de test/dev (§18),
 *  - sin secrets en logs,
 *  - fail-closed: sin DATABASE_URL el store se declara "no configurado" y la
 *    decisión recae en el motor ARGUS de código; un error de lectura se
 *    propaga para que el gate lo trate como indisponibilidad (§4.2).
 *
 * El import de `pg` es dinámico para no arrastrar un módulo Node-only al
 * bundle del cliente.
 */

import { config } from "../config";

export type DbPolicyStatus = "allowed" | "denied" | "requires_approval";

export interface DbPolicyRuleWhen {
  /** Nombre exacto de la herramienta (whitelist). */
  tool?: string;
  /** Nivel de riesgo registrado: low | medium | high | critical. */
  risk?: string;
  /** Categoría de la herramienta (memory, ledger, identity, ...). */
  category?: string;
  /** true = la herramienta toca la frontera territorial. */
  territorialBoundary?: boolean;
  /** false = el actor NO está autenticado. */
  authenticated?: boolean;
}

export interface DbPolicyRule {
  when?: DbPolicyRuleWhen;
  then?: {
    status?: DbPolicyStatus;
    reason?: string;
  };
}

export interface StoredPolicy {
  policyKey: string;
  description: string | null;
  rules: DbPolicyRule[];
  version: string;
  priority: number;
}

export interface DbPolicyStore {
  /**
   * `null` = store no configurado (sin DATABASE_URL): la capa DB se omite y
   * aplica sólo la política de código. Lanza = indisponibilidad: el gate la
   * convierte en fail-closed para herramientas con side effects.
   */
  load(): Promise<StoredPolicy[] | null>;
}

type PoolLike = {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};

let pool: PoolLike | null = null;

async function getPool(): Promise<PoolLike> {
  if (pool) return pool;
  const url = config().DATABASE_URL;
  if (!url) {
    throw new Error(
      "POLICY_STORE_UNAVAILABLE: DATABASE_URL ausente; no se pueden leer isabella_policies.",
    );
  }
  const { Pool } = await import("pg");
  pool = new Pool({ connectionString: url, max: 2 });
  return pool;
}

/** Cierra el pool (sólo para shutdown/tests). */
export async function closePolicyPool(): Promise<void> {
  const current = pool;
  pool = null;
  if (current) await current.end().catch(() => undefined);
}

function mapRow(row: Record<string, unknown>): StoredPolicy {
  const rawRules = row.rules;
  let rules: DbPolicyRule[] = [];
  if (Array.isArray(rawRules)) {
    rules = rawRules as DbPolicyRule[];
  } else if (typeof rawRules === "string") {
    try {
      const parsed: unknown = JSON.parse(rawRules);
      if (Array.isArray(parsed)) rules = parsed as DbPolicyRule[];
    } catch {
      rules = [];
    }
  }
  return {
    policyKey: String(row.policy_key),
    description: row.description == null ? null : String(row.description),
    rules,
    version: String(row.version ?? "0.0.0"),
    priority: Number(row.priority ?? 100),
  };
}

/**
 * Lee las políticas habilitadas. Lanza si la base no responde (el gate
 * interpreta el error como indisponibilidad, no como "sin reglas").
 */
export async function loadDbPolicies(): Promise<StoredPolicy[]> {
  const current = await getPool();
  const { rows } = await current.query(
    `SELECT policy_key, description, rules, version, priority
       FROM public.isabella_policies
      WHERE enabled = TRUE
      ORDER BY priority ASC, policy_key ASC`,
  );
  return rows.map(mapRow);
}

/**
 * Store por defecto: `load()` devuelve `null` cuando no hay DATABASE_URL
 * (no configurado) y propaga el error cuando la base falla.
 */
export function createDbPolicyStore(): DbPolicyStore {
  return {
    async load(): Promise<StoredPolicy[] | null> {
      let hasUrl = false;
      try {
        hasUrl = Boolean(config().DATABASE_URL);
      } catch {
        // Configuración inválida = indisponibilidad, no "no configurado".
        hasUrl = true;
      }
      if (!hasUrl) return null;
      return loadDbPolicies();
    },
  };
}
