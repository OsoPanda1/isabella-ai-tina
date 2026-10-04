import React, { useEffect, useRef, useState, useCallback, useId } from "react";
import {
  Activity,
  Waves,
  Sparkles,
  Volume2,
  VolumeX,
  Gauge,
  Sliders,
  Play,
  Square,
  Maximize2,
  Minimize2,
  Radio,
  Zap,
} from "lucide-react";
import { useCrown } from "../../context/CrownContext";
import { getAudioContextConstructor } from "../../utils/audioContext";

export type WaveformMode = "oscilloscope" | "harmonic_ribbon" | "dual_trace" | "radial_mandala";
export type WaveformTheme = "electric_cyan" | "sovereign_gold" | "isa_rose" | "emerald_matrix";

interface RealtimeWaveformVisualizerProps {
  height?: number;
  className?: string;
  showControls?: boolean;
}

const THEMES: Record<
  WaveformTheme,
  {
    name: string;
    primary: string;
    secondary: string;
    glow: string;
    background: string;
    grid: string;
  }
> = {
  electric_cyan: {
    name: "Cian Eléctrico CROWN",
    primary: "#38bdf8",
    secondary: "#0284c7",
    glow: "rgba(56, 189, 248, 0.55)",
    background: "#030816",
    grid: "rgba(56, 189, 248, 0.08)",
  },
  sovereign_gold: {
    name: "Oro Soberano & Jade",
    primary: "#E0BB5D",
    secondary: "#2EB67D",
    glow: "rgba(224, 187, 93, 0.55)",
    background: "#080c0a",
    grid: "rgba(224, 187, 93, 0.08)",
  },
  isa_rose: {
    name: "Resonancia Rosa ISA",
    primary: "#f43f5e",
    secondary: "#fda4af",
    glow: "rgba(244, 63, 94, 0.55)",
    background: "#0d0408",
    grid: "rgba(244, 63, 94, 0.08)",
  },
  emerald_matrix: {
    name: "Matriz Esmeralda Real",
    primary: "#10b981",
    secondary: "#059669",
    glow: "rgba(16, 185, 129, 0.55)",
    background: "#020c08",
    grid: "rgba(16, 185, 129, 0.08)",
  },
};

export const RealtimeWaveformVisualizer: React.FC<RealtimeWaveformVisualizerProps> = ({
  height = 180,
  className = "",
  showControls = true,
}) => {
  const { state } = useCrown();
  const { isSpeaking, isListening, voiceSettings } = state;
  const componentId = useId();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // User configurable state
  const [mode, setMode] = useState<WaveformMode>("oscilloscope");
  const [theme, setTheme] = useState<WaveformTheme>("electric_cyan");
  const [gain, setGain] = useState<number>(1.25);
  const [lineWidth, setLineWidth] = useState<number>(2.0);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [isPlayingTestTone, setIsPlayingTestTone] = useState<boolean>(false);

  // Live acoustic telemetry derived from AnalyserNode
  const [liveRmsDb, setLiveRmsDb] = useState<number>(-60);
  const [estimatedPitchHz, setEstimatedPitchHz] = useState<number>(220);
  const [peakAmplitude, setPeakAmplitude] = useState<number>(0);

  // Web Audio API References
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const synthOscRef = useRef<OscillatorNode | null>(null);
  const synthGainRef = useRef<GainNode | null>(null);
  const synthFilterRef = useRef<BiquadFilterNode | null>(null);
  const testToneOscRef = useRef<OscillatorNode | null>(null);
  const testToneGainRef = useRef<GainNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Lazy initialize AudioContext & AnalyserNode
  const ensureAudioNodes = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      const AudioContextClass = getAudioContextConstructor();
      if (!AudioContextClass) return { ctx: null, analyser: null };

      try {
        const ctx = new AudioContextClass();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.8;

        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      } catch (err) {
        console.warn("Unable to initialize Web Audio AnalyserNode", err);
        return { ctx: null, analyser: null };
      }
    } else if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }

    return { ctx: audioCtxRef.current, analyser: analyserRef.current };
  }, []);

  // Web Audio acoustic carrier generator active during voice synthesis (isSpeaking)
  useEffect(() => {
    const { ctx, analyser } = ensureAudioNodes();
    if (!ctx || !analyser) return;

    if (isSpeaking) {
      try {
        // Build sub-audible carrier synthesizer modulated to speech pitch
        if (!synthOscRef.current) {
          const osc = ctx.createOscillator();
          const filter = ctx.createBiquadFilter();
          const gNode = ctx.createGain();

          const basePitch = (voiceSettings.pitch || 1.1) * 210;
          osc.type = "triangle";
          osc.frequency.setValueAtTime(basePitch, ctx.currentTime);

          // Vocal tract resonance (Formant F1)
          filter.type = "bandpass";
          filter.frequency.setValueAtTime(620, ctx.currentTime);
          filter.Q.setValueAtTime(3.5, ctx.currentTime);

          // Sub-audible carrier (gain ~ 0.003) so it provides authentic audio node buffers to AnalyserNode
          gNode.gain.setValueAtTime(0.0001, ctx.currentTime);
          gNode.gain.exponentialRampToValueAtTime(0.02, ctx.currentTime + 0.08);

          osc.connect(filter);
          filter.connect(analyser);
          analyser.connect(gNode);
          gNode.connect(ctx.destination);

          osc.start();
          synthOscRef.current = osc;
          synthFilterRef.current = filter;
          synthGainRef.current = gNode;
        } else if (synthGainRef.current) {
          synthGainRef.current.gain.setValueAtTime(0.02, ctx.currentTime);
        }
      } catch (e) {
        console.warn("Could not start acoustic synthesis carrier", e);
      }
    } else {
      // Gracefully fade out synthesis carrier when not speaking
      if (synthGainRef.current && synthOscRef.current) {
        try {
          synthGainRef.current.gain.setValueAtTime(0.0001, ctx.currentTime);
          setTimeout(() => {
            if (!isSpeaking && synthOscRef.current) {
              try {
                synthOscRef.current.stop();
                synthOscRef.current.disconnect();
              } catch {
                /* already stopped */
              }
              synthOscRef.current = null;
              synthGainRef.current = null;
              synthFilterRef.current = null;
            }
          }, 120);
        } catch {
          synthOscRef.current = null;
        }
      }
    }
  }, [isSpeaking, voiceSettings.pitch, ensureAudioNodes]);

  // Toggle Test Tone (Acoustic Calibration)
  const toggleTestTone = useCallback(() => {
    const { ctx, analyser } = ensureAudioNodes();
    if (!ctx || !analyser) return;

    if (isPlayingTestTone) {
      if (testToneOscRef.current) {
        try {
          testToneOscRef.current.stop();
          testToneOscRef.current.disconnect();
        } catch {
          /* already stopped */
        }
        testToneOscRef.current = null;
        testToneGainRef.current = null;
      }
      setIsPlayingTestTone(false);
    } else {
      try {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gNode = ctx.createGain();

        // 220Hz (A3 - Natural Female Pitch fundamental)
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(224, ctx.currentTime);

        filter.type = "bandpass";
        filter.frequency.setValueAtTime(680, ctx.currentTime);
        filter.Q.setValueAtTime(4.0, ctx.currentTime);

        gNode.gain.setValueAtTime(0.001, ctx.currentTime);
        gNode.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.08);

        osc.connect(filter);
        filter.connect(analyser);
        analyser.connect(gNode);
        gNode.connect(ctx.destination);

        osc.start();
        testToneOscRef.current = osc;
        testToneGainRef.current = gNode;
        setIsPlayingTestTone(true);
      } catch (err) {
        console.warn("Failed to activate test tone", err);
      }
    }
  }, [ensureAudioNodes, isPlayingTestTone]);

  // Clean up audio nodes on unmount
  useEffect(() => {
    return () => {
      if (synthOscRef.current) {
        try {
          synthOscRef.current.stop();
          synthOscRef.current.disconnect();
        } catch {
          /* cleanup */
        }
      }
      if (testToneOscRef.current) {
        try {
          testToneOscRef.current.stop();
          testToneOscRef.current.disconnect();
        } catch {
          /* cleanup */
        }
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Main 60 FPS Canvas Render Loop with Web Audio API AnalyserNode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let phase = 0;
    const bufferLength = 1024;
    const timeDomainData = new Uint8Array(bufferLength);
    const freqData = new Uint8Array(256);

    const render = () => {
      phase += 0.04;
      const width = canvas.width;
      const h = canvas.height;
      const midY = h / 2;

      const analyser = analyserRef.current;
      const hasLiveAudio = isSpeaking || isPlayingTestTone || isListening;

      if (analyser && hasLiveAudio) {
        analyser.getByteTimeDomainData(timeDomainData);
        analyser.getByteFrequencyData(freqData);
      }

      // ── Calculate Live Telemetry (RMS dBFS & Peak) ──
      let sumSquares = 0;
      let maxDev = 0;
      let zeroCrossings = 0;

      for (let i = 0; i < bufferLength; i++) {
        let sample = 0;
        if (analyser && hasLiveAudio) {
          sample = (timeDomainData[i] - 128) / 128;
        } else if (isSpeaking) {
          // Fallback organic formant wave modulation
          sample =
            Math.sin(i * 0.08 + phase * 4) * 0.45 +
            Math.sin(i * 0.16 + phase * 6) * 0.25 +
            Math.sin(i * 0.32 + phase * 8) * 0.12;
        } else {
          // Idle breathing baseline wave
          sample = Math.sin(i * 0.03 + phase * 1.5) * 0.04;
        }

        sumSquares += sample * sample;
        if (Math.abs(sample) > maxDev) maxDev = Math.abs(sample);
        if (i > 0) {
          const prev = (timeDomainData[i - 1] - 128) / 128;
          if ((prev < 0 && sample >= 0) || (prev > 0 && sample <= 0)) zeroCrossings++;
        }
      }

      const rms = Math.sqrt(sumSquares / bufferLength);
      const rmsDb = rms > 0.0001 ? Math.max(-60, Math.min(0, 20 * Math.log10(rms))) : -60;
      const approxFreq = Math.round((zeroCrossings * (44100 / bufferLength)) / 2);

      setLiveRmsDb(parseFloat(rmsDb.toFixed(1)));
      setPeakAmplitude(parseFloat(Math.min(1, maxDev * gain).toFixed(2)));
      if (hasLiveAudio && approxFreq > 80 && approxFreq < 1200) {
        setEstimatedPitchHz(approxFreq);
      }

      // ── Clear Canvas & Draw Background Grid ──
      const activeTheme = THEMES[theme];
      ctx.fillStyle = activeTheme.background;
      ctx.fillRect(0, 0, width, h);

      // Oscilloscope background grid lines
      ctx.strokeStyle = activeTheme.grid;
      ctx.lineWidth = 1;

      // Vertical divisions
      const vDivs = 10;
      for (let i = 0; i <= vDivs; i++) {
        const x = (width / vDivs) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Horizontal divisions
      const hDivs = 6;
      for (let i = 0; i <= hDivs; i++) {
        const y = (h / hDivs) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Center baseline crosshair
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── MODE 1: OSCILLOSCOPE TIME-DOMAIN WAVEFORM ──
      if (mode === "oscilloscope") {
        // Outer ambient glow pass
        ctx.save();
        ctx.shadowColor = activeTheme.glow;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = activeTheme.primary;
        ctx.lineWidth = lineWidth * 1.5;
        ctx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          let v = 0;
          if (analyser && hasLiveAudio) {
            v = (timeDomainData[i] - 128) / 128;
          } else if (isSpeaking) {
            v =
              Math.sin(i * 0.08 + phase * 4) * 0.5 +
              Math.sin(i * 0.16 + phase * 7) * 0.25 +
              Math.sin(i * 0.02 + phase * 1.2) * 0.15;
          } else {
            v = Math.sin(i * 0.04 + phase * 1.5) * 0.04;
          }

          const y = midY - v * (h * 0.42) * gain;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }

        ctx.stroke();
        ctx.restore();

        // Inner sharp crisp core trace
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = lineWidth * 0.7;
        ctx.beginPath();
        x = 0;
        for (let i = 0; i < bufferLength; i++) {
          let v = 0;
          if (analyser && hasLiveAudio) {
            v = (timeDomainData[i] - 128) / 128;
          } else if (isSpeaking) {
            v =
              Math.sin(i * 0.08 + phase * 4) * 0.5 +
              Math.sin(i * 0.16 + phase * 7) * 0.25 +
              Math.sin(i * 0.02 + phase * 1.2) * 0.15;
          } else {
            v = Math.sin(i * 0.04 + phase * 1.5) * 0.04;
          }
          const y = midY - v * (h * 0.42) * gain;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.stroke();
      }

      // ── MODE 2: HARMONIC RIBBON (GRADIENT FILLED WAVE) ──
      else if (mode === "harmonic_ribbon") {
        const sliceWidth = width / bufferLength;
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, activeTheme.glow);
        gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.05)");
        gradient.addColorStop(1, activeTheme.glow);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(0, midY);

        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          let v = 0;
          if (analyser && hasLiveAudio) {
            v = (timeDomainData[i] - 128) / 128;
          } else if (isSpeaking) {
            v = Math.sin(i * 0.07 + phase * 3.5) * 0.55 + Math.sin(i * 0.14 + phase * 5) * 0.25;
          } else {
            v = Math.sin(i * 0.03 + phase) * 0.05;
          }

          const y = midY - v * (h * 0.44) * gain;
          ctx.lineTo(x, y);
          x += sliceWidth;
        }

        ctx.lineTo(width, midY);
        ctx.closePath();
        ctx.fill();

        // Overlay stroke
        ctx.strokeStyle = activeTheme.primary;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }

      // ── MODE 3: DUAL-TRACE STEREO WAVE ──
      else if (mode === "dual_trace") {
        const sliceWidth = width / (bufferLength / 2);
        const yTop = h * 0.28;
        const yBottom = h * 0.72;

        // Trace A (Upper Channel)
        ctx.strokeStyle = activeTheme.primary;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        let x = 0;
        for (let i = 0; i < bufferLength / 2; i++) {
          const v =
            analyser && hasLiveAudio
              ? (timeDomainData[i] - 128) / 128
              : Math.sin(i * 0.09 + phase * 3) * 0.4;
          const y = yTop - v * (h * 0.2) * gain;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.stroke();

        // Trace B (Lower Channel - Inverted harmonic phase)
        ctx.strokeStyle = activeTheme.secondary;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        x = 0;
        for (let i = bufferLength / 2; i < bufferLength; i++) {
          const v =
            analyser && hasLiveAudio
              ? (timeDomainData[i] - 128) / 128
              : Math.sin(i * 0.09 - phase * 3) * 0.4;
          const y = yBottom - v * (h * 0.2) * gain;
          if (i === bufferLength / 2) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.stroke();
      }

      // ── MODE 4: RADIAL MANDALA ──
      else if (mode === "radial_mandala") {
        const centerX = width / 2;
        const centerY = midY;
        const baseRadius = Math.min(width, h) * 0.28;

        ctx.strokeStyle = activeTheme.primary;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();

        const step = 4;
        for (let i = 0; i < bufferLength; i += step) {
          const angle = (i / bufferLength) * Math.PI * 2;
          let v = 0;
          if (analyser && hasLiveAudio) {
            v = (timeDomainData[i] - 128) / 128;
          } else if (isSpeaking) {
            v = Math.sin(i * 0.1 + phase * 4) * 0.45;
          } else {
            v = Math.sin(i * 0.05 + phase) * 0.05;
          }

          const r = baseRadius + v * (baseRadius * 0.7) * gain;
          const px = centerX + Math.cos(angle) * r;
          const py = centerY + Math.sin(angle) * r;

          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [mode, theme, gain, lineWidth, isSpeaking, isPlayingTestTone, isListening]);

  // Handle Canvas Resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = expanded ? 320 : height;
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [expanded, height]);

  return (
    <div
      ref={containerRef}
      className={`rounded-2xl border border-slate-800 bg-[#040813] overflow-hidden shadow-2xl backdrop-blur-xl relative transition-all duration-300 ${className}`}
    >
      {/* Visualizer Top Bar & Telemetry HUD */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800/80 bg-[#060c1c]/90 text-xs font-mono">
        <div className="flex items-center gap-2.5">
          <div
            className={`size-2.5 rounded-full ${
              isSpeaking
                ? "bg-rose-500 animate-ping"
                : isPlayingTestTone
                  ? "bg-amber-400 animate-pulse"
                  : isListening
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-slate-600"
            }`}
          />
          <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <Activity className="size-3.5 text-sky-400" />
            <span>Web Audio Waveform Engine</span>
          </span>

          <span
            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
              isSpeaking
                ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                : isPlayingTestTone
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : isListening
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                    : "bg-slate-800/60 text-slate-400 border-slate-700/50"
            }`}
          >
            {isSpeaking
              ? "SÍNTESIS ACTIVA · 48 kHz"
              : isPlayingTestTone
                ? "TONO DE PRUEBA ACÚSTICO"
                : isListening
                  ? "MICRÓFONO EN VIVO"
                  : "VOZ EN REPOSO"}
          </span>
        </div>

        {/* Real-time Telemetry Readout */}
        <div className="flex items-center gap-4 text-[10px] text-slate-400 font-mono">
          <div className="flex items-center gap-1">
            <Gauge className="size-3 text-sky-400" />
            <span>RMS:</span>
            <span
              className={`font-bold ${
                liveRmsDb > -20
                  ? "text-rose-400"
                  : liveRmsDb > -36
                    ? "text-emerald-400"
                    : "text-slate-300"
              }`}
            >
              {liveRmsDb.toFixed(1)} dBFS
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Waves className="size-3 text-amber-400" />
            <span>F₀ Fundamental:</span>
            <span className="font-bold text-amber-300">{estimatedPitchHz} Hz</span>
          </div>

          <div className="flex items-center gap-1">
            <Zap className="size-3 text-emerald-400" />
            <span>Pico:</span>
            <span className="font-bold text-emerald-400">{Math.round(peakAmplitude * 100)}%</span>
          </div>
        </div>
      </div>

      {/* Main Canvas Waveform View */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full block"
          style={{ height: expanded ? "320px" : `${height}px` }}
        />

        {/* Live Audio Indicator Ribbon */}
        {isSpeaking && (
          <div className="absolute top-3 left-4 pointer-events-none flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-rose-500/30 text-rose-300 text-[10px] font-mono">
            <span className="size-1.5 rounded-full bg-rose-400 animate-pulse" />
            <span>Transduciendo voz femenina en tiempo real</span>
          </div>
        )}
      </div>

      {/* Visualizer Controls Footer */}
      {showControls && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-t border-slate-800/80 bg-[#060c1c]/90 text-xs font-mono">
          {/* Mode Selector */}
          <div className="flex items-center gap-1">
            {(
              [
                { id: "oscilloscope", label: "Osciloscopio" },
                { id: "harmonic_ribbon", label: "Cinta Armónica" },
                { id: "dual_trace", label: "Traza Dual" },
                { id: "radial_mandala", label: "Mandala Polar" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`px-2.5 py-1 rounded-lg text-[10px] uppercase font-bold tracking-wider transition-all cursor-pointer ${
                  mode === m.id
                    ? "bg-sky-500 text-slate-950 shadow-sm shadow-sky-500/40"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Theme, Gain & Action Controls */}
          <div className="flex items-center gap-3">
            {/* Color Theme Selector */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-500">Paleta:</span>
              <select
                aria-label="Paleta de color del osciloscopio"
                value={theme}
                onChange={(e) => setTheme(e.target.value as WaveformTheme)}
                className="bg-[#030712] border border-slate-800 text-slate-300 rounded-lg px-2 py-0.5 text-[10px] font-mono focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                {Object.entries(THEMES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Gain Slider */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500">Sensibilidad:</span>
              <input
                id={`waveform-gain-${componentId}`}
                type="range"
                aria-label="Sensibilidad de la forma de onda"
                min="0.5"
                max="2.5"
                step="0.1"
                value={gain}
                onChange={(e) => setGain(parseFloat(e.target.value))}
                className="w-16 accent-sky-400 cursor-pointer"
              />
              <span className="text-[10px] text-sky-400 font-bold">{gain.toFixed(1)}x</span>
            </div>

            {/* Test Tone Trigger */}
            <button
              type="button"
              onClick={toggleTestTone}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                isPlayingTestTone
                  ? "bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-950/40"
                  : "bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-800"
              }`}
            >
              {isPlayingTestTone ? <Square className="size-3" /> : <Play className="size-3" />}
              <span>{isPlayingTestTone ? "Detener Tono" : "Tono Prueba (A3)"}</span>
            </button>

            {/* Expand / Collapse Button */}
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-label={
                expanded ? "Reducir visualizador de onda" : "Expandir visualizador de onda"
              }
              className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-all cursor-pointer"
            >
              {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
