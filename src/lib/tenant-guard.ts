/**
 * Tenant Isolation Guard (src/lib/tenant-guard.ts)
 * -------------------------------------------------------------
 * Enforces cross-tenant isolation boundaries.
 * No principal may access, mutate, or observe resources belonging to
 * another tenant without explicit global authorization.
 */
import { PrincipalContext } from "./principal-context";
import { SecurityError } from "./security";

export function assertTenantIsolation(
  principal: PrincipalContext,
  resourceTenantId: string,
  operation: string = "access",
): void {
  if (!resourceTenantId) {
    return; // Global un-partitioned resource
  }

  if (principal.tenantId === resourceTenantId) {
    return; // Same tenant
  }

  // Only SovereignOwner or System role may perform cross-tenant operations
  // (PrincipalContext expone un único `role` canónico; no existe `roles` ni `sub`).
  if (principal.role === "SovereignOwner" || principal.role === "System") {
    return;
  }

  throw new SecurityError(
    "TENANT_ISOLATION_VIOLATION",
    `Principal ${principal.userId} from tenant '${principal.tenantId}' is forbidden from ${operation} on tenant '${resourceTenantId}'.`,
    403,
  );
}

export default { assertTenantIsolation };
