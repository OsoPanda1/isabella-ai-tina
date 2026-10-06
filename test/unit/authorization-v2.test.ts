import { describe, expect, beforeEach, it } from "vitest";
import {
  buildAuthorizationDynamicContext,
  createUuidV7,
  resetAuthorizationBehaviorState,
} from "@/lib/authorization-context";
import {
  clearAuthorizationPolicyCache,
  getAuthorizationPolicyCache,
  getAuthorizationPolicyCacheStats,
  invalidateAuthorizationCacheByPolicy,
  invalidateAuthorizationCacheBySubject,
  setAuthorizationPolicyCache,
  authorizationPolicyCacheKey,
} from "@/lib/authorization-policy-cache";

describe("Isabella native authorization v2", () => {
  beforeEach(() => {
    resetAuthorizationBehaviorState();
    clearAuthorizationPolicyCache();
  });

  it("creates RFC 9562 version-7 shaped decision identifiers", () => {
    const id = createUuidV7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("derives dynamic context without persisting raw IP or user-agent", () => {
    const first = buildAuthorizationDynamicContext(
      new Request("https://isabella.test", {
        headers: {
          "user-agent": "Mozilla/5.0 A",
          "accept-language": "es-MX",
          "x-vercel-ip-country": "MX",
          "x-vercel-ip-city": "Pachuca",
        },
      }),
      "tenant-a",
      "subject-a",
    );

    const second = buildAuthorizationDynamicContext(
      new Request("https://isabella.test", {
        headers: {
          "user-agent": "Mozilla/5.0 B",
          "accept-language": "es-MX",
          "x-vercel-ip-country": "US",
        },
      }),
      "tenant-a",
      "subject-a",
    );

    expect(first.geo_ip?.country).toBe("MX");
    expect(first.device_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.behavior_score).toBeGreaterThanOrEqual(0);
    expect(second.device_changed).toBe(true);
    expect(second.geo_mismatch).toBe(true);
    expect(JSON.stringify(second)).not.toContain("Mozilla/5.0 B");
  });

  it("caches policy outcomes while preserving granular invalidation", () => {
    const key = authorizationPolicyCacheKey({
      tenantId: "tenant-a",
      subjectId: "subject-a",
      action: "read",
      resource: "knowledge",
      role: "Guest",
      authenticated: true,
      policyVersion: "v4.1.0-native-context",
      dynamicContext: { behavior_score: 5 },
    });

    setAuthorizationPolicyCache(key, {
      tenantId: "tenant-a",
      subjectId: "subject-a",
      action: "read",
      resource: "knowledge",
      role: "Guest",
      authenticated: true,
      policyVersion: "v4.1.0-native-context",
      allow: true,
      obligations: ["log_verbose"],
      denyReason: null,
      invalidationKeys: ["tenant:tenant-a", "subject:subject-a", "policy:v4.1.0-native-context"],
    });

    expect(getAuthorizationPolicyCache(key)?.allow).toBe(true);
    expect(getAuthorizationPolicyCacheStats().hits).toBe(1);

    expect(invalidateAuthorizationCacheBySubject("subject-a")).toBe(1);
    expect(getAuthorizationPolicyCache(key)).toBeNull();

    setAuthorizationPolicyCache(key, {
      tenantId: "tenant-a",
      subjectId: "subject-a",
      action: "read",
      resource: "knowledge",
      role: "Guest",
      authenticated: true,
      policyVersion: "v4.1.0-native-context",
      allow: true,
      obligations: ["log_verbose"],
      denyReason: null,
      invalidationKeys: ["tenant:tenant-a", "subject:subject-a", "policy:v4.1.0-native-context"],
    });

    expect(invalidateAuthorizationCacheByPolicy("v4.1.0-native-context")).toBe(1);
  });
});
