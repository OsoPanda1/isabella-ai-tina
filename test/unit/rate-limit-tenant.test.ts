import { describe, it, expect } from "vitest";
import { SecuritySystem } from "@/lib/security";

describe("rate limiting por tenant", () => {
  it("tenant A agota 3/3 → B sigue ALLOW", () => {
    const tenantA = "tenant-a-" + Date.now();
    const tenantB = "tenant-b-" + Date.now();
    expect(SecuritySystem.checkRateLimitByTenant(tenantA, 3).allowed).toBe(true);
    expect(SecuritySystem.checkRateLimitByTenant(tenantA, 3).allowed).toBe(true);
    expect(SecuritySystem.checkRateLimitByTenant(tenantA, 3).allowed).toBe(true);
    expect(SecuritySystem.checkRateLimitByTenant(tenantA, 3).allowed).toBe(false);
    expect(SecuritySystem.checkRateLimitByTenant(tenantB, 3).allowed).toBe(true);
  });
});
