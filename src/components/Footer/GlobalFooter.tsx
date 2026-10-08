import React, { useState } from "react";
import { useCrown } from "../../context/CrownContext";
import { OscilloscopeWaveform } from "../AudioVisualizer/OscilloscopeWaveform";
import {
  Heart,
  Brain,
  Zap,
  Shield,
  Layers,
  Volume2,
  VolumeX,
  Activity,
  Maximize2,
  Minimize2,
} from "lucide-react";

export const GlobalFooter: React.FC = () => {
  const { state, toggleSpeechSynthesis, activeModuleId } = useCrown();
  const { isProcessing, isSpeaking, isListening, speechSynthesisEnabled } = state;
  const [expandedOscilloscope, setExpandedOscilloscope] = useState(false);

  const isAudioOrProcessingActive = isProcessing || isSpeaking || isListening;

  return (
    <footer className="app-footer frame-platinum">
      {/* Live Audio / Processing Oscilloscope Reactive Strip */}
      <div
        className={`border-b border-slate-800/80 transition-all duration-300 overflow-hidden ${
          isAudioOrProcessingActive || expandedOscilloscope
            ? "max-h-40 py-2 px-4 sm:px-6 lg:px-8 bg-[#070F1E]/95"
            : "max-h-14 py-1 px-4 sm:px-6 lg:px-8 bg-[#070F1E]/50 hover:bg-[#070F1E]/80"
        }`}
      >
        <div className="max-w-7xl mx-auto flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                    isSpeaking ? "bg-amber-400" : isProcessing ? "bg-sky-400" : "bg-emerald-400"
                  }`}
                />
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    isSpeaking ? "bg-amber-500" : isProcessing ? "bg-sky-500" : "bg-emerald-500"
                  }`}
                />
              </span>

              <span
                className={`font-semibold tracking-wider uppercase text-[10px] sm:text-xs ${
                  isSpeaking
                    ? "text-amber-300 animate-pulse font-bold"
                    : isProcessing
                      ? "text-sky-300 font-bold"
                      : "text-slate-300"
                }`}
              >
                {isSpeaking
                  ? "🔊 TRANSMISIÓN DE AUDIO EN VIVO :: SINTETIZADOR VOCAL DE ISABELLA"
                  : isProcessing
                    ? `⚡ MODULADOR COGNITIVO ACTIVO :: [${activeModuleId || "CROWN"}]`
                    : "CANAL ACÚSTICO CROWN :: SINTONIZADO EN TIEMPO REAL"}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {isSpeaking && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30 animate-pulse">
                  <Volume2 className="w-3 h-3 text-amber-400" /> AUDIO OUTPUT ACTIVE
                </span>
              )}
              {isProcessing && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-sky-300 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/30 animate-pulse">
                  <Activity className="w-3 h-3 text-sky-400" /> SYNAPSE ROUTING
                </span>
              )}
              <button
                type="button"
                onClick={() => setExpandedOscilloscope(!expandedOscilloscope)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
                title={expandedOscilloscope ? "Contraer osciloscopio" : "Expandir osciloscopio"}
              >
                {expandedOscilloscope ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <OscilloscopeWaveform
            height={expandedOscilloscope ? 58 : isAudioOrProcessingActive ? 42 : 24}
            compact={!expandedOscilloscope}
            showControls={expandedOscilloscope}
            variant="footer"
          />
        </div>
      </div>

      {/* Telemetry Status and Core Modules */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <img src="/isabella-logo.svg" alt="Isabella" className="h-5 w-5" />
          <span className="text-[#F8FAFC] font-semibold">Isabella Villaseñor AI</span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400">CROWN v5.1 Orchestrator</span>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 text-[11px] flex-wrap">
          <span
            className={`flex items-center gap-1 transition-colors ${
              activeModuleId === "ISA" ? "text-rose-300 font-bold" : "text-rose-400/80"
            }`}
          >
            <Heart className="w-3 h-3" /> ISA
          </span>
          <span
            className={`flex items-center gap-1 transition-colors ${
              activeModuleId === "SOPHIA" ? "text-sky-300 font-bold" : "text-sky-400/80"
            }`}
          >
            <Brain className="w-3 h-3" /> SOPHIA
          </span>
          <span
            className={`flex items-center gap-1 transition-colors ${
              activeModuleId === "ORION" ? "text-amber-300 font-bold" : "text-amber-400/80"
            }`}
          >
            <Zap className="w-3 h-3" /> ORION
          </span>
          <span
            className={`flex items-center gap-1 transition-colors ${
              activeModuleId === "ARGUS" ? "text-emerald-300 font-bold" : "text-emerald-400/80"
            }`}
          >
            <Shield className="w-3 h-3" /> ARGUS
          </span>
          <span
            className={`flex items-center gap-1 transition-colors ${
              activeModuleId === "CROWN_GATEWAY" ? "text-blue-300 font-bold" : "text-blue-400/80"
            }`}
          >
            <Layers className="w-3 h-3" /> CROWN
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <button
            type="button"
            onClick={toggleSpeechSynthesis}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-xl border transition-all ${
              speechSynthesisEnabled
                ? "bg-amber-950/40 border-amber-500/40 text-amber-300 font-bold"
                : "bg-[#081220] border-slate-800 text-slate-400 hover:text-slate-300"
            }`}
            title="Activar o silenciar síntesis vocal (Ctrl+Shift+V)"
          >
            {speechSynthesisEnabled ? (
              <>
                <Volume2 className="w-3 h-3 text-amber-400" />
                <span>Voz ON</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3 h-3 text-slate-500" />
                <span>Voz OFF</span>
              </>
            )}
          </button>

          <span className="text-[10px] text-slate-400 font-mono hidden md:inline">
            © 2026 Isabella Villaseñor Cognitive Architecture
          </span>
        </div>
      </div>
    </footer>
  );
};
