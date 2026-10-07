/**
 * Isabella Voice Route (src/server-routes/api/isabella-voice.ts)
 * -------------------------------------------------------------
 * Fail-closed speech synthesis route:
 * In production without configured voice provider: returns 503 maintenance.
 * In development: provides native speech synthesis metadata.
 */
import { createFileRoute } from "@tanstack/react-router";
import { config } from "../../lib/config";
import { isProductionLike } from "../../lib/runtime-mode";

export const Route = createFileRoute("/api/isabella-voice")({
  server: {
    handlers: {
      POST: async ({ request }: IsabellaRouteContext) => {
        const body = (await request.json().catch(() => ({}))) as {
          text?: unknown;
          voiceId?: unknown;
          speed?: unknown;
        };
        const { text, voiceId, speed } = body;
        if (!text || typeof text !== "string") {
          return new Response(JSON.stringify({ error: "Missing required text field" }), {
            status: 400,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }

        const runtime = config();
        const hasVoiceProvider = Boolean(runtime.ELEVENLABS_API_KEY || runtime.GOOGLE_TTS_API_KEY);

        if (isProductionLike() && !hasVoiceProvider) {
          return new Response(
            JSON.stringify({
              error: "VOICE_PROVIDER_UNAVAILABLE",
              message:
                "Speech synthesis provider is currently undergoing maintenance in production.",
              status: "fail_closed",
            }),
            { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } },
          );
        }

        return new Response(
          JSON.stringify({
            ok: true,
            textLength: text.length,
            voiceId: typeof voiceId === "string" ? voiceId : "isabella-sovereign-neural",
            speed: typeof speed === "number" ? speed : 1.0,
            audioFormat: "audio/mp3",
            timestamp: new Date().toISOString(),
          }),
          { headers: { "Content-Type": "application/json; charset=utf-8" } },
        );
      },
    },
  },
});
