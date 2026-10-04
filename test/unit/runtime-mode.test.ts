import { describe, expect, it } from "vitest";
import { isProductionLike, resolveRuntimeMode } from "@/lib/runtime-mode";

describe("production runtime mode contract", () => {
  it("treats emergency and maintenance as production-grade boundaries", () => {
    expect(resolveRuntimeMode("emergency")).toBe("production");
    expect(resolveRuntimeMode("maintenance")).toBe("production");
    expect(isProductionLike(resolveRuntimeMode("emergency"))).toBe(true);
    expect(isProductionLike(resolveRuntimeMode("maintenance"))).toBe(true);
  });

  it("preserves explicit staging and development behavior", () => {
    expect(resolveRuntimeMode("staging")).toBe("staging");
    expect(isProductionLike("staging")).toBe(true);
    expect(resolveRuntimeMode("development")).toBe("development");
    expect(isProductionLike("development")).toBe(false);
  });

  it("remains compatible with zero-argument environment resolution", () => {
    expect(["development", "test", "production", "staging"]).toContain(resolveRuntimeMode());
  });
});
