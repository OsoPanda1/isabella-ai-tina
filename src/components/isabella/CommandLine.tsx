import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  Globe,
  Mic,
  MicOff,
  Paperclip,
  Send,
  Settings2,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";
import { fileToDataUrl, humanSize, MAX_ATTACHMENT_BYTES, type Attachment } from "@/lib/attachments";
import { usePerformanceMonitor } from "@/hooks/usePerformanceMonitor";
const uid = () => crypto.randomUUID();
const THEME_KEY = "isabella.cognitive-theme.v1";
const themes = {
  abyss: { label: "Abyss", accent: "electric" },
  arctic: { label: "Arctic", accent: "cyan" },
  aurora: { label: "Aurora", accent: "violet" },
  ember: { label: "Ember", accent: "amber" },
} as const;
type ThemeId = keyof typeof themes;
export type ExecutionMode = "fast" | "deep_reasoning" | "web_research" | "agent_tools";
export interface ExtendedAttachment extends Attachment {
  tokenEstimate?: number;
}
export interface CommandLineProps {
  onSend: (
    value: string,
    attachments: ExtendedAttachment[],
    config: { mode: ExecutionMode; webSearch: boolean; toolsEnabled: boolean },
  ) => void;
  onStop: () => void;
  onReset: () => void;
  isProcessing: boolean;
}
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string; isFinal: boolean }>>;
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}
function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.cognitiveTheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* persistence unavailable */
  }
}
function readTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY) as ThemeId | null;
    return stored && stored in themes ? stored : "abyss";
  } catch {
    return "abyss";
  }
}
function sentimentFromText(text: string): { label: string; glyph: string } {
  const normalized = text.toLocaleLowerCase("es-MX");
  if (!normalized.trim()) return { label: "EN ESPERA", glyph: "·" };
  const risk =
    /\b(error|fallo|riesgo|amenaza|bloquead|peligro|crítico|critico|rechaz|violencia)\b/.test(
      normalized,
    );
  const positive =
    /\b(listo|correcto|éxito|exito|estable|seguro|avance|resuelto|gracias|excelente)\b/.test(
      normalized,
    );
  if (risk) return { label: "ALERTA", glyph: "!" };
  if (positive) return { label: "ESTABLE", glyph: "+" };
  return { label: "ANALIZANDO", glyph: "~" };
}
export function CommandLine({ onSend, onStop, onReset, isProcessing }: CommandLineProps) {
  const { startTrack } = usePerformanceMonitor("CommandLine");
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ExtendedAttachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>("abyss");
  const [showSettings, setShowSettings] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("fast");
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [showCommandsMenu, setShowCommandsMenu] = useState(false);
  const [cognitiveText, setCognitiveText] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const inputId = useId();
  useEffect(() => {
    const initial = readTheme();
    setTheme(initial);
    applyTheme(initial);
    const onStream = (event: Event) => {
      const custom = event as CustomEvent<{ text?: string }>;
      if (typeof custom.detail?.text === "string")
        setCognitiveText(custom.detail.text.slice(-5000));
    };
    window.addEventListener("isabella:cognitive-stream", onStream);
    return () => window.removeEventListener("isabella:cognitive-stream", onStream);
  }, []);
  useEffect(() => {
    const updateFromStream = () => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("[aria-live='polite']"));
      const latest = nodes.at(-1)?.textContent?.trim();
      if (latest) setCognitiveText(latest.slice(-5000));
    };
    updateFromStream();
    const observer = new MutationObserver(updateFromStream);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setRecSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);
  const submit = useCallback(() => {
    const text = value.trim();
    if ((!text && attachments.length === 0) || isProcessing) return;
    const stopTrack = startTrack(`Transmit Prompt (${executionMode})`);
    onSend(text, attachments, { mode: executionMode, webSearch: webSearchEnabled, toolsEnabled });
    setValue("");
    setAttachments([]);
    setShowCommandsMenu(false);
    stopTrack();
  }, [
    attachments,
    executionMode,
    isProcessing,
    onSend,
    startTrack,
    toolsEnabled,
    value,
    webSearchEnabled,
  ]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        ref.current?.focus();
      }
      if (modifier && event.key === "Enter") {
        event.preventDefault();
        submit();
      }
      if (event.key === "Escape") {
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (isProcessing) onStop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isProcessing, onStop, showSettings, submit]);
  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setValue(next);
    setShowCommandsMenu(next.startsWith("/"));
  };
  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const next: ExtendedAttachment[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setNotice(`«${file.name}» excede 8 MB y fue descartada.`);
        continue;
      }
      next.push({
        id: uid(),
        kind: "image",
        dataUrl: await fileToDataUrl(file),
        mime: file.type || "image/jpeg",
        name: file.name,
        size: file.size,
        tokenEstimate: 256,
      });
    }
    if (next.length) setAttachments((prev) => [...prev, ...next].slice(0, 8));
  };
  const startVoiceToText = () => {
    setNotice(null);
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setNotice("Este navegador no expone acceso al micrófono.");
      return;
    }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      void startAudioNote();
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = "es-MX";
      recognition.continuous = true;
      recognition.interimResults = true;
      let finalText = value;
      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result?.[0]?.transcript ?? "";
          if (result?.[0]?.isFinal) finalText = `${finalText} ${transcript}`.trim();
          else interim += transcript;
        }
        setValue(`${finalText}${interim ? ` ${interim}` : ""}`.trim());
      };
      recognition.onerror = (event) =>
        setNotice(
          event.error === "not-allowed"
            ? "Permiso de micrófono denegado."
            : "No fue posible transcribir la voz.",
        );
      recognition.onend = () => {
        setRecording(false);
        recognitionRef.current = null;
      };
      recognitionRef.current = recognition;
      setRecording(true);
      recognition.start();
    } catch {
      setRecording(false);
      setNotice("No fue posible iniciar la transcripción de voz.");
    }
  };
  const stopVoiceToText = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  };
  const startAudioNote = async () => {
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size > MAX_ATTACHMENT_BYTES) {
          setNotice("La grabación excede el límite de 8 MB.");
          return;
        }
        const dataUrl = await fileToDataUrl(blob);
        const item: ExtendedAttachment = {
          id: uid(),
          kind: "audio",
          dataUrl,
          mime: recorder.mimeType || "audio/webm",
          name: `nota-voz-${new Date().toISOString().slice(11, 19)}`,
          size: blob.size,
          tokenEstimate: 512,
        };
        setAttachments((prev) => [...prev, item].slice(0, 8));
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecSeconds(0);
      setRecording(true);
    } catch {
      setNotice("No se pudo acceder al micrófono. Revisa los permisos.");
    }
  };
  const stopAudioNote = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };
  const sentiment = sentimentFromText(cognitiveText);
  const estimatedTokens =
    Math.ceil(value.length / 4) +
    attachments.reduce((sum, item) => sum + (item.kind === "image" ? 256 : 512), 0);
  return (
    <div className="glass-strong relative flex flex-col gap-3 rounded-2xl border border-electric/25 bg-background/95 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.24)] transition-all sm:p-5">
      {showCommandsMenu && (
        <div className="absolute bottom-full left-6 right-6 z-50 mb-2 space-y-1 rounded-2xl border border-border/50 bg-background/95 p-2 font-mono text-[11px] shadow-2xl backdrop-blur-xl">
          <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Modos de ejecución rápida
          </div>
          {(
            [
              ["/think", "deep_reasoning", BrainCircuit, "Razonamiento profundo"],
              ["/research", "web_research", Globe, "Investigación web"],
              ["/agent", "agent_tools", Wrench, "Herramientas y agentes"],
            ] as const
          ).map(([command, mode, Icon, label]) => (
            <button
              key={command}
              type="button"
              onClick={() => {
                setValue("");
                setExecutionMode(mode);
                setShowCommandsMenu(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-platinum transition-colors hover:bg-secondary/40"
            >
              <Icon className="size-4 text-electric" />
              <span className="font-semibold">{command}</span>
              <span className="text-muted-foreground">{label}</span>
            </button>
          ))}
        </div>
      )}
      {showSettings && (
        <div
          className="absolute right-4 top-14 z-50 w-72 rounded-2xl border border-border/50 bg-background/95 p-4 font-mono text-[10px] shadow-2xl backdrop-blur-xl"
          role="dialog"
          aria-label="Preferencias cognitivas"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold uppercase tracking-[.2em] text-platinum">
              Preferencias cognitivas
            </span>
            <span className="text-muted-foreground">Persistente</span>
          </div>
          <p className="mb-3 text-muted-foreground">
            Paleta visual local. Se conserva en este navegador y sobrescribe Abyss.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(themes) as ThemeId[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={theme === id}
                onClick={() => {
                  setTheme(id);
                  applyTheme(id);
                }}
                className={`rounded-xl border px-3 py-2 text-left transition-all ${theme === id ? "border-electric/60 bg-electric/10 text-electric" : "border-border/30 text-muted-foreground hover:bg-secondary/30"}`}
              >
                <span className="block font-semibold">{themes[id].label}</span>
                <span className="text-[8px] uppercase tracking-wider">{themes[id].accent}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between border-b border-border/30 pb-2">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${isProcessing ? "animate-ping bg-electric" : recording ? "animate-pulse bg-rose-500" : "bg-emerald-400"}`}
          />
          <span
            className="font-mono text-[10px] uppercase tracking-[.22em] text-muted-foreground"
            aria-live="polite"
          >
            Canal Perceptivo · Isabella AI
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider">
          <span
            className="rounded-full border border-border/30 px-2 py-0.5 text-muted-foreground"
            title="Indicador heurístico de estado cognitivo"
          >
            <span aria-hidden>{sentiment.glyph}</span> {sentiment.label}
          </span>
          <span className="hidden text-muted-foreground/80 sm:inline">
            Tokens: <strong className="text-electric">{estimatedTokens}</strong>
          </span>
          <button
            type="button"
            onClick={() => setShowSettings((open) => !open)}
            aria-expanded={showSettings}
            aria-label="Abrir preferencias cognitivas"
            className="rounded-lg border border-border/30 p-1.5 text-muted-foreground hover:bg-secondary/30 hover:text-platinum"
          >
            <Settings2 className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span
          className={`size-1.5 rounded-full ${isProcessing || recording ? "animate-pulse bg-electric" : "bg-emerald-400"}`}
        />
        {isProcessing
          ? "Isabella está preparando una respuesta"
          : "Listo para recibir tu instrucción"}
      </div>
      <div className="relative">
        <textarea
          id={inputId}
          ref={ref}
          value={value}
          onChange={handleInputChange}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          aria-label="Mensaje para Isabella AI"
          placeholder="Escribe tu mensaje para Isabella…"
          className="w-full resize-none bg-transparent text-[14.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:ring-0"
        />
      </div>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {attachments.map((item) => (
            <div
              key={item.id}
              className="glass relative flex items-center gap-2.5 rounded-2xl border border-border/40 bg-secondary/20 px-3 py-2"
            >
              {item.kind === "image" ? (
                <img
                  src={item.dataUrl}
                  alt={`Adjunto ${item.name}`}
                  className="size-10 rounded-xl border border-border/30 object-cover"
                />
              ) : (
                <audio controls src={item.dataUrl} className="h-8 max-w-[160px]" />
              )}
              <div className="max-w-[130px]">
                <p className="truncate font-mono text-[10px] font-semibold text-platinum">
                  {item.name}
                </p>
                <p className="font-mono text-[8.5px] text-muted-foreground">
                  {item.kind === "image" ? "IMAGEN" : "AUDIO"} · {humanSize(item.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setAttachments((prev) => prev.filter((attachment) => attachment.id !== item.id))
                }
                aria-label={`Quitar adjunto ${item.name}`}
                className="ml-1 rounded-lg border border-border/30 p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-2.5 font-mono text-[10.5px] text-rose-400"
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          {notice}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-border/30 pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(event) => {
              void addPhotos(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => photoRef.current?.click()}
            className="flex items-center gap-1.5 rounded-xl border border-border/30 p-2 font-mono text-[10px] text-muted-foreground transition-all hover:bg-secondary/30 hover:text-platinum"
          >
            <Paperclip className="size-3.5 text-electric" />
            <span className="hidden sm:inline">Foto</span>
          </button>
          <button
            type="button"
            onClick={() =>
              recording
                ? recognitionRef.current
                  ? stopVoiceToText()
                  : stopAudioNote()
                : startVoiceToText()
            }
            aria-pressed={recording}
            title="Dictado por voz en español mexicano"
            className={`flex items-center gap-1.5 rounded-xl border p-2 font-mono text-[10px] transition-all ${recording ? "border-rose-500/50 bg-rose-500/15 text-rose-400" : "border-border/30 text-muted-foreground hover:bg-secondary/30 hover:text-platinum"}`}
          >
            {recording ? (
              <MicOff className="size-3.5" />
            ) : (
              <Mic className="size-3.5 text-electric" />
            )}
            <span className="hidden sm:inline">{recording ? "Detener" : "Dictar"}</span>
            {recording && <span>{recSeconds}s</span>}
          </button>
          <button
            type="button"
            onClick={() => {
              setExecutionMode("fast");
              setWebSearchEnabled((enabled) => !enabled);
            }}
            className={`rounded-xl border px-2 py-2 font-mono text-[9px] ${webSearchEnabled ? "border-electric/30 text-electric" : "border-border/30 text-muted-foreground"}`}
          >
            Web
          </button>
          <button
            type="button"
            onClick={() => setToolsEnabled((enabled) => !enabled)}
            className={`rounded-xl border px-2 py-2 font-mono text-[9px] ${toolsEnabled ? "border-electric/30 text-electric" : "border-border/30 text-muted-foreground"}`}
          >
            Tools
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onReset}
            aria-label="Restablecer conversación"
            className="rounded-xl border border-border/30 p-2 text-muted-foreground hover:bg-secondary/30 hover:text-rose-400"
          >
            <Trash2 className="size-3.5" />
          </button>
          {isProcessing ? (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-rose-400"
            >
              <Square className="size-3 fill-current" />
              Detener
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim() && attachments.length === 0}
              className="flex items-center gap-2 rounded-xl border border-electric/40 bg-electric/10 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-electric disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="size-3" />
              Enviar
            </button>
          )}
        </div>
      </div>
      <div className="flex justify-between font-mono text-[8px] uppercase tracking-[.18em] text-muted-foreground/45">
        <span>ES-MX · es-419</span>
        <span>
          Theme: {themes[theme].label} · {executionMode}
        </span>
      </div>
    </div>
  );
}
