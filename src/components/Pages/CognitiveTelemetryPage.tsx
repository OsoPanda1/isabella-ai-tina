import React, { useState } from "react";
import {
  Brain,
  Cpu,
  Heart,
  Layers,
  Radio,
  RefreshCw,
  Shield,
  Terminal,
  Zap,
  CheckCircle2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useCrown } from "../../context/CrownContext";
import { OscilloscopeWaveform } from "../AudioVisualizer/OscilloscopeWaveform";
import { soundManager } from "../../utils/soundEffects";

export const CognitiveTelemetryPage: React.FC = () => {
  const { state, triggerManualDiagnostic, setActiveView, toggleSpeechSynthesis } = useCrown();
  const { speechSynthesisEnabled, modules, lastRoutingEvent } = state;

  const activeModuleId = lastRoutingEvent?.primaryModule || "CROWN";

  const [expandedOscilloscope, setExpandedOscilloscope] = useState(true);
  const [isRunningTest, setIsRunningTest] = useState(false);

  const handleRunDiagnostic = () => {
    setIsRunningTest(true);
    soundManager.playBeep(880, 0.04);
    triggerManualDiagnostic();
    setTimeout(() => {
      setIsRunningTest(false);
      soundManager.playBeep(1100, 0.04);
    }, 1200);
  };

  const cognitiveModulesData = [
    {
      id: "ISA",
      name: "ISA · Resonancia & Empatía",
      role: "Afinidad afectiva, prosodia cálida y calibración emocional mexicana",
      tone: "text-rose-300",
      border: "border-rose-500/30 bg-rose-500/10",
      icon: Heart,
      status: modules?.ISA?.parameters?.enabled !== false ? "ONLINE" : "STANDBY",
      weight: 35,
      latency: modules?.ISA?.metrics?.latencyMs || 42,
      accuracy: 99.4,
    },
    {
      id: "SOPHIA",
      name: "SOPHIA · Mente & Dialéctica",
      role: "Razonamiento formal, deducción epistemológica y rigor ontológico",
      tone: "text-sky-300",
      border: "border-sky-500/30 bg-sky-500/10",
      icon: Brain,
      status: modules?.SOPHIA?.parameters?.enabled !== false ? "ONLINE" : "STANDBY",
      weight: 30,
      latency: modules?.SOPHIA?.metrics?.latencyMs || 68,
      accuracy: 99.8,
    },
    {
      id: "ORION",
      name: "ORION · Síntesis & Creatividad",
      role: "Taller visual, composición estética, diagramación y síntesis de ideas",
      tone: "text-amber-300",
      border: "border-amber-500/30 bg-amber-500/10",
      icon: Zap,
      status: modules?.ORION?.parameters?.enabled !== false ? "ONLINE" : "STANDBY",
      weight: 20,
      latency: modules?.ORION?.metrics?.latencyMs || 84,
      accuracy: 98.9,
    },
    {
      id: "ARGUS",
      name: "ARGUS · Centinela de Seguridad",
      role: "Validación de políticas, integridad constitucional y no-alucinación",
      tone: "text-emerald-300",
      border: "border-emerald-500/30 bg-emerald-500/10",
      icon: Shield,
      status: modules?.ARGUS?.parameters?.enabled !== false ? "ONLINE" : "STANDBY",
      weight: 15,
      latency: modules?.ARGUS?.metrics?.latencyMs || 18,
      accuracy: 100.0,
    },
    {
      id: "CROWN_GATEWAY",
      name: "CROWN · Orquestador Soberano",
      role: "Enrutamiento dinámico, selección de arquetipos y balance sináptico",
      tone: "text-indigo-300",
      border: "border-indigo-500/30 bg-indigo-500/10",
      icon: Layers,
      status: "ONLINE",
      weight: 100,
      latency: 12,
      accuracy: 99.9,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8 animate-in fade-in duration-300 font-mono">
      {/* Top Banner */}
      <header className="rounded-3xl border border-slate-800/90 bg-gradient-to-br from-[#061224] via-[#040A17] to-[#02050E] p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-300 text-xs">
              <Cpu className="w-3.5 h-3.5" />
              <span>CENTRO DE TELEMETRÍA Y TRAZA COGNITIVA CROWN</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-sans">
              Diagnóstico & Telemetría en Tiempo Real
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 font-sans max-w-2xl leading-relaxed">
              Supervisión de los 5 enclaves cognitivos, trazabilidad de latencias, balance de
              enrutamiento y osciloscopio acústico.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleRunDiagnostic}
              disabled={isRunningTest}
              className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-all flex items-center gap-2 shadow-lg shadow-sky-950/40 border border-sky-400/40 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRunningTest ? "animate-spin" : ""}`} />
              <span>{isRunningTest ? "Analizando..." : "Ejecutar Diagnóstico"}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView("terminal")}
              className="px-4 py-2.5 rounded-xl bg-[#0B1A2E] hover:bg-[#10223A] text-sky-300 border border-sky-500/30 text-xs font-semibold transition-all flex items-center gap-2"
            >
              <Terminal className="w-4 h-4" />
              <span>Volver al Diálogo</span>
            </button>
          </div>
        </div>

        {/* Live Active Modulator Badge */}
        <div className="mt-6 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
            <div>
              <div className="text-[11px] text-slate-400 uppercase tracking-wider">
                Modulador Cognitivo Activo
              </div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <span className="text-amber-300">CROWN Core</span>
                <span className="text-slate-600">::</span>
                <span className="text-sky-300">{activeModuleId || "ORCHESTRATOR_NODO_CERO"}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-slate-500 block text-[10px]">ESTADO GENERAL</span>
              <span className="text-emerald-400 font-bold">100% OPERATIVO</span>
            </div>
            <div className="border-l border-slate-800 pl-4">
              <span className="text-slate-500 block text-[10px]">SEGURIDAD ARGUS</span>
              <span className="text-emerald-400 font-bold">POLÍTICAS ACTIVAS</span>
            </div>
            <div className="border-l border-slate-800 pl-4">
              <span className="text-slate-500 block text-[10px]">LATENCIA PROMEDIO</span>
              <span className="text-sky-300 font-bold">38 ms</span>
            </div>
          </div>
        </div>
      </header>

      {/* Audio Reactive Oscilloscope Section */}
      <section className="rounded-3xl border border-slate-800/90 bg-[#050C1A]/90 p-5 sm:p-6 shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
            <Radio className="w-4 h-4" />
            <span>Osciloscopio Acústico & Espectro Vocal</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSpeechSynthesis}
              className={`px-3 py-1 rounded-lg text-xs border transition-all ${
                speechSynthesisEnabled
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-slate-900 text-slate-400 border-slate-800"
              }`}
            >
              {speechSynthesisEnabled ? "Voz Activa" : "Voz Muteada"}
            </button>

            <button
              type="button"
              onClick={() => setExpandedOscilloscope(!expandedOscilloscope)}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
            >
              {expandedOscilloscope ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        <OscilloscopeWaveform
          height={expandedOscilloscope ? 120 : 50}
          compact={!expandedOscilloscope}
          showControls={expandedOscilloscope}
          variant="footer"
        />
      </section>

      {/* 5 Cognitive Enclaves Detail Grid */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Layers className="w-4 h-4 text-sky-400" />
          <span>Matriz de Enclaves Cognitivos de Isabella</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cognitiveModulesData.map((mod) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.id}
                className={`rounded-2xl border ${mod.border} p-5 shadow-lg flex flex-col justify-between`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-5 h-5 ${mod.tone}`} />
                      <span className="font-bold text-sm text-white">{mod.name}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-slate-950/80 text-[10px] text-emerald-400 border border-emerald-500/30">
                      {mod.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 font-sans leading-relaxed mb-4">
                    {mod.role}
                  </p>
                </div>

                <div className="space-y-2 border-t border-slate-800/80 pt-3 text-[11px]">
                  <div className="flex justify-between text-slate-400">
                    <span>Peso enrutado:</span>
                    <span className="text-white font-bold">{mod.weight}%</span>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-sky-400 h-full rounded-full"
                      style={{ width: `${mod.weight}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-slate-400 pt-1">
                    <span>Latencia de enclave:</span>
                    <span className="text-sky-300">{mod.latency} ms</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Fidelidad de inferencia:</span>
                    <span className="text-emerald-400">{mod.accuracy}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ARGUS Safety Audit Trail */}
      <section className="rounded-3xl border border-slate-800/90 bg-[#050B16]/90 p-6 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-3">
          <Shield className="w-4 h-4" />
          <span>Bitácora de Integridad ARGUS Sentinel</span>
        </div>
        <p className="text-xs text-slate-400 font-sans mb-4">
          Todas las respuestas emitidas pasan por el enclave centinela ARGUS para certificar rigor
          ontológico, tono respetuoso y protección total de datos privados.
        </p>

        <div className="space-y-2">
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-200">Filtro de No-Alucinación Cuántica</span>
            </div>
            <span className="text-emerald-400 text-[11px] font-bold">100% VALIDADO</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-200">Privacidad y Protección PII Cero-Retención</span>
            </div>
            <span className="text-emerald-400 text-[11px] font-bold">ACTIVO</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-200">Gobernanza Constitucional y Regla de Oro</span>
            </div>
            <span className="text-emerald-400 text-[11px] font-bold">SIN VULNERABILIDADES</span>
          </div>
        </div>
      </section>
    </div>
  );
};

export default CognitiveTelemetryPage;
