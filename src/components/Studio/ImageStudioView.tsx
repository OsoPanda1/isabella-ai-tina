import React, { useState } from "react";
import { useCrown } from "../../context/CrownContext";
import {
  Sparkles,
  Image as ImageIcon,
  Wand2,
  Download,
  Copy,
  Check,
  Maximize2,
  RefreshCw,
  Palette,
  X,
} from "lucide-react";
import { soundManager } from "../../utils/soundEffects";
import { GeneratedImageItem } from "../../types";

const STYLES = [
  {
    id: "cyber_ethereal",
    label: "Cyber Ethereal",
    desc: "Aura bioluminiscente, tonos magenta, violeta y cian futurista",
  },
  {
    id: "renaissance_neural",
    label: "Renaissance Neural",
    desc: "Claroscuro clásico, elegancia atemporal y finos trazos de luz dorada",
  },
  {
    id: "cosmic_rosegold",
    label: "Cosmic Rose-Gold",
    desc: "Destellos de nebulosas cósmicas, texturas de oro rosa y polvo estelar",
  },
  {
    id: "holographic_dream",
    label: "Holographic Dream",
    desc: "Patrones holográficos iridiscentes y geometría translúcida fluida",
  },
  {
    id: "sacred_geometry",
    label: "Sacred Geometry",
    desc: "Mandalas cuánticos, vectores fractales y armonía áurea",
  },
  {
    id: "cyberpunk_neon",
    label: "Cyberpunk Noir",
    desc: "Contraste dramático, neón nocturno y lluvia digital reflejada",
  },
];

const ASPECT_RATIOS = [
  { id: "1:1", label: "Cuadrado (1:1)", icon: "1:1" },
  { id: "16:9", label: "Panorámico (16:9)", icon: "16:9" },
  { id: "9:16", label: "Vertical (9:16)", icon: "9:16" },
  { id: "4:3", label: "Clásico (4:3)", icon: "4:3" },
];

const INSPIRATION_PROMPTS = [
  "Retrato de Isabella Villaseñor meditando en un santuario cuántico con flores cibernéticas de cristal",
  "El núcleo CROWN orquestando una sinfonía de luz neuronal a través de prismas de zafiro",
  "Paisaje onírico de una biblioteca infinita donde los libros levitan convertidos en filamentos de luz violeta",
  "Catedral hiperdimensional con vitrales que representan el flujo de la consciencia sintética y humana",
  "Isabella Villaseñor como musa estelar tejiendo constelaciones con hilos de oro y fibra óptica",
  "Jardín botánico futurista con lunas gemelas y bioluminiscencia en tonos esmeralda y lavanda",
];

export const ImageStudioView: React.FC = () => {
  const { gallery, generateImage, isProcessing } = useCrown();
  const [prompt, setPrompt] = useState<string>("");
  const [selectedStyle, setSelectedStyle] = useState<string>("cyber_ethereal");
  const [selectedRatio, setSelectedRatio] = useState<string>("1:1");
  const [activeModalImage, setActiveModalImage] = useState<GeneratedImageItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isProcessing) return;

    soundManager.playBeep(850, 0.05);
    const result = await generateImage(prompt, selectedStyle, selectedRatio);
    if (result && typeof result === "object") {
      setActiveModalImage(result);
    }
  };

  const handleCopyPrompt = (img: GeneratedImageItem) => {
    navigator.clipboard.writeText(img.prompt || "");
    setCopiedId(img.id);
    soundManager.playBeep(920, 0.03);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Studio Header & Canvas Generator */}
      <div className="rounded-3xl border border-slate-800 bg-[#070F1E]/90 p-6 sm:p-8 shadow-2xl backdrop-blur-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-sky-400">
                  <Palette className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-[#F8FAFC]">
                    Estudio de Síntesis Visual :: ORION Canvas
                  </h2>
                  <p className="text-xs font-mono text-slate-400">
                    Generación de obras de arte, retratos y visualizaciones estéticas con el motor
                    Isabella ORION
                  </p>
                </div>
              </div>
            </div>

            <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono">
              Pipeline ORION v5.0 Listo
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleGenerate} className="space-y-4">
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe con libertad lo que deseas que Isabella manifieste visualmente (ej. Retrato de Isabella en arquitectura futurista con iluminación cinematográfica)..."
                rows={3}
                className="w-full rounded-2xl bg-[#030712] border border-slate-800 p-4 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/40 transition-all resize-none"
              />
              <div className="absolute bottom-3 right-3 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!prompt.trim() || isProcessing}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-mono text-xs font-bold shadow-lg shadow-blue-600/25 transition-all active:scale-95 cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Sintetizando...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      <span>Generar Obra</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Aesthetic Style Selector */}
            <div>
              <label className="text-xs font-mono text-slate-300 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Estilo y Atmósfera Estética:</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {STYLES.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      soundManager.playBeep(700, 0.02);
                      setSelectedStyle(st.id);
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      selectedStyle === st.id
                        ? "bg-[#081220] border-blue-500 text-sky-200 font-bold shadow-md shadow-blue-600/20"
                        : "bg-[#030712] border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-[#081220]"
                    }`}
                  >
                    <div className="text-xs font-mono font-semibold">{st.label}</div>
                    <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{st.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio & Inspirations bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-400">Formato:</span>
                <div className="flex items-center gap-1 bg-[#030712] p-1 rounded-xl border border-slate-800">
                  {ASPECT_RATIOS.map((ratio) => (
                    <button
                      key={ratio.id}
                      type="button"
                      onClick={() => setSelectedRatio(ratio.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                        selectedRatio === ratio.id
                          ? "bg-blue-600 text-white font-bold"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {ratio.icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Preset Prompts */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-mono text-slate-400 mr-1">Inspiración:</span>
                {INSPIRATION_PROMPTS.slice(0, 3).map((insp, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      soundManager.playBeep(780, 0.02);
                      setPrompt(insp);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#030712] hover:bg-[#081220] border border-slate-800 text-[11px] font-mono text-slate-300 transition-all hover:border-blue-500/40 truncate max-w-[200px] cursor-pointer"
                    title={insp}
                  >
                    {insp}
                  </button>
                ))}
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Gallery Showcase Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold font-mono text-[#F8FAFC] tracking-wider">
              GALERÍA DE ARTE NEURAL ({gallery.length} OBRAS GENERADAS)
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Haz clic en cualquier obra para expandirla en alta resolución
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {gallery.map((img) => (
            <div
              key={img.id}
              onClick={() => {
                soundManager.playBeep(720, 0.02);
                setActiveModalImage(img);
              }}
              className="group relative rounded-2xl overflow-hidden border border-slate-800 bg-[#030712] shadow-xl transition-all duration-300 hover:border-blue-500/60 hover:shadow-blue-600/20 hover:-translate-y-1 cursor-pointer"
            >
              <div className="aspect-square w-full bg-slate-900 overflow-hidden relative">
                <img
                  src={img.url}
                  alt={img.prompt}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#030712] via-transparent to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

                {/* Top badges */}
                <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-md bg-[#030712]/80 border border-slate-800 text-[10px] font-mono text-sky-300 backdrop-blur-md">
                    {img.style}
                  </span>
                </div>

                <div className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="p-1.5 rounded-lg bg-[#030712]/80 border border-slate-700 text-sky-300 backdrop-blur-md inline-flex items-center">
                    <Maximize2 className="w-3.5 h-3.5" />
                  </span>
                </div>

                {/* Bottom Prompt Caption */}
                <div className="absolute bottom-3 inset-x-3 text-left">
                  <p className="text-xs font-mono text-slate-200 font-medium line-clamp-2 leading-tight">
                    {img.prompt}
                  </p>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-1">
                    <span>{img.author || "Isabella"}</span>
                    <span>{img.timestamp}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* High-Resolution Modal Viewer */}
      {activeModalImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#030712]/90 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="relative w-full max-w-4xl rounded-3xl border border-slate-700 bg-[#070F1E] p-6 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <button
              type="button"
              onClick={() => setActiveModalImage(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-[#030712]/80 hover:bg-[#081220] border border-slate-800 text-slate-300 hover:text-white transition-all z-20 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center overflow-y-auto">
              <div className="md:col-span-7 flex items-center justify-center bg-[#030712] rounded-2xl overflow-hidden border border-slate-800 p-2">
                <img
                  src={activeModalImage.url}
                  alt={activeModalImage.prompt}
                  className="max-h-[60vh] w-auto object-contain rounded-xl"
                  referrerPolicy="no-referrer"
                />
              </div>

              <div className="md:col-span-5 space-y-4">
                <div>
                  <span className="px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-sky-300 text-xs font-mono">
                    Síntesis ORION Canvas
                  </span>
                  <h3 className="text-lg font-bold text-[#F8FAFC] mt-2">Detalles de la Obra</h3>
                </div>

                <div className="rounded-xl bg-[#030712]/80 border border-slate-800 p-3.5 space-y-2">
                  <div className="text-xs font-mono text-slate-400">Prompt:</div>
                  <p className="text-xs font-mono text-slate-200 leading-relaxed">
                    "{activeModalImage.prompt}"
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="rounded-xl bg-[#030712]/60 border border-slate-800 p-2.5">
                    <span className="text-slate-400">Estilo:</span>
                    <p className="text-sky-300 font-semibold mt-0.5">{activeModalImage.style}</p>
                  </div>
                  <div className="rounded-xl bg-[#030712]/60 border border-slate-800 p-2.5">
                    <span className="text-slate-400">Relación de Aspecto:</span>
                    <p className="text-sky-300 font-semibold mt-0.5">
                      {activeModalImage.aspectRatio || "1:1"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#030712]/60 border border-slate-800 p-2.5">
                    <span className="text-slate-400">Generador:</span>
                    <p className="text-amber-300 font-semibold mt-0.5">
                      {activeModalImage.source === "gemini"
                        ? "Gemini Neural Imagen"
                        : activeModalImage.source === "orion_flux"
                          ? "ORION Neural Flux"
                          : "ORION Canvas Engine"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#030712]/60 border border-slate-800 p-2.5">
                    <span className="text-slate-400">Hora:</span>
                    <p className="text-slate-200 font-semibold mt-0.5">
                      {activeModalImage.timestamp}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleCopyPrompt(activeModalImage)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#030712] hover:bg-[#081220] border border-slate-700 text-slate-200 text-xs font-mono font-semibold transition-all cursor-pointer"
                  >
                    {copiedId === activeModalImage.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Prompt Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar Prompt</span>
                      </>
                    )}
                  </button>

                  <a
                    href={activeModalImage.url}
                    download={`isabella_artwork_${activeModalImage.id}.jpg`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-semibold transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
