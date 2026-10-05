/**
 * TINA plugin registry with declared permissions (src/lib/tina/plugins.ts)
 *
 * Los permisos declarados en el manifiest son *enforced* en tiempo de
 * invocación (ISA-041): cada plugin recibe un guard de capacidades
 * default-deny para lectura, escritura, tools y egress de red (ISA-042 a
 * ISA-045). Una petición que declare operaciones fuera del manifiest se
 * rechaza antes de ejecutar el plugin.
 */
import type { TinaBookPI } from "./ledger";
import { assertToolsWithinLimits, LimitError } from "../input-limits";

export interface TinaPluginManifest {
  id: string;
  version: string;
  publisher: string;
  permissions: {
    read: string[];
    write: string[];
    tools: string[];
    networkAllow: string[];
  };
}

/** Operaciones solicitadas por el invocador; se validan contra el manifiest. */
export interface PluginInvocationRequest {
  reads?: string[];
  writes?: string[];
  tools?: string[];
  networkTargets?: string[];
}

export type PluginPermissionKind = "read" | "write" | "tool" | "network";

export class PluginPermissionError extends Error {
  readonly code = "PLUGIN_PERMISSION_DENIED";
  constructor(
    readonly kind: PluginPermissionKind,
    readonly target: string,
    readonly pluginId: string,
  ) {
    super(`PLUGIN_PERMISSION_DENIED: ${kind} "${target}" no está en el manifiest de ${pluginId}`);
    this.name = "PluginPermissionError";
  }
}

function matches(target: string, allowed: string[]): boolean {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return false;
  return allowed.some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === "*") return true;
    if (pattern.endsWith("/*")) return normalized.startsWith(pattern.slice(0, -1));
    return pattern === normalized;
  });
}

/**
 * Normaliza un destino de red a hostname. Devuelve `null` cuando el destino no
 * es un objetivo HTTPS válido (fail-closed: se deniega).
 */
function networkHost(target: string): string | null {
  try {
    const parsed = new URL(target);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.hostname.toLowerCase();
  } catch {
    const bare = target.trim().toLowerCase();
    return bare || null;
  }
}

/**
 * Guard de capacidades entregado a cada plugin. Todas las operaciones son
 * default-deny y quedan registradas en BookPI por el registry.
 */
export class PluginPermissionGuard {
  constructor(
    private readonly manifest: TinaPluginManifest,
    private readonly bookpi: TinaBookPI,
  ) {}

  get pluginId(): string {
    return this.manifest.id;
  }

  private async deny(kind: PluginPermissionKind, target: string): Promise<never> {
    await this.bookpi.append("PLUGIN_PERMISSION_DENIED", {
      pluginId: this.manifest.id,
      kind,
      target,
    });
    throw new PluginPermissionError(kind, target, this.manifest.id);
  }

  async assertRead(resource: string): Promise<void> {
    if (!matches(resource, this.manifest.permissions.read)) await this.deny("read", resource);
  }

  async assertWrite(resource: string): Promise<void> {
    if (!matches(resource, this.manifest.permissions.write)) await this.deny("write", resource);
  }

  async assertTool(tool: string): Promise<void> {
    if (!matches(tool, this.manifest.permissions.tools)) await this.deny("tool", tool);
  }

  /** Solo HTTPS y únicamente hosts listados en `networkAllow`. */
  async assertNetwork(url: string): Promise<void> {
    const host = networkHost(url);
    if (!host || !matches(host, this.manifest.permissions.networkAllow))
      await this.deny("network", url);
  }
}

export interface TinaPlugin {
  manifest: TinaPluginManifest;
  run(input: unknown, guard: PluginPermissionGuard): Promise<unknown>;
}

function assertPermissionsShape(permissions: TinaPluginManifest["permissions"]): void {
  (["read", "write", "tools", "networkAllow"] as const).forEach((key) => {
    const value = permissions[key];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
      throw new Error(`Permiso "${key}" inválido: se espera una lista de cadenas`);
  });
}

export class TinaPluginRegistry {
  private plugins = new Map<string, TinaPlugin>();

  constructor(private readonly bookpi: TinaBookPI) {}

  async install(plugin: TinaPlugin): Promise<void> {
    const { id, version, publisher, permissions } = plugin.manifest;
    if (this.plugins.has(id)) throw new Error("Plugin ya instalado");
    if (!id || !version || !publisher) throw new Error("Manifest inválido");
    if (!permissions || typeof permissions !== "object") throw new Error("Permisos requeridos");
    assertPermissionsShape(permissions);
    this.plugins.set(id, plugin);
    await this.bookpi.append("PLUGIN_INSTALLED", {
      pluginId: id,
      version,
      publisher,
      permissions,
    });
  }

  /**
   * Ejecuta un plugin con sus permisos efectivamente aplicados: primero se
   * valida la petición declarada contra el manifiest y luego el plugin opera
   * únicamente a través del guard default-deny.
   */
  async invoke(
    id: string,
    input: unknown,
    request: PluginInvocationRequest = {},
  ): Promise<unknown> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error("Plugin no encontrado");
    const permissions = plugin.manifest.permissions;

    // ISA-150: limite duro de herramientas declaradas por peticion.
    try {
      assertToolsWithinLimits(request.tools?.length ?? 0);
    } catch (error) {
      if (error instanceof LimitError) {
        await this.bookpi.append("PLUGIN_INPUT_LIMIT", {
          pluginId: id,
          code: error.code,
          limit: error.limit,
          actual: error.actual,
        });
      }
      throw error;
    }

    const declaredChecks: Array<[PluginPermissionKind, string[] | undefined, string[]]> = [
      ["read", request.reads, permissions.read],
      ["write", request.writes, permissions.write],
      ["tool", request.tools, permissions.tools],
      ["network", request.networkTargets, permissions.networkAllow],
    ];
    for (const [kind, targets, allowed] of declaredChecks) {
      for (const target of targets ?? []) {
        const normalized =
          kind === "network" ? (networkHost(target) ?? target.trim().toLowerCase()) : target;
        if (!normalized || !matches(normalized, allowed)) {
          await this.bookpi.append("PLUGIN_PERMISSION_DENIED", {
            pluginId: id,
            kind,
            target: normalized,
            phase: "pre_invoke",
          });
          throw new PluginPermissionError(kind, target, id);
        }
      }
    }

    const guard = new PluginPermissionGuard(plugin.manifest, this.bookpi);
    const out = await plugin.run(input, guard);
    await this.bookpi.append("PLUGIN_INVOKED", {
      pluginId: id,
      declared: {
        reads: request.reads ?? [],
        writes: request.writes ?? [],
        tools: request.tools ?? [],
        network: request.networkTargets ?? [],
      },
    });
    return out;
  }

  catalog(): TinaPluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }
}
