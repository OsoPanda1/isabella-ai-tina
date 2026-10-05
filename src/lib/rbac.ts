/**
 * RBAC — CONTROL DE ACCESO BASADO EN ROLES (src/lib/rbac.ts)
 * -----------------------------------------------------------------
 * Fuente de verdad de roles, herencia de roles y resolución de
 * permisos para Isabella Villaseñor AI v4.2.0.
 *
 * Principios de gobernanza (C.R.O.W.N.):
 *  - Mínimo privilegio: cada identidad recibe el menor conjunto de
 *    permisos necesario para su responsabilidad.
 *  - Hierarquía soberana: un rol puede heredar permisos de roles de
 *    menor privilegio (nunca a la inversa).
 *  - Fail-closed: un permiso inexistente o un rol desconocido se
 *    resuelven siempre a `denied`.
 *
 * Este módulo es autoridad declarativa. La DECISIÓN de autorización se
 * toma en `authorization.ts` (que combina RBAC + ABAC + contexto).
 * Ningún handler de ruta decide permisos por sí mismo.
 */

/**
 * Roles canónicos del dominio. `SovereignOwner` es el rol de máxima
 * responsabilidad y es el único que puede administrar gobernanza.
 */
export type Role =
  "SovereignOwner" | "Operator" | "Auditor" | "Guest" | "System" | "governance_admin";

export const ROLES: readonly Role[] = [
  "SovereignOwner",
  "Operator",
  "Auditor",
  "Guest",
  "System",
  "governance_admin",
];

/** Guía de responsabilidad de cada rol (documental, no autoritativa). */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SovereignOwner: "Propietario soberano del nodo: gobierno, administración y moneda.",
  Operator: "Operador comunitario autorizado para operaciones de tenant.",
  Auditor: "Auditoría y verificación de cadena / cumplimiento (solo lectura).",
  Guest: "Acceso público no autenticado con privilegios mínimos.",
  System: "Identidad de sistema para trabajos internos autorizados.",
  governance_admin: "Administración de políticas, constitución y permisos.",
};

/** Mapa completo de herencia entre roles (el rol hereda de su lista). */
// Mínimo privilegio: jerarquía estricta hacia abajo. Nunca se heredan r
// permisos de roles de mayor privilegio si no son estrictamente necesarios.
const ROLE_INHERITANCE: Record<Role, readonly Role[]> = {
  // El propietario soberano es el único rol con acceso completo al sistema.
  SovereignOwner: ["governance_admin", "Operator", "Auditor", "System", "Guest"],
  // governance_admin administra gobernanza y lee auditoría/ledger; NO hereda
  // privilegios de Operator (sandbox/http) ni System (telemetría de sistema).
  governance_admin: ["Auditor", "Guest"],
  Operator: ["Guest"],
  Auditor: ["Guest"],
  System: [],
  Guest: [],
};

export interface PrincipalIdentity {
  /** Identificador del actor (sub). */
  subject: string;
  /** Nombre de usuario estable (no secretos). */
  username: string;
  /** Tenant al que pertenece el actor. */
  tenantId: string;
  /** Rol resuelto de la identidad. */
  role: Role;
  /** Ámbitos (scopes) concedidos al token, p. ej. "openid profile". */
  scopes: readonly string[];
  /** Autenticación de la identidad. */
  authenticated: boolean;
}

/** Evaluación de un permiso para un recurso/acción dado. */
export interface PermissionCheck {
  allowed: boolean;
  permission: string;
  reason: string;
}

const PERMISSION_NOT_GRANTED = "Permiso no concedido (fail-closed)";
const PERMISSION_NOT_DEFINED = "Permiso no definido en el catálogo";

/**
 * Expande un rol a sí mismo más todos los roles de los que hereda,
 * en orden de mayor a menor privilegio.
 */
export function resolveRoleChain(role: Role): Role[] {
  const chain = new Set<Role>([role]);
  const visit = (current: Role): void => {
    for (const parent of ROLE_INHERITANCE[current]) {
      if (!chain.has(parent)) {
        chain.add(parent);
        visit(parent);
      }
    }
  };
  visit(role);
  return [...chain];
}

/**
 * Determina si una identidad posee un permiso, evaluando el rol
 * y la cadena de herencia. Nunca lanza: resuelve fail-closed.
 */
export function identityHasPermission(
  identity: Pick<PrincipalIdentity, "role">,
  permission: string,
): boolean {
  if (!permission || permission.length === 0) return false;
  if (!ROLES.includes(identity.role)) return false;
  for (const role of resolveRoleChain(identity.role)) {
    if (grantedPermissions(role).has(permission)) return true;
  }
  return false;
}

/**
 * Verifica un permiso devolviendo un resultado estructurado para
 * auditoría y mensajes seguros.
 */
export function checkPermission(
  identity: Pick<PrincipalIdentity, "role">,
  permission: string,
): PermissionCheck {
  if (!ROLES.includes(identity.role)) {
    return {
      allowed: false,
      permission,
      reason: `Rol desconocido '${identity.role}'`,
    };
  }
  if (identityHasPermission(identity, permission)) {
    return {
      allowed: true,
      permission,
      reason: `Permiso concedido por rol '${identity.role}' (incluye herencia).`,
    };
  }
  return {
    allowed: false,
    permission,
    reason: grantedPermissions(identity.role).has(permission)
      ? PERMISSION_NOT_GRANTED
      : PERMISSION_NOT_DEFINED,
  };
}

/**
 * Devuelve el conjunto completo de permisos de un rol (incluida
 * su herencia). Usado para telemetría y la matriz de autorización.
 */
export function grantedPermissions(role: Role): ReadonlySet<string> {
  const out = new Set<string>();
  for (const r of resolveRoleChain(role)) {
    for (const permission of ROLE_PERMISSIONS[r]) out.add(permission);
  }
  return out;
}

/** Todos los permisos del sistema (registro declarativo). */
export const PERMISSIONS = {
  // Memoria
  "memory:read:own": "Leer memoria propia",
  "memory:read:territorial": "Leer memoria territorial",
  "memory:read:restricted": "Leer memoria restringida",
  "memory:write:own": "Escribir memoria propia",
  "memory:delete:own": "Eliminar memoria propia",
  "memory:admin": "Administrar memoria de terceros",
  // BookPI / ledger
  "ledger:read:own": "Leer libro mayor propio",
  "ledger:read:any": "Leer libro mayor de cualquier actor",
  "ledger:write": "Registrar operaciones en el libro mayor",
  "ledger:refund": "Reembolsar operaciones del libro mayor",
  "ledger:verify": "Verificar integridad de la cadena",
  // Auditoría
  "audit:write": "Registrar eventos de auditoría",
  "audit:read": "Leer registros de auditoría",
  "audit:verify": "Verificar cadena de auditoría",
  // Datos personales
  "data:personal:process": "Procesar datos personales",
  "data:personal:export": "Exportar datos personales propios",
  // Gobernanza
  "governance:read": "Consultar políticas y constitución",
  "governance:write": "Modificar políticas y constitución",
  "permission:grant": "Conceder permisos a identidades",
  "permission:revoke": "Revocar permisos a identidades",
  // Herramientas / sandbox
  "tool:list": "Listar herramientas registradas",
  "tool:execute:readonly": "Ejecutar herramientas de solo lectura",
  "tool:execute": "Ejecutar herramientas autorizadas",
  "sandbox:run": "Ejecutar tareas en sandbox aislado",
  // Monetización
  "monetization:read": "Consultar estado de monetización",
  "monetization:configure": "Configurar métodos de monetización",
  "monetization:withdraw": "Solicitar retiros",
  // Sistema / telemetría
  "system:state": "Consultar estado del sistema",
  "system:telemetry": "Consultar telemetría operativa",
  "system:admin": "Operaciones administrativas del sistema",
  "system:execute": "Ejecutar operaciones internas del sistema (rol operativo)",
  "chat:execute": "Conversar con Isabella en el turno de chat",
  "session:read": "Consultar la sesion de la propia identidad",
} as const satisfies Record<string, string>;

export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

/**
 * Asignación declarativa de permisos por rol (base, sin herencia).
 * Define el mínimo privilegio de cada rol.
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Guest: acceso público no autenticado con privilegios mínimos. Puede chatear con Isabella (system:telemetry) y leer memoria propia.
  Guest: [
    "memory:read:own",
    "ledger:read:own",
    "governance:read",
    "tool:list",
    "monetization:read",
    "system:telemetry",
    "chat:execute",
    "session:read",
  ],
  System: [
    "audit:write",
    "ledger:verify",
    "tool:list",
    "tool:execute:readonly",
    "system:state",
    "system:telemetry",
    "system:execute",
    "chat:execute",
    "session:read",
  ],
  Auditor: [
    "ledger:read:any",
    "ledger:verify",
    "audit:read",
    "audit:verify",
    "governance:read",
    "system:state",
    "chat:execute",
    "session:read",
  ],
  Operator: [
    "memory:write:own",
    "memory:delete:own",
    "memory:read:territorial",
    "ledger:write",
    "tool:execute",
    "sandbox:run",
    "monetization:configure",
    "monetization:withdraw",
    "system:state",
    "system:telemetry",
    "system:execute",
    "chat:execute",
    "session:read",
  ],
  governance_admin: [
    "governance:write",
    "permission:grant",
    "permission:revoke",
    "memory:admin",
    "system:admin",
    "system:state",
    "ledger:read:any",
    "audit:read",
    "system:execute",
    "chat:execute",
    "session:read",
  ],
  SovereignOwner: [
    "ledger:refund",
    "permission:grant",
    "permission:revoke",
    "memory:admin",
    "system:admin",
    "governance:write",
    "system:execute",
    "chat:execute",
    "session:read",
  ],
};

for (const role of ROLES) {
  for (const permission of ROLE_PERMISSIONS[role]) {
    if (!(permission in PERMISSIONS)) {
      throw new Error(`RBAC: permiso '${permission}' no declarado en el catálogo`);
    }
  }
}

/** Exposición de utilidad para telemetría. */
export const RBAC = {
  roles: ROLES,
  permissions: ALL,
  roleDescriptions: ROLE_DESCRIPTIONS,
  resolveRoleChain,
  identityHasPermission,
  checkPermission,
  grantedPermissions,
};
