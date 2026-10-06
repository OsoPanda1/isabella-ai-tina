/**
 * Permission Matrix (src/lib/permission-matrix.ts)
 * -------------------------------------------------------------
 * Canonical resource-action mapping to permissions for the
 * Policy Decision Point (PDP).
 */

export const RESOURCES = [
  "governance",
  "policy",
  "tool",
  "memory",
  "audit",
  "quantum",
  "billing",
  "marketplace",
  "ai",
  "voice",
  "session",
  "user",
  "system",
  "data:personal",
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = [
  "read",
  "write",
  "execute",
  "manage",
  "delete",
  "publish",
  "synthesize",
  "inference",
] as const;

export type Action = (typeof ACTIONS)[number];

export interface DerivedPermission {
  permission: string | null;
  reason?: string;
}

export function permissionFor(resource: Resource, action: Action): DerivedPermission {
  // Mapping specific combinations to standard permissions
  if (resource === "tool" && action === "execute") {
    return { permission: "tool:execute" };
  }
  if (resource === "ai" && (action === "inference" || action === "execute" || action === "read")) {
    return { permission: "ai:inference" };
  }
  if (resource === "voice" && (action === "synthesize" || action === "execute")) {
    return { permission: "voice:synthesize" };
  }
  if (resource === "marketplace" && action === "publish") {
    return { permission: "marketplace:publish" };
  }
  if (resource === "quantum" && action === "execute") {
    return { permission: "quantum:execute" };
  }

  // Standard resource:action combination
  const permission = `${resource}:${action}`;
  return { permission };
}

export default { RESOURCES, ACTIONS, permissionFor };
