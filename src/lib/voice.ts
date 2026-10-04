let currentAbort: AbortController | null = null;
let currentCtx: AudioContext | null = null;

export function stopVoice() {
  currentAbort?.abort();
  currentAbort = null;
  void currentCtx?.close().catch(() => {});
  currentCtx = null;
}

/**
 * Reproduce la voz de Isabella en streaming (PCM 24kHz vía SSE).
 * Resuelve cuando terminó de programarse todo el audio.
 */
export async function speakIsabella(text: string): Promise<void> {
  stopVoice();

  const controller = new AbortController();
  currentAbort = controller;

  const ctx = new AudioContext({ sampleRate: 24000 });
  currentCtx = ctx;
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});

  let playhead = 0;
  let pending = new Uint8Array(0);

  const playChunk = (incoming: Uint8Array) => {
    const bytes = new Uint8Array(pending.length + incoming.length);
    bytes.set(pending);
    bytes.set(incoming, pending.length);
    const usable = bytes.length - (bytes.length % 2);
    pending = bytes.slice(usable);
    if (usable === 0) return;
    const samples = new Int16Array(bytes.buffer, 0, usable / 2);
    const floats = Float32Array.from(samples, (s) => s / 32768);
    const buffer = ctx.createBuffer(1, floats.length, 24000);
    buffer.copyToChannel(floats, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    if (playhead === 0) playhead = ctx.currentTime + 0.05;
    else playhead = Math.max(playhead, ctx.currentTime);
    source.start(playhead);
    playhead += buffer.duration;
  };

  const { getSessionToken } = await import("@/lib/auth-client");
  const token = getSessionToken();
  if (!token) {
    stopVoice();
    throw new Error("ARGUS requiere una sesión autorizada para activar la voz.");
  }

  const res = await fetch("/api/isabella-voice", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: controller.signal,
    body: JSON.stringify({ text: text.slice(0, 4000) }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => ({ error: "Fallo de síntesis vocal." }));
    stopVoice();
    throw new Error(detail.error ?? "Fallo de síntesis vocal.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as { type?: string; audio?: string };
        if (json.type !== "speech.audio.delta" || !json.audio) continue;
        const binary = atob(json.audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        playChunk(bytes);
      } catch {
        /* fragmento parcial */
      }
    }
  }

  const remaining = Math.max(0, playhead - ctx.currentTime);
  await new Promise((r) => setTimeout(r, remaining * 1000 + 120));
  if (currentAbort === controller) stopVoice();
}
