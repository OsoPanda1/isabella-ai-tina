import { useEffect, useRef, useState } from "react";
import { MODULES } from "@/lib/crown-ui";
import { speakIsabella, stopVoice } from "@/lib/voice";
import type { TerminalMessage } from "@/lib/useIsabella";
import { ThumbsUp, ThumbsDown, Check, MessageSquare, X } from "lucide-react";

function VoiceButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "playing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => stopVoice(), []);

  const toggle = async () => {
    if (state === "playing") {
      stopVoice();
      setState("idle");
      return;
    }
    setState("playing");
    setError(null);
    try {
      await speakIsabella(text);
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fallo de síntesis vocal.");
      setState("error");
    }
  };

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={state === "playing" ? "Detener voz de Isabella" : "Escuchar voz de Isabella"}
        className="rounded-lg border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-platinum"
      >
        {state === "playing" ? "◼ Silenciar voz" : "▶ Voz de Isabella"}
      </button>
      {error && (
        <span role="status" className="font-mono text-[10px] text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}

function FeedbackRatingButtons({ messageId, content }: { messageId: string; content: string }) {
  const [rating, setRating] = useState<"up" | "down" | null>(() => {
    try {
      const stored = localStorage.getItem(`isabella_feedback_${messageId}`);
      return (stored as "up" | "down") || null;
    } catch {
      return null;
    }
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [savedBadge, setSavedBadge] = useState<string | null>(null);

  const saveFeedback = (r: "up" | "down", cat?: string) => {
    const nextRating = rating === r && !cat ? null : r;
    setRating(nextRating);
    try {
      if (nextRating) {
        localStorage.setItem(`isabella_feedback_${messageId}`, nextRating);
        const stored = localStorage.getItem("isabella_model_feedback_log");
        const list = stored ? JSON.parse(stored) : [];
        list.push({
          messageId,
          rating: nextRating,
          category: cat || category,
          timestamp: new Date().toISOString(),
          contentSnippet: content.slice(0, 100),
        });
        localStorage.setItem("isabella_model_feedback_log", JSON.stringify(list.slice(-100)));
        setSavedBadge(nextRating === "up" ? "Útil" : "Señalado");
      } else {
        localStorage.removeItem(`isabella_feedback_${messageId}`);
        setSavedBadge(null);
      }
    } catch {
      // storage unavailable
    }
    if (nextRating === "down") {
      setDetailsOpen(true);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => saveFeedback("up")}
          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-all cursor-pointer ${
            rating === "up"
              ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300 font-bold"
              : "border-border text-muted-foreground hover:text-emerald-400 hover:border-emerald-500/30"
          }`}
          title="Respuesta útil y de alta calidad"
        >
          <ThumbsUp
            className={`w-3 h-3 ${rating === "up" ? "text-emerald-400 fill-emerald-400/20" : ""}`}
          />
          <span>Útil</span>
        </button>

        <button
          type="button"
          onClick={() => saveFeedback("down")}
          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-all cursor-pointer ${
            rating === "down"
              ? "border-rose-500/50 bg-rose-500/20 text-rose-300 font-bold"
              : "border-border text-muted-foreground hover:text-rose-400 hover:border-rose-500/30"
          }`}
          title="Señalar imprecisión o respuesta mejorable"
        >
          <ThumbsDown
            className={`w-3 h-3 ${rating === "down" ? "text-rose-400 fill-rose-400/20" : ""}`}
          />
          <span>Mejorar</span>
        </button>

        {savedBadge && (
          <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1 ml-1">
            <Check className="w-2.5 h-2.5 text-emerald-400" />
            <span>{category || savedBadge}</span>
          </span>
        )}

        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="text-muted-foreground hover:text-platinum p-1"
          title="Detallar retroalimentación"
        >
          <MessageSquare className="w-3 h-3" />
        </button>
      </div>

      {detailsOpen && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] font-mono animate-in fade-in">
          {(rating === "down"
            ? ["Alucinación", "Prosodia / Tono", "Incompleto", "Citas faltantes"]
            : ["Precisión alta", "Excelente empatía", "Dialéctica CROWN", "Resolución óptima"]
          ).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCategory(c);
                saveFeedback(rating || "up", c);
                setDetailsOpen(false);
              }}
              className="px-2 py-0.5 rounded border border-border/80 bg-secondary/40 text-platinum hover:border-electric transition-colors"
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDetailsOpen(false)}
            className="p-1 text-muted-foreground hover:text-platinum"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
      {label}
      <span className="text-platinum/90"> {value}</span>
    </span>
  );
}

export function MessageStream({
  messages,
  onRetry,
}: {
  messages: TerminalMessage[];
  onRetry: () => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  // Reactive signature detecting both new messages and real-time streaming/synthesis growth
  const contentSignature = messages
    .map((m) => `${m.id}:${m.content.length}:${m.streaming ? 1 : 0}`)
    .join("|");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [contentSignature]);

  return (
    <div className="flex flex-col gap-6 px-5 py-7 sm:px-9">
      {messages.map((m) => {
        if (m.role === "system") {
          return (
            <div key={m.id} className="animate-rise flex justify-center">
              <p className="max-w-2xl text-center font-mono text-[10px] uppercase leading-relaxed tracking-[0.24em] text-muted-foreground">
                {m.content}
              </p>
            </div>
          );
        }

        if (m.role === "user") {
          return (
            <div key={m.id} className="animate-rise flex justify-end">
              <div className="glass max-w-[86%] rounded-2xl rounded-br-sm px-5 py-4 sm:max-w-[70%]">
                <div className="mb-1.5 flex items-center justify-between gap-6">
                  <Meta label="OPERADOR" value="ANUBIS" />
                  <span className="font-mono text-[10px] text-muted-foreground">{m.timestamp}</span>
                </div>
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
                  {m.content}
                </p>
              </div>
            </div>
          );
        }

        const mod = m.decision ? MODULES[m.decision.primary] : MODULES.CROWN;
        return (
          <div key={m.id} className="animate-rise flex justify-start">
            <div
              className="glass-strong w-full max-w-[94%] rounded-2xl rounded-bl-sm px-5 py-5 sm:px-7 sm:py-6"
              style={{
                borderColor: m.error ? "var(--destructive)" : mod.color,
                boxShadow: `0 0 60px -30px ${m.error ? "var(--destructive)" : mod.color}`,
              }}
            >
              <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-border/50 pb-3">
                <span
                  className="font-mono text-[11px] tracking-[0.3em]"
                  style={{ color: m.error ? "var(--destructive)" : mod.color }}
                >
                  ISABELLA · {mod.acronym}
                </span>
                {m.decision && (
                  <>
                    <Meta label="TRACE" value={m.decision.traceId} />
                    <Meta label="GATE" value={m.decision.policy.toUpperCase()} />
                    <Meta label="RIESGO" value={m.decision.risk.toUpperCase()} />
                    <Meta label="TONO" value={m.decision.emotionalTone} />
                  </>
                )}
                {m.degraded === true && (
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-400">
                    Degradado · {m.provider ?? "origen alterno"} (no es inferencia LLM)
                  </span>
                )}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {m.timestamp}
                </span>
              </div>

              <p
                className="whitespace-pre-wrap text-[15.5px] leading-[1.75] text-foreground/95"
                aria-live={m.streaming ? "polite" : undefined}
                aria-busy={m.streaming}
              >
                {m.content}
                {m.streaming && (
                  <span className="animate-caret ml-0.5 inline-block h-4 w-[7px] translate-y-0.5 bg-electric" />
                )}
              </p>

              {m.decision && !m.error && (
                <p className="mt-4 border-t border-border/40 pt-3 text-[11px] italic leading-relaxed text-muted-foreground">
                  {m.decision.rationale} · {m.decision.policyReason}
                </p>
              )}

              {!m.error && !m.streaming && m.content.trim() && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <VoiceButton text={m.content} />
                  <FeedbackRatingButtons messageId={m.id} content={m.content} />
                </div>
              )}

              {m.error && (
                <button
                  onClick={onRetry}
                  className="mt-4 rounded-lg border border-border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-platinum transition-colors hover:bg-secondary/60"
                >
                  Reintentar percepción
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
