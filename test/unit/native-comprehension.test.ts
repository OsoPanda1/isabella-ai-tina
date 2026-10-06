import { vi, beforeEach } from "vitest";
import { describe, expect, it } from "vitest";
import { runNativeComprehension } from "@/lib/native-comprehension";

describe("native comprehension conectada al runtime", () => {
  beforeEach(async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    const { resetConfigCache } = await import("@/lib/config");
    resetConfigCache();
  });
  it("respeta el ciclo de vida del tenant y el trace", () => {
    const a = runNativeComprehension({
      input: "hola",
      tenantId: "t-a",
      traceId: "trace-a",
    });
    const b = runNativeComprehension({
      input: "hola",
      tenantId: "t-b",
      traceId: "trace-b",
    });
    expect(a.id).not.toBe(b.id);
    expect(a.intent.detected).toBe(b.intent.detected);
  });
});
