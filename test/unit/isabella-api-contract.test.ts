import { describe, expect, it } from "vitest";
import {
  IsabellaChatRequestSchema,
  StandardResponseSchema,
  standardError,
} from "@/lib/api-contracts";

describe("Isabella API contract", () => {
  it("accepts the canonical text conversation shape", () => {
    const result = IsabellaChatRequestSchema.safeParse({
      temperature: 0.7,
      messages: [
        { role: "user", content: "Explica el estado del sistema." },
        {
          role: "assistant",
          content: "Puedo hacerlo con evidencia disponible.",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts multimodal image and audio blocks without weakening size limits", () => {
    const result = IsabellaChatRequestSchema.safeParse({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Analiza estos materiales." },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AA==" },
            },
            {
              type: "input_audio",
              input_audio: { data: "AA==", format: "wav" },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed roles and out-of-range temperature", () => {
    expect(
      IsabellaChatRequestSchema.safeParse({
        messages: [{ role: "system", content: "x" }],
      }).success,
    ).toBe(false);
    expect(
      IsabellaChatRequestSchema.safeParse({
        temperature: 3,
        messages: [{ role: "user", content: "x" }],
      }).success,
    ).toBe(false);
  });

  it("emits the standard non-streaming error envelope", async () => {
    const response = standardError(
      "PROVIDER_UNAVAILABLE",
      "Proveedor no disponible.",
      "00000000-0000-4000-8000-000000000001",
      "trace-test",
      { status: 503, retryable: true },
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(StandardResponseSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(body.error.retryable).toBe(true);
  });
});
