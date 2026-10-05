import { useCallback, useEffect, useRef, useState } from "react";
import {
  PRESETS,
  buildSystemPrompt,
  route,
  type Preset,
  type PresetId,
  type RoutingDecision,
} from "./crown-ui";
import { audioFormatFromMime, type Attachment } from "./attachments";
import { detectSkillInvocation, isSkillTrigger } from "@/lib/skills/skill-bridge-core";
import {
  exportTelemetryCsv,
  exportTelemetryPdf,
  toTelemetryRecord,
  type TelemetryRecord,
} from "./audit-export";
import { useIsabellaObservability } from "@/hooks/use-isabella-observability";
import { randomUUID } from "@/lib/browser-node-crypto";

export interface TerminalMessage {
  id: string;
  role: "user" | "isabella" | "system";
  content: string;
  timestamp: string;
  decision?: RoutingDecision;
  streaming?: boolean;
  error?: boolean;
  provider?: string;
  degraded?: boolean;
  attachments?: Attachment[];
}
const now = () =>
  new Date().toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const uid = () => randomUUID();
const STORAGE_KEY = "isabella.session.v1";
const TELEMETRY_KEY = "isabella.telemetry.v1";
const PRESET_KEY = "isabella.preset.v1";
const BOOT: TerminalMessage = {
  id: "boot",
  role: "system",
  content:
    "Núcleo C.R.O.W.N. sincronizado · ISA · SOPHIA · ORION · ARGUS en línea · Nodo Cero, Real del Monte, Hidalgo. Presencia establecida.",
  timestamp: "--:--:--",
};
function loadSession(): TerminalMessage[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { messages?: TerminalMessage[] };
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return null;
    return parsed.messages.map((m) => ({ ...m, streaming: false }));
  } catch {
    return null;
  }
}
const TRANSPORT_TEXT_LIMIT = 12_000;
const TRANSPORT_ATTACHMENT_LIMIT = 8;

type SendConfig = {
  mode?: "fast" | "deep_reasoning" | "web_research" | "agent_tools";
  webSearch?: boolean;
  toolsEnabled?: boolean;
};

function normalizeTransportText(value: string, fallback = "Analiza el material adjunto.") {
  const normalized = value.trim().slice(0, TRANSPORT_TEXT_LIMIT);
  return normalized || fallback;
}

function buildContent(text: string, attachments?: Attachment[]) {
  const safeAttachments = attachments?.slice(0, TRANSPORT_ATTACHMENT_LIMIT) ?? [];
  if (!safeAttachments.length) return normalizeTransportText(text);
  const blocks: unknown[] = [{ type: "text", text: normalizeTransportText(text) }];
  for (const a of safeAttachments) {
    if (a.kind === "image" && a.dataUrl) {
      blocks.push({ type: "image_url", image_url: { url: a.dataUrl.slice(0, 11_000_000) } });
    } else if (a.kind === "audio" && a.dataUrl) {
      const data = a.dataUrl.split(",")[1] ?? "";
      if (data) {
        blocks.push({
          type: "input_audio",
          input_audio: {
            data: data.slice(0, 11_000_000),
            format: audioFormatFromMime(a.mime),
          },
        });
      }
    }
  }
  return blocks;
}

export function useIsabella() {
  const [messages, setMessages] = useState<TerminalMessage[]>([BOOT]);
  const [hydrated, setHydrated] = useState(false);
  const [presetId, setPresetId] = useState<PresetId>("prime");
  const [isProcessing, setIsProcessing] = useState(false);
  const [decision, setDecision] = useState<RoutingDecision | null>(null);
  const [tokens, setTokens] = useState(0);
  const [telemetry, setTelemetry] = useState<TelemetryRecord[]>([]);
  const [runId] = useState(() => `run-${uid()}`);
  const abortRef = useRef<AbortController | null>(null);
  const { logLifecycleEvent, validatePayload } = useIsabellaObservability();
  const preset: Preset = PRESETS.find((p) => p.id === presetId) ?? (PRESETS[0] as Preset);
  useEffect(() => {
    const restored = loadSession();
    if (restored) setMessages(restored);
    try {
      const savedPreset = window.localStorage.getItem(PRESET_KEY) as PresetId | null;
      if (savedPreset && PRESETS.some((p) => p.id === savedPreset)) setPresetId(savedPreset);
      const rawTel = window.localStorage.getItem(TELEMETRY_KEY);
      if (rawTel) setTelemetry(JSON.parse(rawTel) as TelemetryRecord[]);
    } catch {
      /* storage unavailable */
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          presetId,
          messages,
        }),
      );
      window.localStorage.setItem(PRESET_KEY, presetId);
      window.localStorage.setItem(TELEMETRY_KEY, JSON.stringify(telemetry.slice(-200)));
    } catch {
      /* session remains in memory */
    }
  }, [messages, presetId, telemetry, hydrated]);

  const send = useCallback(
    async (input: string, attachments: Attachment[] = [], config: SendConfig = {}) => {
      const text = input.trim();
      if ((!text && attachments.length === 0) || isProcessing) return;
      logLifecycleEvent("INIT", {
        input: text,
        attachmentsCount: attachments.length,
      });
      const validatedPayload = validatePayload(text, attachments);
      if (!validatedPayload) {
        logLifecycleEvent("ERROR", { reason: "Payload validation failed" });
        return;
      }
      logLifecycleEvent("SANITIZATION", { validatedPayload });
      // Detección de invocación de habilidades (@skill trigger)
      // Se canaliza de forma transparente hacia el puente canónico processSkillInvocation,
      // preservando el comando completo y capturando la evidencia en el ledger BookPI.
      const skillInvocation = detectSkillInvocation(validatedPayload.text || "");
      const hasSkillTrigger = Boolean(
        skillInvocation || isSkillTrigger(validatedPayload.text || ""),
      );
      const effectiveText = validatedPayload.text || text;
      const routing = route(effectiveText || "material adjunto", preset);
      setDecision(routing);
      setTelemetry((prev) => [...prev, toTelemetryRecord(routing, preset.id)]);
      logLifecycleEvent("PAYLOAD_CONSTRUCTION", {
        presetId: preset.id,
        routing,
      });
      const { getSessionToken } = await import("@/lib/auth-client");
      // La autorización pertenece al servidor: en previews configurados para chat
      // invitado, /api/isabella puede aceptar la petición sin Bearer. En producción
      // el mismo endpoint aplica fail-closed y devuelve 401/403 si falta identidad.
      const token = getSessionToken();
      const userMsg: TerminalMessage = {
        id: uid(),
        role: "user",
        content: effectiveText || normalizeTransportText(text),
        timestamp: now(),
        attachments,
      };
      const replyId = uid();
      const history = [...messages, userMsg]
        .filter((m) => m.role !== "system" && !m.error)
        .slice(-16)
        .map((m) => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: buildContent(m.content, m.attachments),
        }));
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: replyId,
          role: "isabella",
          content: "",
          timestamp: now(),
          decision: routing,
          streaming: true,
        },
      ]);
      setIsProcessing(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        logLifecycleEvent("SEND", { endpoint: "/api/isabella" });
        const res = await fetch("/api/isabella", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
          body: JSON.stringify({
            system: buildSystemPrompt(routing, preset).slice(0, 8000),
            temperature: preset.temperature,
            messages: history,
            context: {
              source: "isabella",
              preset: preset.id,
              runId,
              executionMode: config.mode ?? "fast",
              webSearch: config.webSearch ?? false,
              toolsEnabled: hasSkillTrigger || (config.toolsEnabled ?? false),
              hasSkillTrigger,
              skillBridge: hasSkillTrigger ? "processSkillInvocation" : undefined,
              skillId: skillInvocation?.canonicalName,
            },
          }),
        });
        if (!res.ok || !res.body) {
          const detail = await res.json().catch(
            () =>
              ({ error: "Fallo de percepción." }) as {
                error?: string;
                message?: string;
              },
          );
          const rawMessage = detail.message ?? detail.error ?? "Fallo de percepción.";
          if (
            res.status === 403 &&
            typeof rawMessage === "string" &&
            /tenant|aislamiento/i.test(rawMessage)
          ) {
            try {
              window.sessionStorage.removeItem("isabella_session_token");
            } catch {
              // El siguiente intento aún puede obtener una sesión nueva del servidor.
            }
            throw new Error("Sesión renovada requerida. Reintenta la percepción.");
          }
          throw new Error(typeof rawMessage === "string" ? rawMessage : JSON.stringify(rawMessage));
        }
        const degradedHeader = res.headers.get("x-isabella-degraded-mode");
        const degradedMode = degradedHeader && degradedHeader.length > 0 ? degradedHeader : null;
        const providerHeader = res.headers.get("x-isabella-provider");
        const modelHeader = res.headers.get("x-isabella-model");
        const traceHeader = res.headers.get("x-isabella-trace-id");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";
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
            if (payload === "[DONE]") continue;
            try {
              const event = JSON.parse(payload);
              const delta: string | undefined = event.choices?.[0]?.delta?.content;
              const provider = typeof event.provider === "string" ? event.provider : providerHeader;
              const model = typeof event.model === "string" ? event.model : modelHeader;
              if (provider || model || event.degraded === true)
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === replyId
                      ? {
                          ...m,
                          provider: provider ?? m.provider,
                          degraded: event.degraded === true || degradedMode !== null,
                        }
                      : m,
                  ),
                );
              if (delta) {
                acc += delta;
                setTokens((t) => t + 1);
                setMessages((prev) =>
                  prev.map((m) => (m.id === replyId ? { ...m, content: acc } : m)),
                );
              }
            } catch {
              /* incomplete SSE frame */
            }
          }
        }
        buffer += decoder.decode();
        for (const line of buffer.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:") || trimmed.slice(5).trim() === "[DONE]") continue;
          try {
            const json = JSON.parse(trimmed.slice(5).trim());
            const delta: string | undefined = json.choices?.[0]?.delta?.content;
            if (delta) acc += delta;
          } catch {
            /* final incomplete event */
          }
        }
        if (!acc.trim()) {
          throw new Error(
            "El proveedor de inferencia cerró el stream sin emitir síntesis. Reintenta la percepción.",
          );
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyId
              ? {
                  ...m,
                  streaming: false,
                  degraded: m.degraded ?? degradedMode !== null,
                  provider: m.provider ?? providerHeader ?? "gemini",
                  content: acc,
                }
              : m,
          ),
        );
        logLifecycleEvent("SUCCESS", {
          tokens: acc.length,
          traceId: traceHeader,
          provider: providerHeader,
          model: modelHeader,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setMessages((prev) => prev.filter((m) => m.id !== replyId));
          return;
        }
        const message = err instanceof Error ? err.message : "Interrupción del núcleo.";
        const isGatewayFailure = /502|sandbox is not listening|requested port|gateway/i.test(
          message,
        );
        const userMessage = isGatewayFailure
          ? "CANAL DE INFERENCIA NO DISPONIBLE :: El servidor de síntesis no está escuchando en este momento. Reintenta la percepción; ARGUS no bloqueó esta conversación."
          : `ERROR DE PERCEPCIÓN :: ${message}`;
        logLifecycleEvent("ERROR", {
          reason: message,
          category: isGatewayFailure ? "gateway" : "runtime",
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyId ? { ...m, streaming: false, error: true, content: userMessage } : m,
          ),
        );
      } finally {
        setIsProcessing(false);
        abortRef.current = null;
      }
    },
    [isProcessing, messages, preset, logLifecycleEvent, validatePayload, runId],
  );
  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([
      {
        id: uid(),
        role: "system",
        content:
          "Sesión purgada. Memoria inmediata y de sesión reiniciada · telemetría auditable preservada.",
        timestamp: now(),
      },
    ]);
    setDecision(null);
    setTokens(0);
  }, []);
  const downloadConversation = useCallback(() => {
    const payload = {
      artifact: "isabella.conversation",
      version: 2,
      runId,
      exportedAt: new Date().toISOString(),
      node: "Nodo Cero · Real del Monte, Hidalgo",
      presetId,
      messages,
      telemetry,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `isabella-conversacion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages, presetId, telemetry, runId]);
  const openConversation = useCallback(async (file: File) => {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as {
      messages?: TerminalMessage[];
      presetId?: PresetId;
    };
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0)
      throw new Error("Archivo de conversación inválido.");
    abortRef.current?.abort();
    if (parsed.presetId && PRESETS.some((p) => p.id === parsed.presetId))
      setPresetId(parsed.presetId);
    setMessages([
      ...parsed.messages.map((m) => ({ ...m, streaming: false })),
      {
        id: uid(),
        role: "system" as const,
        content: `Conversación reabierta desde archivo · ${parsed.messages.length} fragmentos restaurados · trazabilidad preservada.`,
        timestamp: now(),
      },
    ]);
    setDecision(null);
  }, []);
  const exportCsv = useCallback(() => exportTelemetryCsv(telemetry, runId), [telemetry, runId]);
  const exportPdf = useCallback(
    () => void exportTelemetryPdf(telemetry, runId, preset.name),
    [telemetry, runId, preset.name],
  );
  return {
    messages,
    send,
    stop,
    reset,
    isProcessing,
    preset,
    presetId,
    setPresetId,
    decision,
    tokens,
    telemetry,
    runId,
    downloadConversation,
    openConversation,
    exportCsv,
    exportPdf,
  };
}
