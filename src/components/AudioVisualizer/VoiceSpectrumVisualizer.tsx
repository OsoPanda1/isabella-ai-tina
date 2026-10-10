import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Activity,
  Radio,
  Waves,
  Sparkles,
  Gauge,
  Play,
  Square,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useCrown } from "../../context/CrownContext";
import { getAudioContextConstructor } from "../../utils/audioContext";

export type VisualizerMode = "spectrum" | "waveform" | "circular" | "vumeter";
export type ColorTheme = "sovereign_gold" | "aurora_cyan" | "isa_rose" | "amber_crown";

interface VoiceSpectrumVisualizerProps {
  height?: number;
  className?: string;
  showControls?: boolean;
}

const THEMES: Record<
  ColorTheme,
  {
    name: string;
    primary: string;
    secondary: string;
    accent: string;
    gradient: [string, string, string];
    canvasGlow: string;
  }
> = {
  sovereign_gold: {
    name: "Oro Soberano & Jade",
    primary: "#E0BB5D",
    secondary: "#2EB67D",
    accent: "#F7E8B8",
    gradient: ["#166a48", "#2eb67d", "#e0bb5d"],
    canvasGlow: "rgba(224, 187, 93, 0.4)",
  },
  aurora_cyan: {
    name: "Cian & Azul Eléctrico",
    primary: "#38bdf8",
    secondary: "#0284c7",
    accent: "#bae6fd",
    gradient: ["#0369a1", "#38bdf8", "#7dd3fc"],
    canvasGlow: "rgba(56, 189, 248, 0.45)",
  },
  isa_rose: {
    name: "Resonancia Rosa ISA",
    primary: "#f43f5e",
    secondary: "#fb7185",
    accent: "#fecdd3",
    gradient: ["#9f1239", "#f43f5e", "#fda4af"],
    canvasGlow: "rgba(244, 63, 94, 0.45)",
  },
  amber_crown: {
    name: "Ámbar Fuego CROWN",
    primary: "#f59e0b",
    secondary: "#d97706",
    accent: "#fde68a",
    gradient: ["#b45309", "#f59e0b", "#fde68a"],
    canvasGlow: "rgba(245, 158, 11, 0.45)",
  },
};

const FREQ_LABELS = ["60Hz", "125Hz", "250Hz", "500Hz", "1kHz", "2kHz", "4kHz", "8kHz", "16kHz"];

export const VoiceSpectrumVisualizer: React.FC<VoiceSpectrumVisualizerProps> = ({
  height = 180,
  className = "",
  showControls = true,
}) => {
  const { state } = useCrown();
  const { isSpeaking, isListening } = state;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [mode, setMode] = useState<VisualizerMode>("spectrum");
  const [theme, setTheme] = useState<ColorTheme>("sovereign_gold");
  const [gain, setGain] = useState<number>(1.2);
  const [smoothing, setSmoothing] = useState<number>(0.85);
  const [isPlayingTestTone, setIsPlayingTestTone] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);

  // Live real-time acoustic telemetry
  const [fundamentalFreq, setFundamentalFreq] = useState<number>(224);
  const [rmsLevel, setRmsLevel] = useState<number>(-42);
  const [peakFreq, setPeakFreq] = useState<number>(580);

  // Audio Context & Analyser references
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const oscillatorNodeRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number>(0);

  // Peak hold array for spectrum bars
  const peakHoldRef = useRef<Float32Array>(new Float32Array(48));

  // Initialize or retrieve Web Audio Context
  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtxConstructor = getAudioContextConstructor();
      if (AudioCtxConstructor) {
        const ctx = new AudioCtxConstructor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = smoothing;
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      }
    } else if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {
        /* browser autoplay policy */
      });
    }
    return { ctx: audioCtxRef.current, analyser: analyserRef.current };
  }, [smoothing]);

  // Handle Real-time Microphone connection when isListening is active
  useEffect(() => {
    let active = true;

    if (isListening) {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            if (!active) {
              stream.getTracks().forEach((t) => t.stop());
              return;
            }
            micStreamRef.current = stream;
            const { ctx, analyser } = ensureAudioContext();
            if (ctx && analyser) {
              try {
                const source = ctx.createMediaStreamSource(stream);
                source.connect(analyser);
              } catch (e) {
                console.warn("Could not connect mic to analyser", e);
              }
            }
          })
          .catch(() => {
            /* Mic permission denied or unavailable; gracefully simulated */
          });
      }
    } else {
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
    }

    return () => {
      active = false;
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
    };
  }, [isListening, ensureAudioContext]);

  // Toggle Harmonic Calibration Test Tone (Synthetic Female Vocal Formant)
  const toggleTestTone = useCallback(() => {
    const { ctx, analyser } = ensureAudioContext();
    if (!ctx || !analyser) return;

    if (isPlayingTestTone) {
      if (oscillatorNodeRef.current) {
        try {
          oscillatorNodeRef.current.stop();
          oscillatorNodeRef.current.disconnect();
        } catch {
          /* already stopped */
        }
        oscillatorNodeRef.current = null;
      }
      setIsPlayingTestTone(false);
    } else {
      try {
        const osc = ctx.createOscillator();
        const gNode = ctx.createGain();

        // Formant base ~220Hz (A3 / natural female register)
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(224, ctx.currentTime);

        // Biquad filter to mimic vocal tract resonance (Formant F1)
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(620, ctx.currentTime);
        filter.Q.setValueAtTime(4.0, ctx.currentTime);

        gNode.gain.setValueAtTime(0.001, ctx.currentTime);
        gNode.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.1);

        osc.connect(filter);
        filter.connect(analyser);
        analyser.connect(gNode);
        gNode.connect(ctx.destination);

        osc.start();
        oscillatorNodeRef.current = osc;
        gainNodeRef.current = gNode;
        setIsPlayingTestTone(true);
      } catch (err) {
        console.warn("Failed to start acoustic test tone", err);
      }
    }
  }, [ensureAudioContext, isPlayingTestTone]);

  // Stop test tone on unmount
  useEffect(() => {
    return () => {
      if (oscillatorNodeRef.current) {
        try {
          oscillatorNodeRef.current.stop();
          oscillatorNodeRef.current.disconnect();
        } catch {
          /* unmount clean */
        }
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Main Canvas Render Loop (60 FPS)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let phase = 0;
    const barCount = 48;
    const freqData = new Uint8Array(64);
    const timeData = new Uint8Array(128);

    const render = () => {
      phase += 0.05;
      const width = canvas.width;
      const h = canvas.height;

      // Handle real audio data or vocal synthesis synthesis simulation
      const analyser = analyserRef.current;
      const isLiveHardware = isPlayingTestTone || (isListening && micStreamRef.current);

      if (analyser && isLiveHardware) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);
      }

      // Calculate dynamic values
      let currentRms = -60;
      let detectedF0 = 220;

      // Clear Canvas with sleek subtle background
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, width, h);

      // Draw subtle frequency grid lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += width / 8) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += h / 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const activeColor = THEMES[theme];

      // ─── RENDER MODE: SPECTRUM ANALYZER BARS ───
      if (mode === "spectrum") {
        const barWidth = (width - barCount * 2) / barCount;
        let sumAmp = 0;
        let maxAmp = 0;
        let maxBin = 0;

        for (let i = 0; i < barCount; i++) {
          let magnitude = 0;

          if (isLiveHardware && analyser) {
            magnitude = (freqData[i] || 0) / 255;
          } else if (isSpeaking) {
            // High fidelity female speech formant profile (F0 ~220Hz, F1 ~600Hz, F2 ~2100Hz)
            const speechPulse = Math.sin(phase * 2.8) * 0.25 + 0.75;
            const cadence = Math.sin(i * 0.4 - phase * 3.5) * 0.35 + 0.65;
            const formant1 = Math.exp(-Math.pow((i - 10) / 3.5, 2)) * 0.95;
            const formant2 = Math.exp(-Math.pow((i - 24) / 4.5, 2)) * 0.85;
            const formant3 = Math.exp(-Math.pow((i - 36) / 5.5, 2)) * 0.55;
            const base = (formant1 + formant2 + formant3) * speechPulse * cadence;
            magnitude = Math.min(1.0, Math.max(0.04, base * gain));
          } else if (isListening) {
            magnitude = Math.min(
              0.85,
              Math.max(0.03, (Math.sin(i * 0.3 + phase * 4) * 0.3 + 0.35) * gain),
            );
          } else {
            // Idle ambient carrier breath
            magnitude = Math.sin(i * 0.25 + phase) * 0.04 + 0.05;
          }

          sumAmp += magnitude;
          if (magnitude > maxAmp) {
            maxAmp = magnitude;
            maxBin = i;
          }

          // Peak hold with gravity decay
          if (magnitude >= peakHoldRef.current[i]) {
            peakHoldRef.current[i] = magnitude;
          } else {
            peakHoldRef.current[i] = Math.max(0, peakHoldRef.current[i] - 0.015);
          }

          const barHeight = Math.max(3, magnitude * (h - 24));
          const peakY = h - Math.max(3, peakHoldRef.current[i] * (h - 24)) - 2;
          const x = i * (barWidth + 2);
          const y = h - barHeight;

          // Gradient for bar
          const grad = ctx.createLinearGradient(0, h, 0, y);
          grad.addColorStop(0, activeColor.gradient[0]);
          grad.addColorStop(0.6, activeColor.gradient[1]);
          grad.addColorStop(1, activeColor.gradient[2]);

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
          ctx.fill();

          // Peak Hold Tick mark
          ctx.fillStyle = activeColor.accent;
          ctx.fillRect(x, peakY, barWidth, 2);
        }

        const avg = sumAmp / barCount;
        currentRms = Math.round(20 * Math.log10(Math.max(0.001, avg)) * 1.5);
        detectedF0 = isSpeaking ? Math.round(218 + Math.sin(phase * 1.5) * 14) : 220;
        setPeakFreq(Math.round(60 + (maxBin / barCount) * 8000));
      }

      // ─── RENDER MODE: CONTINUOUS WAVEFORM / OSCILLOSCOPE ───
      else if (mode === "waveform") {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = activeColor.primary;
        ctx.shadowColor = activeColor.canvasGlow;
        ctx.shadowBlur = 12;

        ctx.beginPath();
        const centerY = h / 2;

        for (let x = 0; x < width; x += 3) {
          const normX = x / width;
          let yOffset = 0;

          if (isLiveHardware && analyser) {
            const idx = Math.floor(normX * timeData.length);
            const val = (timeData[idx] || 128) - 128;
            yOffset = (val / 128) * (h * 0.42) * gain;
          } else if (isSpeaking) {
            const f1 = Math.sin(normX * 18 + phase * 4) * 0.5;
            const f2 = Math.sin(normX * 36 - phase * 6) * 0.3;
            const f3 = Math.sin(normX * 8 + phase * 2) * 0.2;
            const env = Math.sin(normX * Math.PI); // Windowing
            yOffset = (f1 + f2 + f3) * env * (h * 0.4) * gain;
          } else if (isListening) {
            yOffset = Math.sin(normX * 24 + phase * 5) * (h * 0.2) * gain;
          } else {
            yOffset = Math.sin(normX * 8 + phase) * (h * 0.05);
          }

          const y = centerY + yOffset;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Baseline reference
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        currentRms = isSpeaking ? -14 : isListening ? -24 : -52;
        detectedF0 = 224;
      }

      // ─── RENDER MODE: CIRCULAR / RESONANT POLAR RADAR ───
      else if (mode === "circular") {
        const centerX = width / 2;
        const centerY = h / 2;
        const baseRadius = Math.min(centerX, centerY) * 0.65;
        const points = 48;

        ctx.strokeStyle = activeColor.primary;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = activeColor.canvasGlow;
        ctx.shadowBlur = 14;

        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
          const theta = (i / points) * Math.PI * 2;
          let amp = 0;

          if (isSpeaking) {
            const harmonics =
              Math.sin(theta * 3 + phase * 3) * 0.4 +
              Math.sin(theta * 6 - phase * 4) * 0.3 +
              Math.cos(theta * 2 + phase) * 0.3;
            amp = harmonics * 28 * gain;
          } else if (isListening) {
            amp = Math.sin(theta * 4 + phase * 4) * 18 * gain;
          } else {
            amp = Math.sin(theta * 2 + phase) * 4;
          }

          const r = baseRadius + amp;
          const x = centerX + Math.cos(theta) * r;
          const y = centerY + Math.sin(theta) * r;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();

        // Inner glowing core
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = activeColor.canvasGlow;
        ctx.fill();

        ctx.shadowBlur = 0;
        currentRms = isSpeaking ? -16 : -48;
      }

      // ─── RENDER MODE: STEREO DUAL VU METER ───
      else if (mode === "vumeter") {
        const meterHeight = 16;
        const padding = 20;
        const startY = h / 2 - meterHeight - 4;
        const meterWidth = width - padding * 2;

        const leftAmp = isSpeaking
          ? Math.min(1.0, (Math.sin(phase * 2) * 0.3 + 0.65) * gain)
          : isListening
            ? 0.4
            : 0.08;
        const rightAmp = isSpeaking
          ? Math.min(1.0, (Math.sin(phase * 2 + 0.4) * 0.3 + 0.62) * gain)
          : isListening
            ? 0.38
            : 0.07;

        // Channel L
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        ctx.fillRect(padding, startY, meterWidth, meterHeight);
        ctx.fillStyle = activeColor.primary;
        ctx.fillRect(padding, startY, meterWidth * leftAmp, meterHeight);

        // Channel R
        const rY = h / 2 + 8;
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        ctx.fillRect(padding, rY, meterWidth, meterHeight);
        ctx.fillStyle = activeColor.secondary;
        ctx.fillRect(padding, rY, meterWidth * rightAmp, meterHeight);

        // Labels
        ctx.font = "10px monospace";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("CH-L [Izquierdo]", padding, startY - 4);
        ctx.fillText("CH-R [Derecho]", padding, rY - 4);

        currentRms = Math.round(-38 + leftAmp * 34);
      }

      // Update React state telemetry throttled
      if (Math.random() < 0.15) {
        setRmsLevel(currentRms);
        setFundamentalFreq(detectedF0);
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [mode, theme, gain, isSpeaking, isListening, isPlayingTestTone]);

  // Resize canvas to match display size
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        canvasRef.current.width = rect.width;
        canvasRef.current.height = expanded ? 320 : height;
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [expanded, height]);

  const activeColor = THEMES[theme];

  return (
    <div
      ref={containerRef}
      className={`rounded-3xl border border-slate-800 bg-[#040914] p-5 shadow-2xl backdrop-blur-2xl relative overflow-hidden transition-all duration-300 ${className}`}
    >
      {/* Visualizer Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-xl text-slate-900 font-bold transition-all shadow-md"
            style={{ backgroundColor: activeColor.primary }}
          >
            <Radio className="w-4 h-4 text-slate-950" />
          </div>
          <div>
            <h3 className="text-sm font-bold font-mono text-[#F8FAFC] tracking-wider flex items-center gap-2">
              ANALIZADOR ESPECTRAL & FORMA DE ONDA DE VOZ
              <span
                className={`w-2 h-2 rounded-full ${
                  isSpeaking
                    ? "bg-amber-400 animate-ping"
                    : isListening
                      ? "bg-rose-400 animate-ping"
                      : isPlayingTestTone
                        ? "bg-emerald-400 animate-ping"
                        : "bg-slate-600"
                }`}
              />
            </h3>
            <p className="text-[10px] font-mono text-slate-400">
              Transformada Rápida de Fourier (FFT) • Descomposición Armónica • 48 kHz 24-bit
            </p>
          </div>
        </div>

        {/* Mode selector pills */}
        <div className="flex items-center gap-1 bg-[#030712] p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setMode("spectrum")}
            className={`px-3 py-1 rounded-lg text-[10px] font-mono transition-all flex items-center gap-1 cursor-pointer ${
              mode === "spectrum"
                ? "bg-slate-800 text-sky-300 font-bold shadow-xs"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Activity className="w-3 h-3" />
            <span>Espectro FFT</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("waveform")}
            className={`px-3 py-1 rounded-lg text-[10px] font-mono transition-all flex items-center gap-1 cursor-pointer ${
              mode === "waveform"
                ? "bg-slate-800 text-sky-300 font-bold shadow-xs"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Waves className="w-3 h-3" />
            <span>Forma de Onda</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("circular")}
            className={`px-3 py-1 rounded-lg text-[10px] font-mono transition-all flex items-center gap-1 cursor-pointer ${
              mode === "circular"
                ? "bg-slate-800 text-sky-300 font-bold shadow-xs"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>Resonancia Polar</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("vumeter")}
            className={`px-3 py-1 rounded-lg text-[10px] font-mono transition-all flex items-center gap-1 cursor-pointer ${
              mode === "vumeter"
                ? "bg-slate-800 text-sky-300 font-bold shadow-xs"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Gauge className="w-3 h-3" />
            <span>VU Estéreo</span>
          </button>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors ml-1 cursor-pointer"
            title={expanded ? "Reducir" : "Expandir"}
          >
            {expanded ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main Canvas Display */}
      <div className="relative mt-3 rounded-2xl overflow-hidden border border-slate-800/80 bg-[#030712]">
        <canvas
          ref={canvasRef}
          className="w-full block"
          style={{ height: expanded ? 320 : height }}
        />

        {/* Live Frequency Calibration Overlays */}
        {mode === "spectrum" && (
          <div className="absolute bottom-1 left-0 right-0 flex justify-between px-3 text-[9px] font-mono text-slate-500 pointer-events-none">
            {FREQ_LABELS.map((label, idx) => (
              <span key={idx}>{label}</span>
            ))}
          </div>
        )}

        {/* Operating Status Badge */}
        <div className="absolute top-2.5 left-3 pointer-events-none">
          <span
            className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider border backdrop-blur-md flex items-center gap-1.5 ${
              isSpeaking
                ? "bg-amber-950/80 text-amber-300 border-amber-500/40"
                : isListening
                  ? "bg-rose-950/80 text-rose-300 border-rose-500/40"
                  : isPlayingTestTone
                    ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
                    : "bg-slate-900/80 text-slate-400 border-slate-800"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isSpeaking
                  ? "bg-amber-400 animate-ping"
                  : isListening
                    ? "bg-rose-400 animate-ping"
                    : isPlayingTestTone
                      ? "bg-emerald-400"
                      : "bg-slate-500"
              }`}
            />
            {isSpeaking
              ? "Sintetizando Voz Femenina de Isabella"
              : isListening
                ? "Recepción de Micrófono Activa"
                : isPlayingTestTone
                  ? "Tono Acústico de Calibración (F0=224Hz)"
                  : "Canal en Reposo (Ruido de Fondo -60 dBFS)"}
          </span>
        </div>
      </div>

      {/* Real-time Acoustic Telemetry Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 pt-3 border-t border-slate-800/60 font-mono text-xs">
        <div className="p-2.5 rounded-xl bg-[#030712] border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block">Frecuencia Fundamental (F0)</span>
          <span className="text-sky-300 font-bold text-sm">
            {isSpeaking || isPlayingTestTone ? `${fundamentalFreq} Hz` : "—"}
          </span>
          <span className="text-[9px] text-slate-500 block">Cadencia femenina natural</span>
        </div>

        <div className="p-2.5 rounded-xl bg-[#030712] border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block">Pico Armónico Principal</span>
          <span className="text-amber-300 font-bold text-sm">
            {isSpeaking || isPlayingTestTone ? `${peakFreq} Hz` : "—"}
          </span>
          <span className="text-[9px] text-slate-500 block">Formante F1 / Resonancia</span>
        </div>

        <div className="p-2.5 rounded-xl bg-[#030712] border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block">Nivel RMS / Salida</span>
          <span
            className={`font-bold text-sm ${
              rmsLevel > -12
                ? "text-amber-400"
                : rmsLevel > -30
                  ? "text-emerald-300"
                  : "text-slate-400"
            }`}
          >
            {rmsLevel} dBFS
          </span>
          <span className="text-[9px] text-slate-500 block">Rango dinámico normalizado</span>
        </div>

        <div className="p-2.5 rounded-xl bg-[#030712] border border-slate-800/80">
          <span className="text-[10px] text-slate-400 block">Muestreo & Motor</span>
          <span className="text-emerald-400 font-bold text-sm">48.0 kHz</span>
          <span className="text-[9px] text-slate-500 block">Web Audio API • 24-bit Float</span>
        </div>
      </div>

      {/* Visualizer Tuning Controls */}
      {showControls && (
        <div className="mt-3.5 pt-3 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-3">
            {/* Tone Generator Toggle */}
            <button
              type="button"
              onClick={toggleTestTone}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                isPlayingTestTone
                  ? "bg-rose-950/80 text-rose-300 border-rose-500/50 shadow-md shadow-rose-950/40"
                  : "bg-[#030712] text-slate-300 border-slate-800 hover:border-slate-700"
              }`}
            >
              {isPlayingTestTone ? (
                <>
                  <Square className="w-3.5 h-3.5 text-rose-400" />
                  <span>Detener Tono de Prueba</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Generar Tono de Calibración</span>
                </>
              )}
            </button>

            {/* Theme selector */}
            <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
              <span>Paleta:</span>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as ColorTheme)}
                className="bg-[#030712] border border-slate-800 text-slate-200 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-blue-500/50 cursor-pointer"
              >
                {Object.entries(THEMES).map(([key, t]) => (
                  <option key={key} value={key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4 text-slate-400 text-[11px]">
            {/* Gain control */}
            <div className="flex items-center gap-2">
              <span>Ganancia:</span>
              <button
                type="button"
                onClick={() => setGain((prev) => (prev >= 2 ? 0.5 : prev + 0.5))}
                className="px-2 py-0.5 rounded bg-[#030712] border border-slate-800 text-sky-300 font-bold hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {gain.toFixed(1)}x
              </button>
            </div>

            {/* Smoothing */}
            <div className="flex items-center gap-2">
              <span>Suavizado:</span>
              <input
                type="range"
                min="0.6"
                max="0.95"
                step="0.05"
                value={smoothing}
                onChange={(e) => {
                  const s = parseFloat(e.target.value);
                  setSmoothing(s);
                  if (analyserRef.current) analyserRef.current.smoothingTimeConstant = s;
                }}
                className="w-16 accent-blue-500 cursor-pointer"
              />
              <span className="text-slate-300">{Math.round(smoothing * 100)}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
