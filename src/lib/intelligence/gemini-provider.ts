import { secrets } from "@/lib/secrets";
import { SecuritySystem } from "@/lib/security";
import type { IntelligenceProvider, IntelligenceRequest, IntelligenceResponse } from "./contracts";

export class GeminiProvider implements IntelligenceProvider {
  readonly providerId = "google-gemini";
  readonly modelId: string;
  readonly capabilities = new Set(["text", "image"] as const);

  constructor(modelId = "gemini-3.8-flash") {
    this.modelId = modelId;
  }

  async health(): Promise<boolean> {
    try {
      return Boolean(secrets.getOptional("GEMINI_API_KEY"));
    } catch {
      return false;
    }
  }

  async invoke(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    const apiKey = secrets.get("GEMINI_API_KEY");
    const started = performance.now();
    const contents = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const system = request.messages.find((m) => m.role === "system")?.content;
    const upstream = await SecuritySystem.fetchSafeUpstream(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelId)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          generationConfig: {
            temperature: request.temperature ?? 0.7,
            maxOutputTokens: request.maxTokens ?? 2048,
          },
        }),
      },
    );
    if (!upstream.ok) throw new Error(`Gemini upstream returned ${upstream.status}`);
    const payload = (await upstream.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("Gemini returned no text");
    return {
      requestId: request.requestId,
      modelId: this.modelId,
      providerId: this.providerId,
      text,
      latencyMs: performance.now() - started,
      degraded: false,
      risk: "LOW",
    };
  }
}
