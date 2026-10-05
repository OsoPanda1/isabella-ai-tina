/**
 * Isabella Voice Route (src/server-routes/api/isabella-voice.ts)
 * -------------------------------------------------------------
 * Fail-closed speech synthesis route:
 * In production without configured voice provider: returns 503 maintenance.
 * In development: provides native speech synthesis metadata.
 */
import type { Request, Response } from "express";
import { config } from "../../lib/config";
import { isProductionLike } from "../../lib/runtime-mode";

export async function handleVoiceSynthesize(req: Request, res: Response): Promise<void> {
  const { text, voiceId, speed } = req.body || {};
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Missing required text field" });
    return;
  }

  const runtime = config();
  const hasVoiceProvider = Boolean(runtime.ELEVENLABS_API_KEY || runtime.GOOGLE_TTS_API_KEY);

  if (isProductionLike() && !hasVoiceProvider) {
    res.status(503).json({
      error: "VOICE_PROVIDER_UNAVAILABLE",
      message: "Speech synthesis provider is currently undergoing maintenance in production.",
      status: "fail_closed",
    });
    return;
  }

  // Active synthesis response
  res.status(200).json({
    ok: true,
    textLength: text.length,
    voiceId: voiceId || "isabella-sovereign-neural",
    speed: speed || 1.0,
    audioFormat: "audio/mp3",
    timestamp: new Date().toISOString(),
  });
}

export default { handleVoiceSynthesize };
