import React, { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useCrown } from "../../context/CrownContext";
import {
  Send,
  Terminal as TerminalIcon,
  Sparkles,
  Mic,
  MicOff,
  Palette,
  Shield,
  Keyboard,
} from "lucide-react";
import { soundManager } from "../../utils/soundEffects";

export const TerminalCommandLine: React.FC = () => {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    sendMessage,
    executeCommand,
    startListening,
    stopListening,
    state,
    setActiveView,
    openWelcomeModal,
    openShortcutsModal,
  } = useCrown();
  const isProcessing = state.isProcessing;

  const QUICK_COMMANDS = [
    { label: "Hola Isabella, ¿cómo estás?", desc: "Saludar", icon: "🌸" },
    { label: "Pinta un atardecer sobre un mar cuántico", desc: "Crear Arte", icon: "🎨" },
    { label: "¿Cuál es tu propósito y esencia?", desc: "Conocerla", icon: "✨" },
    { label: "Necesito un momento de reflexión serena", desc: "Calma", icon: "💭" },
    { label: "¿Cómo interactúan la lógica y la empatía?", desc: "Filosofía", icon: "🧠" },
    { label: "/status", desc: "Diagnóstico", icon: "⚡" },
  ];

  useEffect(() => {
    inputRef.current?.focus();

    const handleFocusPrompt = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };

    window.addEventListener("isabella-focus-prompt", handleFocusPrompt);
    return () => {
      window.removeEventListener("isabella-focus-prompt", handleFocusPrompt);
    };
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or Cmd+Enter: Instant submit even if multi-line
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
      return;
    }

    // Standard Enter without Shift submits
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "ArrowUp") {
      if (history.length > 0) {
        e.preventDefault();
        const nextIdx = historyIdx < history.length - 1 ? historyIdx + 1 : historyIdx;
        setHistoryIdx(nextIdx);
        setInput(history[history.length - 1 - nextIdx] || "");
      }
    } else if (e.key === "ArrowDown") {
      if (historyIdx > 0) {
        e.preventDefault();
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInput(history[history.length - 1 - nextIdx] || "");
      } else if (historyIdx === 0) {
        e.preventDefault();
        setHistoryIdx(-1);
        setInput("");
      }
    }
  };

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;

    // Save to history
    setHistory((prev) => [...prev, trimmed]);
    setHistoryIdx(-1);

    if (trimmed.startsWith("/")) {
      executeCommand(trimmed);
    } else {
      sendMessage(trimmed);
    }

    setInput("");
  };

  const handleQuickCommand = (cmd: string) => {
    soundManager.playBeep(750, 0.03);
    if (cmd.startsWith("/")) {
      executeCommand(cmd);
    } else {
      sendMessage(cmd);
    }
  };

  const toggleMic = () => {
    if (state.isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-3xl border border-slate-800/90 bg-[#070E1C]/90 p-3.5 shadow-2xl backdrop-blur-xl transition-all duration-200 focus-within:border-sky-500/50 focus-within:ring-1 focus-within:ring-sky-500/20">
      {/* Quick shortcuts ribbon - Enterprise Petrol & Gold Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px] font-mono">
        <button
          type="button"
          onClick={() => {
            soundManager.playBeep(800, 0.04);
            openWelcomeModal();
          }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-[11px] shrink-0 active:scale-95 transition-all cursor-pointer font-bold shadow-sm"
          title="Abrir presentación y guía para conversar con Isabella"
        >
          <Sparkles className="w-3 h-3 text-amber-400" />
          <span>✨ Conoce a Isabella (Guía)</span>
        </button>

        <span className="text-slate-600 mx-0.5">|</span>

        {QUICK_COMMANDS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => handleQuickCommand(item.label)}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#0B1728] hover:bg-[#10223A] text-slate-300 hover:text-white border border-slate-800/90 hover:border-sky-500/40 transition-all text-[11px] shrink-0 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <span>{item.icon}</span>
            <span className="font-semibold">{item.label}</span>
            <span className="text-[10px] text-slate-400 hidden sm:inline">({item.desc})</span>
          </button>
        ))}
      </div>

      {/* Main Terminal Input Shell */}
      <div className="flex items-start gap-2.5 pt-1">
        <div className="flex items-center gap-1 text-sky-400 font-mono text-xs select-none pt-2 shrink-0">
          <TerminalIcon className="w-4 h-4 text-sky-400" />
          <span className="text-amber-300 font-bold hidden sm:inline">isabella</span>
          <span className="text-slate-400 hidden sm:inline">@</span>
          <span className="text-sky-300 font-bold hidden sm:inline">crown</span>
          <span className="text-slate-400">:~$</span>
        </div>

        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isProcessing}
          rows={Math.min(4, Math.max(1, input.split("\n").length))}
          placeholder={
            isProcessing
              ? "Isabella y la arquitectura CROWN están sintetizando pensamiento..."
              : "Escribe a Isabella (ej. 'Genera una reflexión filosófica' o '/image arquitectura cuántica')..."
          }
          className="w-full resize-none bg-transparent font-mono text-sm text-[#F8FAFC] placeholder:text-slate-500 focus:outline-none leading-relaxed min-h-[38px] max-h-[140px] py-1.5"
        />

        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          {/* Quick Voice STT Microphone Button */}
          <button
            type="button"
            onClick={toggleMic}
            className={`p-2 rounded-xl border transition-all ${
              state.isListening
                ? "bg-red-600 border-red-400 text-white animate-pulse shadow-lg shadow-red-600/40"
                : "bg-[#0B1728] hover:bg-[#10223A] text-slate-400 hover:text-sky-300 border-slate-800"
            }`}
            title={
              state.isListening
                ? "Detener grabación de voz"
                : "Hablar con Isabella por micrófono (Ctrl+M)"
            }
          >
            {state.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* Quick Image studio shortcut */}
          <button
            type="button"
            onClick={() => setActiveView("image_studio")}
            className="p-2 rounded-xl bg-[#0B1728] hover:bg-[#10223A] text-slate-400 hover:text-amber-300 border border-slate-800 transition-all hidden sm:flex"
            title="Abrir Estudio Visual"
          >
            <Palette className="w-4 h-4 text-amber-400" />
          </button>

          {/* Submit Button - Enterprise Electric Blue */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim() || isProcessing}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-950/40 border border-blue-400/40 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            <span className="hidden sm:inline">Enviar</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Footer input telemetry and power user hotkeys */}
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1 border-t border-slate-800/80 pt-1.5 flex-wrap gap-y-1">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 text-sky-300 border border-sky-500/40 text-[9px] font-bold">
              ↵ Enter
            </kbd>
            <span className="text-slate-500">o</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 text-amber-300 border border-amber-500/40 text-[9px] font-bold">
              Ctrl+↵
            </kbd>
            <span>enviar</span>
          </span>
          <span className="hidden sm:inline text-slate-700">|</span>
          <span className="hidden sm:flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[9px]">
              Shift+↵
            </kbd>
            <span>nueva línea</span>
          </span>
          <span className="hidden md:inline text-slate-700">|</span>
          <span className="hidden md:flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 text-[9px]">
              Ctrl+K
            </kbd>
            <span>limpiar</span>
          </span>
          <span className="hidden lg:inline text-slate-700">|</span>
          <span className="hidden lg:flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900 text-amber-300 border border-amber-500/40 text-[9px]">
              Ctrl+M
            </kbd>
            <span>voz</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              soundManager.playBeep(850, 0.03);
              openShortcutsModal();
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#0B1A2E] hover:bg-blue-950/60 text-sky-300 hover:text-white border border-blue-500/30 text-[10px] transition-all cursor-pointer font-bold"
            title="Ver todos los atajos de teclado (Ctrl+/ o ?)"
          >
            <Keyboard className="w-3 h-3 text-sky-400" />
            <span>Atajos [ ? ]</span>
          </button>

          <span className="hidden sm:flex text-emerald-400 items-center gap-1">
            <Shield className="w-3 h-3 text-emerald-400" />
            ARGUS ACTIVO
          </span>
        </div>
      </div>
    </div>
  );
};
