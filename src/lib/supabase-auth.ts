/**
 * Supabase Auth Mapping (src/lib/supabase-auth.ts)
 * -------------------------------------------------------------
 * Safely maps incoming Supabase JWT claims and metadata to the
 * sovereign RBAC role taxonomy.
 */
import { ROLES, type Role } from "./rbac";

export function mapSupabaseRole(rawRole: unknown): Role {
  if (typeof rawRole !== "string") {
    return "Guest";
  }

  const normalized = rawRole.trim().toLowerCase();
  for (const role of ROLES) {
    if (role.toLowerCase() === normalized) {
      // Untrusted external providers cannot grant SovereignOwner or governance_admin directly
      if (role === "SovereignOwner" || role === "governance_admin") {
        return "Operator";
      }
      return role;
    }
  }

  if (normalized === "authenticated" || normalized === "user") {
    return "Guest";
  }

  return "Guest";
}

export default { mapSupabaseRole };
