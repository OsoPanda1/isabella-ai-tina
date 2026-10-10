import { describe, expect, it } from "vitest";
import { getFreeAICatalog, parseFreeAIEndpoints } from "@/lib/intelligence/free-ai-federation";

describe("free AI federation gate", () => {
  it("exposes local-first capabilities without claiming certification", () => {
    expect(getFreeAICatalog().map((entry) => entry.id)).toContain("ollama");
    expect(getFreeAICatalog().map((entry) => entry.license)).toContain("local-open-weight");
  });

  it("accepts only explicit HTTPS OpenAI-compatible endpoints", () => {
    const endpoints = parseFreeAIEndpoints(
      JSON.stringify([
        { id: "approved", baseUrl: "https://models.example/v1/", model: "qwen/3", requiresKey: false },
        { id: "http", baseUrl: "http://insecure.example/v1", model: "bad", requiresKey: false },
        { id: "invalid-model", baseUrl: "https://models.example/v1", model: "bad model", requiresKey: false },
      ]),
    );
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({ id: "approved", baseUrl: "https://models.example/v1", model: "qwen/3" });
  });
});
