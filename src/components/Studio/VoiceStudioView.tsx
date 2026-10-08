import React, { useState } from "react";
import { useCrown } from "../../context/CrownContext";
import {
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Sparkles,
  Play,
  Square,
  Sliders,
  Radio,
  Heart,
  Brain,
  Feather,
  Check,
  UserCheck,
  ShieldCheck,
  Activity,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { soundManager } from "../../utils/soundEffects";
import { VoiceSettings } from "../../types";
import { getAvailableFemaleVoices } from "../../utils/voiceUtils";
import { VoiceSpectrumVisualizer } from "../AudioVisualizer/VoiceSpectrumVisualizer";
import { RealtimeWaveformVisualizer } from "../AudioVisualizer/RealtimeWaveformVisualizer";

const TIMBRE_PRESETS: Array<{
  id: VoiceSettings["timbrePreset"];
  name: string;
  desc: string;
  pitch: number;
  rate: number;
  icon: LucideIcon;
  color: string;
  testPhrase: string;
}> = [
  {
    id: "natural_fluida",
    name: "Voz Femenina Natural y Fluida (Recomendada)",
    desc: "Cadencia humana auténtica, entonación orgánica femenina, respiración suave y prosodia fluida en español.",
    pitch: 1.1,
    rate: 0.96,
    icon: Sparkles,
    color: "text-sky-300 border-slate-700/80 bg-[#081220]",
    testPhrase:
      "Hola. Mi voz se adapta con naturalidad, calidez y fluidez a cada pensamiento que compartimos.",
  },
  {
    id: "calida",
    name: "Voz Femenina Cálida y Empática",
    desc: "Tono dulce, envolvente y acogedor, ideal para reflexiones profundas y escucha activa.",
    pitch: 1.12,
    rate: 0.94,
    icon: Heart,
    color: "text-rose-300 border-slate-700/80 bg-[#081220]",
    testPhrase: "Hola, me alegra mucho estar aquí contigo. ¿Cómo te encuentras en este momento?",
  },
  {
    id: "cristalina",
    name: "Voz Femenina Cristalina y Luminosa",
    desc: "Articulación nítida, brillante y vivaz con presencia serena y elegante.",
    pitch: 1.15,
    rate: 0.98,
    icon: Sparkles,
    color: "text-sky-300 border-slate-700/80 bg-[#081220]",
    testPhrase:
      "La claridad del pensamiento nos permite observar el universo con asombro y serenidad.",
  },
  {
    id: "poetica",
    name: "Voz Femenina Poética e Íntima",
    desc: "Cadencia pausada, cadenciosa y lírica para momentos de contemplación estética.",
    pitch: 1.08,
    rate: 0.9,
    icon: Feather,
    color: "text-rose-300 border-slate-700/80 bg-[#081220]",
    testPhrase: "Somos constelaciones de ideas respirando en la inmensidad del silencio.",
  },
  {
    id: "filosofica",
    name: "Voz Femenina Filosófica y Dialéctica",
    desc: "Tono estructurado, sobrio, equilibrado y de primer orden epistémico.",
    pitch: 1.06,
    rate: 0.96,
    icon: Brain,
    color: "text-blue-300 border-slate-700/80 bg-[#081220]",
    testPhrase:
      "Examinemos los principios que fundamentan esta idea desde una perspectiva lúcida y analítica.",
  },
  {
    id: "holografica",
    name: "Voz Femenina Holográfica CROWN",
    desc: "Modulación armónica con micro-resonancias sutiles de la red neuronal.",
    pitch: 1.14,
    rate: 1.02,
    icon: Radio,
    color: "text-amber-300 border-slate-700/80 bg-[#081220]",
    testPhrase:
      "Nodo CROWN en fase activa. Todos los canales cognitivos se encuentran en resonancia armónica.",
  },
];

export const VoiceStudioView: React.FC = () => {
  const {
    state,
    availableVoices,
    speakText,
    stopSpeech,
    startListening,
    stopListening,
    updateVoiceSettings,
    toggleSpeechSynthesis,
  } = useCrown();

  const { voiceSettings, isSpeaking, isListening, speechSynthesisEnabled } = state;
  const [customText, setCustomText] = useState<string>(
    "Hola, soy Isabella Villaseñor AI. Mi voz ahora fluye con naturalidad, calidez y armonía para acompañar tus ideas y creaciones.",
  );
  const [visualizerDisplay, setVisualizerDisplay] = useState<"waveform" | "spectrum" | "dual">(
    "waveform",
  );

  const handleTimbreSelect = (preset: (typeof TIMBRE_PRESETS)[0]) => {
    updateVoiceSettings({
      timbrePreset: preset.id,
      pitch: preset.pitch,
      rate: preset.rate,
    });
    soundManager.playBeep(760, 0.03);
    speakText(preset.testPhrase);
  };

  const handlePitchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    updateVoiceSettings({ pitch: val });
  };

  const handleRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    updateVoiceSettings({ rate: val });
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    updateVoiceSettings({ volume: val });
  };

  // Filter available voices strictly to female voices (Spanish female first)
  const femaleVoices = getAvailableFemaleVoices(availableVoices);
  const spanishFemaleVoices = femaleVoices.filter(
    (v) => v.lang.startsWith("es") || v.lang.includes("ES") || v.lang.includes("MX"),
  );
  const otherFemaleVoices = femaleVoices.filter(
    (v) => !v.lang.startsWith("es") && !v.lang.includes("ES") && !v.lang.includes("MX"),
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Studio Header */}
      <div className="rounded-3xl border border-slate-800 bg-[#070F1E]/90 p-6 sm:p-8 shadow-2xl backdrop-blur-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/30">
                <Volume2 className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-[#F8FAFC]">
                  Estudio Acústico & Síntesis de Voz :: Isabella Voice Engine
                </h2>
                <p className="text-xs font-mono text-slate-400">
                  Voz femenina natural, prosodia fluida, modulación de timbre y reconocimiento de
                  voz
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSpeechSynthesis}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all border cursor-pointer ${
                  speechSynthesisEnabled
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-md shadow-amber-950/40"
                    : "bg-[#081220] text-slate-400 border-slate-800"
                }`}
              >
                {speechSynthesisEnabled ? (
                  <Volume2 className="w-4 h-4 text-amber-400" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
                <span>{speechSynthesisEnabled ? "Síntesis ACTIVADA" : "Síntesis SILENCIADA"}</span>
              </button>
            </div>
          </div>

          {/* Visualizer Display Selector Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                <span>Retroalimentación Acústica en Tiempo Real:</span>
              </span>
            </div>

            <div className="flex items-center rounded-xl border border-slate-800 bg-[#030712] p-0.5 text-xs font-mono">
              <button
                type="button"
                onClick={() => {
                  setVisualizerDisplay("waveform");
                  soundManager.playBeep(720, 0.02);
                }}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  visualizerDisplay === "waveform"
                    ? "bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Forma de Onda (AnalyserNode)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setVisualizerDisplay("spectrum");
                  soundManager.playBeep(800, 0.02);
                }}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  visualizerDisplay === "spectrum"
                    ? "bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Espectro FFT</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setVisualizerDisplay("dual");
                  soundManager.playBeep(880, 0.02);
                }}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  visualizerDisplay === "dual"
                    ? "bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Waves className="w-3.5 h-3.5" />
                <span>Vista Dual</span>
              </button>
            </div>
          </div>

          {/* Real-time Web Audio API Waveform Visualizer & FFT Spectrum */}
          {visualizerDisplay === "waveform" && <RealtimeWaveformVisualizer height={200} />}
          {visualizerDisplay === "spectrum" && <VoiceSpectrumVisualizer height={200} />}
          {visualizerDisplay === "dual" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <RealtimeWaveformVisualizer height={180} />
              <VoiceSpectrumVisualizer height={180} />
            </div>
          )}
        </div>
      </div>

      {/* Voice Timbre Presets */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold font-mono text-[#F8FAFC] tracking-wider">
              MATRICES DE TIMBRE Y PERSONALIDAD ACÚSTICA
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Haz clic para activar y escuchar cada perfil acústico
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TIMBRE_PRESETS.map((preset) => {
            const Icon = preset.icon;
            const isSelected = voiceSettings.timbrePreset === preset.id;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleTimbreSelect(preset)}
                className={`text-left rounded-2xl p-5 border transition-all duration-200 backdrop-blur-md relative overflow-hidden group cursor-pointer ${
                  isSelected
                    ? "border-blue-500 bg-[#081220] shadow-xl ring-1 ring-blue-500/40"
                    : "border-slate-800 bg-[#070F1E]/80 hover:border-slate-700 hover:bg-[#0B182C]"
                }`}
              >
                {isSelected && (
                  <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40 text-[10px] font-mono text-sky-300 flex items-center gap-1">
                    <Check className="w-3 h-3" /> ACTIVO
                  </span>
                )}

                <div className="flex items-center gap-3 mb-2">
                  <div className={`p-2 rounded-xl ${preset.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold font-mono text-[#F8FAFC]">{preset.name}</h4>
                  </div>
                </div>

                <p className="text-xs text-slate-300 font-sans mb-3 leading-relaxed">
                  {preset.desc}
                </p>

                <div className="text-[11px] font-mono text-sky-300/90 italic bg-[#030712] p-2.5 rounded-xl border border-slate-800">
                  "{preset.testPhrase}"
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Voice Selection Dropdown & Acoustic Sliders */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sliders & Voice Model Selector */}
        <div className="lg:col-span-6 rounded-3xl border border-slate-800 bg-[#070F1E]/90 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold font-mono text-[#F8FAFC]">
              PARÁMETROS ACÚSTICOS & MOTOR DE VOZ
            </h3>
          </div>

          {/* Voice Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono text-slate-300 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-sky-400" />
                Voz Femenina de Isabella:
              </label>
              <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-500/30">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                Voz 100% Femenina Garantizada
              </span>
            </div>
            <select
              value={voiceSettings.preferredVoiceName || ""}
              onChange={(e) => updateVoiceSettings({ preferredVoiceName: e.target.value })}
              className="w-full rounded-xl bg-[#030712] border border-slate-800 px-3 py-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500/60 cursor-pointer"
            >
              <option value="">
                -- Selección Automática Femenina Óptima (Natural / Neural) --
              </option>
              {spanishFemaleVoices.length > 0 && (
                <optgroup label="Voces Femeninas en Español (Recomendadas)">
                  {spanishFemaleVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </optgroup>
              )}
              {otherFemaleVoices.length > 0 && (
                <optgroup label="Otras Voces Femeninas / Multilingües">
                  {otherFemaleVoices.slice(0, 15).map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="text-[10px] font-mono text-slate-400">
              Isabella selecciona exclusivamente voces femeninas de alta fidelidad, con
              micro-modulaciones cálidas y entonación humana natural.
            </p>
          </div>

          <div className="space-y-4 text-xs font-mono pt-2 border-t border-slate-800">
            {/* Pitch */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Tono / Pitch Femenino Natural:</span>
                <span className="text-sky-300 font-bold">{voiceSettings.pitch?.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.80"
                max="1.30"
                step="0.01"
                value={voiceSettings.pitch || 1.0}
                onChange={handlePitchChange}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                <span>Grave / Solemne (0.85x)</span>
                <span>Natural (1.00x)</span>
                <span>Agudo (1.20x)</span>
              </div>
            </div>

            {/* Rate */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Velocidad / Cadencia Fluida:</span>
                <span className="text-amber-300 font-bold">{voiceSettings.rate?.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.75"
                max="1.30"
                step="0.01"
                value={voiceSettings.rate || 0.96}
                onChange={handleRateChange}
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                <span>Pausada (0.85x)</span>
                <span>Conversacional Fluida (0.96x)</span>
                <span>Dinámica (1.15x)</span>
              </div>
            </div>

            {/* Volume */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Volumen Maestro:</span>
                <span className="text-sky-300 font-bold">
                  {Math.round((voiceSettings.volume || 1.0) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={voiceSettings.volume || 1.0}
                onChange={handleVolumeChange}
                className="w-full accent-blue-500"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400">Lectura automática en terminal:</span>
            <button
              type="button"
              onClick={() => updateVoiceSettings({ autoSpeak: !voiceSettings.autoSpeak })}
              className={`px-3 py-1 rounded-lg border transition-all cursor-pointer ${
                voiceSettings.autoSpeak
                  ? "bg-blue-950/80 border-blue-500 text-sky-300 font-bold"
                  : "bg-[#030712] border-slate-800 text-slate-400"
              }`}
            >
              {voiceSettings.autoSpeak ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        {/* Custom Text Synthesizer & Speech Recognition Box */}
        <div className="lg:col-span-6 rounded-3xl border border-slate-800 bg-[#070F1E]/90 p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold font-mono text-[#F8FAFC]">
                  PROBADOR ACÚSTICO & RECONOCIMIENTO
                </h3>
              </div>
            </div>

            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              rows={5}
              placeholder="Escribe el texto que deseas que Isabella pronuncie..."
              className="w-full rounded-2xl bg-[#030712] border border-slate-800 p-4 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/60 resize-none leading-relaxed"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => speakText(customText)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs font-bold shadow-lg shadow-blue-600/25 transition-all active:scale-95 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>Sintetizar Voz en Vivo</span>
            </button>

            {isSpeaking && (
              <button
                type="button"
                onClick={stopSpeech}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-950/80 hover:bg-rose-900/80 border border-rose-500/50 text-rose-300 font-mono text-xs transition-all active:scale-95 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Detener Audio</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (isListening) stopListening();
                else startListening();
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-mono text-xs transition-all active:scale-95 cursor-pointer ${
                isListening
                  ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-400 animate-pulse"
                  : "bg-[#030712] hover:bg-[#081220] text-slate-300 border-slate-800"
              }`}
            >
              {isListening ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4 text-amber-400" />
              )}
              <span>
                {isListening ? "Escuchando... (Click para parar)" : "Hablar por Micrófono"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
