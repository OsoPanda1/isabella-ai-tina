/**
 * Isabella Voice Route (src/server-routes/api/isabella-voice.ts)
 * -------------------------------------------------------------
 * Fail-closed speech synthesis route:
 * In production without configured voice provider: returns 503 maintenance.
 * In development: provides native speech synthesis metadata.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { config } from "../../lib/config";
import { isProductionLike } from "../../lib/runtime-mode";
import { withSovereignAuth } from "@/lib/principal-context";
import { SecuritySystem } from "@/lib/security";

const bodySchema = z.object({
  text: z.string().min(1).max(4000),
  voiceId: z.string().min(1).max(128).optional(),
  speed: z.number().min(0.5).max(2).optional(),
});

export const Route = createFileRoute("/api/isabella-voice")({
  server: {
    handlers: {
      POST: withSovereignAuth("system", "execute", async (context, request) => {
        const rateLimit = SecuritySystem.checkRateLimit(context.ip, 30);
        if (!rateLimit.allowed) {
          const h = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          return new Response(JSON.stringify({ error: "Límite de voz 30/min" }), {
            status: 429,
            headers: h,
          });
        }
        const raw = await request.json().catch(() => ({}));
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          const h = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          return new Response(
            JSON.stringify({ error: "Invalid request body", details: parsed.error.issues }),
            { status: 400, headers: h },
          );
        }
        const { text, voiceId, speed } = parsed.data;
        const sanitized = SecuritySystem.sanitizePayload(text);
        if (sanitized.flagged) {
          const h = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          return new Response(JSON.stringify({ error: `Filtro hostil: ${sanitized.reason}` }), {
            status: 403,
            headers: h,
          });
        }

        const runtime = config();
        const hasVoiceProvider = Boolean(runtime.ELEVENLABS_API_KEY || runtime.GOOGLE_TTS_API_KEY);

        if (isProductionLike() && !hasVoiceProvider) {
          const h = SecuritySystem.injectSecureHeaders(
            new Headers({ "content-type": "application/json" }),
          );
          return new Response(
            JSON.stringify({
              error: "VOICE_PROVIDER_UNAVAILABLE",
              message:
                "Speech synthesis provider is currently undergoing maintenance in production.",
              status: "fail_closed",
            }),
            { status: 503, headers: h },
          );
        }

        const h = SecuritySystem.injectSecureHeaders(
          new Headers({
            "content-type": "application/json",
            "x-isabella-trace-id": context.traceId,
          }),
        );
        return new Response(
          JSON.stringify({
            ok: true,
            textLength: sanitized.clean.length,
            voiceId: voiceId ?? "isabella-sovereign-neural",
            speed: speed ?? 1.0,
            audioFormat: "audio/mp3",
            timestamp: new Date().toISOString(),
          }),
          { status: 200, headers: h },
        );
      }),
    },
  },
});
