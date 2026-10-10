import { describe, expect, it } from "vitest";
import { createNativeLearningApi } from "../../src/lib/isabella-learning-api";
import { createIsabellaLearningEngine } from "../../src/lib/isabella-learning";

describe("Native Isabella learning API", () => {
  it("validates and ingests learning records", async () => {
    const api = createNativeLearningApi(createIsabellaLearningEngine());
    const response = api.ingest({
      mode: "supervised",
      input: "La procedencia es obligatoria.",
      target: "accepted",
      outcome: "success",
      quality: 1,
      consent: false,
      source: "api-test",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(true);
  });

  it("rejects malformed retrieval payloads", async () => {
    const api = createNativeLearningApi(createIsabellaLearningEngine());
    const response = api.retrieve({ limit: 1000 });
    expect(response.status).toBe(400);
  });
});
