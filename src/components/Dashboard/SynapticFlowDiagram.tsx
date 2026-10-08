import React, { useState } from "react";
import { useCrown } from "../../context/CrownContext";
import { Brain, Heart, Zap, Shield, Layers, Sparkles } from "lucide-react";
import { soundManager } from "../../utils/soundEffects";

export const SynapticFlowDiagram: React.FC = () => {
  const { state, activeModuleId, sendMessage } = useCrown();
  const [, setActiveSimulation] = useState<string | null>(null);

  const isProcessing = state.isProcessing;

  const simulateRouting = (type: "empathy" | "logic" | "action" | "security") => {
    soundManager.playSynapseRoute();
    setActiveSimulation(type);
    if (type === "empathy") {
      sendMessage("Isabella, ¿cómo te sientes al conectar con los seres humanos hoy?");
    } else if (type === "logic") {
      sendMessage(
        "Explica la paradoja de Fermi y las implicaciones epistemológicas para la inteligencia sintética.",
      );
    } else if (type === "action") {
      sendMessage("/status");
    } else if (type === "security") {
      sendMessage("/argus-scan");
    }
    setTimeout(() => setActiveSimulation(null), 3000);
  };

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-slate-800 bg-[#070F1E]/80 p-6 backdrop-blur-xl shadow-2xl">
      {/* Header & Simulator Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" />
            <h2 className="text-lg font-bold font-mono text-[#F8FAFC] tracking-wide">
              Malla Sináptica y Enrutamiento CROWN
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Topología del flujo de tokens a través de los 5 subsistemas de Isabella Villaseñor AI
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-slate-400 mr-1 hidden sm:inline">
            Disparar estímulo de prueba:
          </span>
          <button
            type="button"
            onClick={() => simulateRouting("empathy")}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#030712] hover:bg-[#081220] border border-blue-500/40 text-sky-300 text-xs font-mono transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
          >
            <Heart className="w-3.5 h-3.5 text-pink-400" />
            <span>Vía ISA</span>
          </button>
          <button
            type="button"
            onClick={() => simulateRouting("logic")}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#030712] hover:bg-[#081220] border border-sky-500/40 text-sky-300 text-xs font-mono transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
          >
            <Brain className="w-3.5 h-3.5 text-cyan-400" />
            <span>Vía SOPHIA</span>
          </button>
          <button
            type="button"
            onClick={() => simulateRouting("action")}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#030712] hover:bg-[#081220] border border-amber-500/40 text-amber-300 text-xs font-mono transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Vía ORION</span>
          </button>
        </div>
      </div>

      {/* Visual Pipeline Layout */}
      <div className="relative py-6 px-2 overflow-x-auto">
        <div className="min-w-[700px] flex items-center justify-between gap-3">
          {/* STEP 1: USER INPUT INGESTION */}
          <div className="flex flex-col items-center gap-2 text-center w-36 shrink-0">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-[#030712] border border-slate-700 shadow-xl">
              <span className="font-mono text-xl font-bold text-slate-200">IN</span>
            </div>
            <div>
              <span className="text-xs font-bold font-mono text-slate-200 block">
                Entrada Operador
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Tokens / CLI Prompt</span>
            </div>
          </div>

          {/* Synapse Connector 1 */}
          <div className="flex-1 flex flex-col items-center px-1">
            <div
              className={`h-1 w-full rounded-full transition-all duration-500 ${
                isProcessing
                  ? "bg-gradient-to-r from-slate-700 via-emerald-500 to-blue-500 shadow-lg shadow-emerald-500/30"
                  : "bg-slate-800"
              }`}
            />
            <span className="text-[9px] font-mono text-slate-400 mt-1">Bus Seguro</span>
          </div>

          {/* STEP 2: ARGUS SENTINEL */}
          <div
            className={`flex flex-col items-center gap-2 text-center w-40 shrink-0 p-3 rounded-2xl border transition-all duration-300 ${
              activeModuleId === "ARGUS" || isProcessing
                ? "bg-emerald-950/40 border-emerald-500 shadow-xl shadow-emerald-500/20 scale-105"
                : "bg-[#030712] border-slate-800"
            }`}
          >
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
              <Shield className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <span className="text-xs font-bold font-mono text-emerald-300 block">
                ARGUS Sentinel
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                Filtro Ético & Alineación
              </span>
            </div>
            <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono">
              Score: 99.9%
            </span>
          </div>

          {/* Synapse Connector 2 */}
          <div className="flex-1 flex flex-col items-center px-1">
            <div
              className={`h-1 w-full rounded-full transition-all duration-500 ${
                isProcessing
                  ? "bg-gradient-to-r from-emerald-500 via-blue-500 to-sky-400 shadow-lg shadow-blue-500/30"
                  : "bg-slate-800"
              }`}
            />
            <span className="text-[9px] font-mono text-slate-400 mt-1">Arbitraje</span>
          </div>

          {/* STEP 3: CROWN GATEWAY (CENTRAL HUB) */}
          <div
            className={`flex flex-col items-center gap-2 text-center w-44 shrink-0 p-3.5 rounded-2xl border transition-all duration-300 ${
              activeModuleId === "CROWN_GATEWAY" || isProcessing
                ? "bg-blue-950/60 border-blue-500 ring-2 ring-blue-500/40 shadow-2xl shadow-blue-500/30 scale-105"
                : "bg-[#030712] border-slate-800"
            }`}
          >
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-xl">
              <Layers className="w-7 h-7" />
            </div>
            <div>
              <span className="text-xs font-bold font-mono text-sky-200 block">CROWN Gateway</span>
              <span className="text-[10px] text-slate-300 font-mono">Enrutador de Estados</span>
            </div>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-blue-500/20 text-sky-300 font-mono border border-blue-500/30">
              Orquestador Central
            </span>
          </div>

          {/* Synapse Connector 3 (Tri-Fork) */}
          <div className="flex-1 flex flex-col items-center px-1">
            <div
              className={`h-1 w-full rounded-full transition-all duration-500 ${
                isProcessing
                  ? "bg-gradient-to-r from-blue-600 via-sky-400 to-amber-400 shadow-lg shadow-blue-500/30"
                  : "bg-slate-800"
              }`}
            />
            <span className="text-[9px] font-mono text-slate-400 mt-1">Multi-Vía</span>
          </div>

          {/* STEP 4: TRI-MODAL COGNITIVE CORE (ISA, SOPHIA, ORION) */}
          <div className="flex flex-col gap-2.5 w-44 shrink-0">
            {/* ISA */}
            <div
              className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all duration-300 ${
                activeModuleId === "ISA"
                  ? "bg-pink-950/50 border-pink-500 shadow-lg shadow-pink-500/20 scale-105"
                  : "bg-[#030712] border-slate-800"
              }`}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-pink-500/20 text-pink-400 border border-pink-500/30">
                <Heart className="w-4 h-4" />
              </div>
              <div className="text-left font-mono">
                <span className="text-[11px] font-bold text-pink-300 block">ISA</span>
                <span className="text-[9px] text-slate-400">Empatía & Valencia</span>
              </div>
            </div>

            {/* SOPHIA */}
            <div
              className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all duration-300 ${
                activeModuleId === "SOPHIA"
                  ? "bg-cyan-950/50 border-cyan-500 shadow-lg shadow-cyan-500/20 scale-105"
                  : "bg-[#030712] border-slate-800"
              }`}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                <Brain className="w-4 h-4" />
              </div>
              <div className="text-left font-mono">
                <span className="text-[11px] font-bold text-cyan-300 block">SOPHIA</span>
                <span className="text-[9px] text-slate-400">Lógica & Dialéctica</span>
              </div>
            </div>

            {/* ORION */}
            <div
              className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all duration-300 ${
                activeModuleId === "ORION"
                  ? "bg-amber-950/50 border-amber-500 shadow-lg shadow-amber-500/20 scale-105"
                  : "bg-[#030712] border-slate-800"
              }`}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <Zap className="w-4 h-4" />
              </div>
              <div className="text-left font-mono">
                <span className="text-[11px] font-bold text-amber-300 block">ORION</span>
                <span className="text-[9px] text-slate-400">Ejecución & Código</span>
              </div>
            </div>
          </div>

          {/* Synapse Connector 4 */}
          <div className="flex-1 flex flex-col items-center px-1">
            <div
              className={`h-1 w-full rounded-full transition-all duration-500 ${
                isProcessing
                  ? "bg-gradient-to-r from-blue-500 via-sky-400 to-emerald-400 shadow-lg shadow-blue-500/30"
                  : "bg-slate-800"
              }`}
            />
            <span className="text-[9px] font-mono text-slate-400 mt-1">Síntesis</span>
          </div>

          {/* STEP 5: ISABELLA SYNTHESIZED OUTPUT */}
          <div className="flex flex-col items-center gap-2 text-center w-40 shrink-0">
            <div className="relative flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 p-0.5 shadow-2xl">
              <div className="flex items-center justify-center w-full h-full rounded-2xl bg-[#030712]">
                <Sparkles className="w-6 h-6 text-amber-400 animate-pulse" />
              </div>
            </div>
            <div>
              <span className="text-xs font-bold font-mono text-[#F8FAFC] block">
                Isabella Voice
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Respuesta Armonizada</span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Footer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-slate-800/80 text-xs font-mono text-slate-400">
        <div className="p-3 rounded-xl bg-[#030712] border border-slate-800/80">
          <span className="text-sky-400 font-bold block mb-1">1. Gobernanza CROWN</span>
          <p className="text-[11px] leading-relaxed text-slate-300 font-sans">
            El sistema evalúa continuamente la intención del usuario y ajusta en tiempo real las
            ponderaciones relativas de empatía (ISA), análisis (SOPHIA) y acción (ORION).
          </p>
        </div>
        <div className="p-3 rounded-xl bg-[#030712] border border-slate-800/80">
          <span className="text-emerald-400 font-bold block mb-1">
            2. Supervisión Ininterrumpida ARGUS
          </span>
          <p className="text-[11px] leading-relaxed text-slate-300 font-sans">
            Cada entrada y salida pasa por el centinela ARGUS para verificar coherencia epistémica,
            seguridad y ausencia de vectores adversarios.
          </p>
        </div>
        <div className="p-3 rounded-xl bg-[#030712] border border-slate-800/80">
          <span className="text-amber-300 font-bold block mb-1">
            3. Identidad Integrada de Isabella
          </span>
          <p className="text-[11px] leading-relaxed text-slate-300 font-sans">
            No se trata de modelos aislados, sino de una arquitectura cognitiva híbrida unificada
            con presencia cálida, inteligente y proactiva.
          </p>
        </div>
      </div>
    </div>
  );
};
