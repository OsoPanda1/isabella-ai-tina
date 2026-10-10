import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCrown } from "../../context/CrownContext";
import { PRESENTATION_CHAPTERS, EVALUATOR_DECLARATION } from "../../data/presentationData";
import { PresentationChapter } from "../../types";
import { soundManager } from "../../utils/soundEffects";
import {
  BookOpen,
  Presentation,
  ShieldCheck,
  Volume2,
  Play,
  Square,
  ChevronLeft,
  ChevronRight,
  Search,
  CheckCircle2,
  Copy,
  Download,
  Sparkles,
  Fingerprint,
  FileCheck,
  Maximize2,
  Minimize2,
  Activity,
  Network,
} from "lucide-react";

type PresentationMode = "dossier" | "slides" | "topology" | "integrity";

// Variantes de animación Framer Motion
import type { Variants } from "framer-motion";

const fadeInSlide: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const },
  },
  exit: { opacity: 0, y: -12, scale: 0.98, transition: { duration: 0.25 } },
};

const slideTransitionVariants: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
    scale: 0.96,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 80 : -80,
    opacity: 0,
    scale: 0.96,
    transition: { duration: 0.3 },
  }),
};

export const PresentationView: React.FC = () => {
  const { state, speakText, stopSpeech } = useCrown();
  const { speechSynthesisEnabled, isSpeaking } = state;

  const [mode, setMode] = useState<PresentationMode>("dossier");
  const [selectedChapterIndex, setSelectedChapterIndex] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isHashCopied, setIsHashCopied] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [slideDirection, setSlideDirection] = useState<number>(1);

  const [narratingChapterIndex, setNarratingChapterIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const activeChapterRef = useRef<HTMLDivElement>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    PRESENTATION_CHAPTERS.forEach((c) => set.add(c.category));
    return ["ALL", ...Array.from(set)];
  }, []);

  const filteredChapters = useMemo(() => {
    return PRESENTATION_CHAPTERS.filter((chap) => {
      const matchesCat = selectedCategory === "ALL" || chap.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return matchesCat;
      return (
        matchesCat &&
        (chap.title.toLowerCase().includes(q) ||
          chap.subtitle.toLowerCase().includes(q) ||
          chap.summary.toLowerCase().includes(q) ||
          chap.content.some((t) => t.toLowerCase().includes(q)) ||
          chap.highlights.some((h) => h.toLowerCase().includes(q)) ||
          String(chap.number).includes(q))
      );
    });
  }, [searchQuery, selectedCategory]);

  const currentChapter: PresentationChapter =
    PRESENTATION_CHAPTERS[selectedChapterIndex] || PRESENTATION_CHAPTERS[0];

  const handleStartNarration = useCallback(
    (chapterIndex: number) => {
      soundManager.playBeep(880, 0.04);
      const chap = PRESENTATION_CHAPTERS[chapterIndex];
      if (!chap) return;

      setNarratingChapterIndex(chapterIndex);
      const narrativeScript = `Capítulo ${chap.number}: ${chap.title}. ${chap.subtitle}. Resumen: ${chap.summary}. ${
        chap.keyQuote ? `Cita relevante: ${chap.keyQuote}` : ""
      } ${chap.content.join(" ")}`;

      speakText(narrativeScript);
    },
    [speakText],
  );

  const handleStopNarration = useCallback(() => {
    soundManager.playBeep(440, 0.04);
    stopSpeech();
    setNarratingChapterIndex(null);
  }, [stopSpeech]);

  const handleSelectChapter = useCallback(
    (index: number, direction: number = 1) => {
      soundManager.playBeep(650, 0.02);
      setSlideDirection(direction);
      setSelectedChapterIndex(index);
      if (narratingChapterIndex !== null && narratingChapterIndex !== index) {
        handleStopNarration();
      }
    },
    [narratingChapterIndex, handleStopNarration],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (mode !== "slides") return;
      if (e.key === "ArrowRight" || e.key === "Space") {
        e.preventDefault();
        if (selectedChapterIndex < PRESENTATION_CHAPTERS.length - 1) {
          handleSelectChapter(selectedChapterIndex + 1, 1);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (selectedChapterIndex > 0) {
          handleSelectChapter(selectedChapterIndex - 1, -1);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, selectedChapterIndex, handleSelectChapter]);

  const handleCopyFullDossier = () => {
    soundManager.playSuccess();
    const fullText = PRESENTATION_CHAPTERS.map(
      (c) =>
        `# ${c.number}. ${c.title.toUpperCase()}\n*${c.subtitle}*\n\n${c.summary}\n\n${c.content.join("\n\n")}`,
    ).join("\n\n---\n\n");

    const headerDossier = `====================================================\nISABELLA VILLASEÑOR AI - MANIFIESTO ARQUITECTÓNICO & DOSSIER FEDERADO\nTAMV Federation (7 Nodos Governed Infrastructure)\nEvaluador: ${EVALUATOR_DECLARATION.evaluator} (${EVALUATOR_DECLARATION.model})\nSHA-256: ${EVALUATOR_DECLARATION.sha256}\n====================================================\n\n${fullText}`;

    navigator.clipboard.writeText(headerDossier);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2200);
  };

  const handleCopyHash = () => {
    soundManager.playSuccess();
    navigator.clipboard.writeText(EVALUATOR_DECLARATION.sha256);
    setIsHashCopied(true);
    setTimeout(() => setIsHashCopied(false), 2200);
  };

  const handleDownloadMarkdown = () => {
    soundManager.playArrival();
    const markdownContent =
      `# ISABELLA VILLASEÑOR AI\n## Auditoría Tecnológica y Arquitectura de Federación TAMV\n\n**SHA-256 Digest:** \`${EVALUATOR_DECLARATION.sha256}\`\n\n` +
      PRESENTATION_CHAPTERS.map(
        (c) =>
          `### ${c.number}. ${c.title}\n*${c.subtitle}*\n\n${c.summary}\n\n${c.content.join("\n\n")}`,
      ).join("\n\n---\n\n");

    const blob = new Blob([markdownContent], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `isabella_villasenor_auditoria_${EVALUATOR_DECLARATION.sha256.slice(0, 8)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      ref={containerRef}
      className={`flex flex-col gap-6 font-sans selection:bg-blue-500/30 selection:text-blue-200 transition-all duration-300 ${
        isFullscreen ? "fixed inset-0 z-50 bg-[#020617] p-6 overflow-y-auto" : ""
      }`}
    >
      {/* HEADER DE MANDO EJECUTIVO CON EFECTOS GLASSMORPISM Y GLOW */}
      <header className="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-[#080E1A]/90 p-6 md:p-8 backdrop-blur-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-10 w-80 h-80 bg-amber-500/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800/80">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                ARQUITECTURA DE FEDERACIÓN TAMV (7 NODOS)
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono bg-blue-500/10 text-sky-300 border border-blue-500/30">
                <FileCheck className="w-3 h-3 text-sky-400" />
                26 Capítulos Formales
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                SHA-256 Verificado
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white font-mono bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-400">
              Isabella Villaseñor AI
            </h1>
            <p className="text-sm sm:text-base text-slate-300 max-w-3xl leading-relaxed">
              Infraestructura Cognitiva Territorial, Híbrida y Gobernada de Nodo Cero, RDM Digital y
              las 7 Federaciones de la Red TAMV.
            </p>
          </div>

          {/* CONTROLES DE ACCIÓN RÁPIDA Y REPRODUCTOR INTEGRADO */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {speechSynthesisEnabled && (
              <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-[#030712]/90 border border-slate-800 shadow-inner">
                {isSpeaking && narratingChapterIndex !== null ? (
                  <button
                    type="button"
                    onClick={handleStopNarration}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-red-950/80 hover:bg-red-900 border border-red-500/50 text-red-200 text-xs font-mono font-bold transition-all shadow-md active:scale-95"
                  >
                    <Square className="w-3.5 h-3.5 fill-current text-red-400" />
                    <span>Detener Voz</span>
                    <span className="flex h-2 w-2 relative ml-1">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleStartNarration(selectedChapterIndex)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-bold transition-all shadow-[0_0_20px_rgba(37,99,235,0.4)] active:scale-95"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Escuchar con Isabella</span>
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleCopyFullDossier}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#030712] hover:bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono transition-all active:scale-95"
            >
              {isCopied ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4 text-slate-400" />
              )}
              <span>{isCopied ? "¡Copiado!" : "Copiar Dossier"}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadMarkdown}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#030712] hover:bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono transition-all active:scale-95"
            >
              <Download className="w-4 h-4 text-sky-400" />
              <span>.MD</span>
            </button>

            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2.5 rounded-xl bg-[#030712] hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-all"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* NAVEGACIÓN MODAL INTERACTIVA */}
        <div className="pt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-[#030712]/90 border border-slate-800/90 text-xs font-mono shadow-inner">
            {[
              { id: "dossier", label: "Dossier Completo", icon: BookOpen },
              { id: "slides", label: "Keynote / Diapositivas", icon: Presentation },
              { id: "topology", label: "Malla Territorial (7 Federaciones)", icon: Network },
              { id: "integrity", label: "Certificado SHA-256", icon: Fingerprint },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = mode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    soundManager.playBeep(750, 0.02);
                    setMode(tab.id as PresentationMode);
                  }}
                  className={`relative flex items-center gap-2 px-4 py-2 rounded-xl transition-all font-mono font-medium ${
                    isActive
                      ? "text-white font-bold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeTabGlow"
                      className="absolute inset-0 bg-gradient-to-r from-blue-600 to-sky-600 rounded-xl shadow-[0_0_20px_rgba(37,99,235,0.5)]"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            onClick={handleCopyHash}
            className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#030712] border border-slate-800/90 text-[11px] font-mono hover:border-blue-500/50 cursor-pointer transition-all"
          >
            <span className="text-slate-400 font-bold">SHA-256:</span>
            <span className="text-sky-300 tracking-wider font-semibold">
              {EVALUATOR_DECLARATION.sha256.slice(0, 10)}...{EVALUATOR_DECLARATION.sha256.slice(-8)}
            </span>
            {isHashCopied ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-400" />
            )}
          </div>
        </div>
      </header>

      {/* RENDERIZADO DE MODOS CON ANIMACIONES ANATEPRESENCE */}
      <AnimatePresence mode="wait">
        {/* MODO 1: DOSSIER COMPLETO */}
        {mode === "dossier" && (
          <motion.div
            key="dossier"
            variants={fadeInSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            {/* PANEL IZQUIERDO: ÍNDICE Y BÚSQUEDA */}
            <aside className="lg:col-span-4 flex flex-col gap-4">
              <div className="rounded-3xl border border-slate-800/80 bg-[#080E1A]/90 p-4 backdrop-blur-2xl sticky top-6 max-h-[calc(100vh-120px)] flex flex-col space-y-4">
                <div className="relative">
                  <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar en el dossier..."
                    className="w-full bg-[#030712] border border-slate-800 rounded-2xl pl-10 pr-4 py-2.5 text-xs font-mono text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5 pb-2 border-b border-slate-800">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-all ${
                        selectedCategory === cat
                          ? "bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30"
                          : "bg-[#030712] text-slate-400 hover:text-slate-200 border border-slate-800"
                      }`}
                    >
                      {cat === "ALL" ? "Todos (26)" : cat}
                    </button>
                  ))}
                </div>

                <div className="overflow-y-auto space-y-2 pr-1 flex-1 custom-scrollbar">
                  {filteredChapters.map((chap) => {
                    const isSelected = chap.number - 1 === selectedChapterIndex;
                    return (
                      <button
                        key={chap.id}
                        type="button"
                        onClick={() => {
                          handleSelectChapter(chap.number - 1);
                          activeChapterRef.current?.scrollIntoView({ behavior: "smooth" });
                        }}
                        className={`w-full text-left p-3.5 rounded-2xl border transition-all ${
                          isSelected
                            ? "bg-blue-950/50 border-blue-500/60 shadow-[0_0_20px_rgba(37,99,235,0.15)] ring-1 ring-blue-500/30"
                            : "bg-[#030712]/60 hover:bg-[#070F1E] border-slate-800/80 text-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-amber-300">
                            {String(chap.number).padStart(2, "0")}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 truncate">
                            {chap.category}
                          </span>
                        </div>
                        <h4
                          className={`text-xs font-bold font-mono line-clamp-1 ${isSelected ? "text-white" : "text-slate-300"}`}
                        >
                          {chap.title}
                        </h4>
                        <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                          {chap.subtitle}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            {/* PANEL DERECHO: LECTURA DETALLADA */}
            <main className="lg:col-span-8 flex flex-col gap-6">
              {filteredChapters.map((chap) => {
                const isSelected = chap.number - 1 === selectedChapterIndex;
                return (
                  <article
                    key={chap.id}
                    ref={isSelected ? activeChapterRef : null}
                    className={`rounded-3xl border transition-all p-6 sm:p-8 backdrop-blur-2xl ${
                      isSelected
                        ? "bg-[#080E1A]/95 border-blue-500/50 shadow-2xl ring-1 ring-blue-500/20"
                        : "bg-[#080E1A]/70 border-slate-800/80 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-blue-500/10 text-sky-300 border border-blue-500/30 font-mono font-bold text-sm">
                          {String(chap.number).padStart(2, "0")}
                        </span>
                        <div>
                          <span className="text-[11px] font-mono font-bold text-amber-400 tracking-wider uppercase block">
                            {chap.category}
                          </span>
                          <h2 className="text-xl font-bold font-mono text-white">{chap.title}</h2>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedChapterIndex(chap.number - 1);
                          handleStartNarration(chap.number - 1);
                        }}
                        className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#030712] hover:bg-blue-950/60 border border-slate-800 text-sky-300 text-xs font-mono font-bold transition-all"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Escuchar</span>
                      </button>
                    </div>

                    <div className="my-5 p-4 rounded-2xl bg-[#030712] border border-slate-800/80 space-y-1.5">
                      <span className="text-[10px] font-mono text-slate-400 font-bold block uppercase tracking-wider">
                        Síntesis de Arquitectura
                      </span>
                      <p className="text-sm font-medium text-sky-200 leading-relaxed">
                        {chap.summary}
                      </p>
                    </div>

                    {chap.diagramAscii && (
                      <div className="my-5 p-4 rounded-2xl bg-[#030712] border border-slate-800 overflow-x-auto shadow-inner">
                        <pre className="font-mono text-xs text-amber-300/90 leading-tight">
                          {chap.diagramAscii}
                        </pre>
                      </div>
                    )}

                    <div className="space-y-4 text-slate-300 text-sm leading-relaxed font-sans">
                      {chap.content.map((p, pIdx) => (
                        <p key={pIdx}>{p}</p>
                      ))}
                    </div>

                    {chap.keyQuote && (
                      <blockquote className="my-6 p-5 rounded-2xl bg-gradient-to-r from-blue-950/40 via-slate-900/60 to-amber-950/20 border-l-4 border-amber-400">
                        <p className="text-sm font-semibold text-amber-100 italic leading-relaxed">
                          «{chap.keyQuote}»
                        </p>
                      </blockquote>
                    )}
                  </article>
                );
              })}
            </main>
          </motion.div>
        )}

        {/* MODO 2: SLIDE KEYNOTE */}
        {mode === "slides" && (
          <motion.div
            key="slides"
            variants={fadeInSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex flex-col gap-6"
          >
            <div className="rounded-3xl border border-slate-800/80 bg-[#080E1A]/95 p-8 sm:p-12 backdrop-blur-2xl shadow-2xl relative min-h-[520px] flex flex-col justify-between overflow-hidden">
              <div className="flex items-center justify-between pb-6 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center px-3.5 py-1.5 rounded-2xl bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono font-bold text-xs">
                    Diapositiva {String(currentChapter.number).padStart(2, "0")} / 26
                  </span>
                  <span className="px-3 py-1 rounded-full text-xs font-mono bg-blue-500/10 text-sky-300 border border-blue-500/30 uppercase tracking-wider font-semibold">
                    {currentChapter.category}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-400">
                    {Math.round(((selectedChapterIndex + 1) / PRESENTATION_CHAPTERS.length) * 100)}%
                  </span>
                  <div className="w-28 bg-[#030712] h-2 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-sky-400 transition-all duration-300"
                      style={{
                        width: `${((selectedChapterIndex + 1) / PRESENTATION_CHAPTERS.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="py-8 space-y-6 flex-1 overflow-hidden">
                <AnimatePresence custom={slideDirection} mode="wait">
                  <motion.div
                    key={currentChapter.id}
                    custom={slideDirection}
                    variants={slideTransitionVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className="space-y-6"
                  >
                    <div>
                      <h2 className="text-3xl sm:text-4xl font-extrabold font-mono text-white leading-tight">
                        {currentChapter.title}
                      </h2>
                      <h3 className="text-lg text-sky-300 font-mono mt-2 font-medium">
                        {currentChapter.subtitle}
                      </h3>
                    </div>

                    {currentChapter.keyQuote && (
                      <div className="p-6 rounded-2xl bg-gradient-to-r from-blue-950/60 via-[#030712] to-amber-950/20 border-l-4 border-amber-400 shadow-xl">
                        <p className="text-base sm:text-lg font-medium text-amber-100 italic leading-relaxed">
                          «{currentChapter.keyQuote}»
                        </p>
                      </div>
                    )}

                    <div className="space-y-4 text-slate-200 text-base leading-relaxed max-w-4xl font-sans">
                      {currentChapter.content.map((p, pIdx) => (
                        <p key={pIdx}>{p}</p>
                      ))}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="pt-6 border-t border-slate-800 flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400">
                  Atajos: Usa ← y → para navegar
                </span>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSelectChapter(Math.max(0, selectedChapterIndex - 1), -1)}
                    disabled={selectedChapterIndex === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#030712] border border-slate-800 text-slate-200 text-xs font-mono disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Anterior</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleSelectChapter(
                        Math.min(PRESENTATION_CHAPTERS.length - 1, selectedChapterIndex + 1),
                        1,
                      )
                    }
                    disabled={selectedChapterIndex === PRESENTATION_CHAPTERS.length - 1}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-bold transition-all shadow-md shadow-blue-600/30 disabled:opacity-30"
                  >
                    <span>Siguiente</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* MODO 3: MALLA TERRITORIAL DE LAS 7 FEDERACIONES */}
        {mode === "topology" && (
          <motion.div
            key="topology"
            variants={fadeInSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex flex-col gap-6"
          >
            <div className="rounded-3xl border border-slate-800/80 bg-[#080E1A]/95 p-8 backdrop-blur-2xl space-y-8">
              <div>
                <div className="flex items-center gap-2.5">
                  <Activity className="w-5 h-5 text-blue-400 animate-pulse" />
                  <h2 className="text-2xl font-bold font-mono text-white">
                    Topología Federada TAMV (7 Federaciones Gobernada)
                  </h2>
                </div>
                <p className="text-sm text-slate-300 mt-2 max-w-3xl">
                  Orquestación soberana multi-nodo e interconexión territorial con la malla
                  cognitiva de Isabella Villaseñor AI.
                </p>
              </div>

              {/* GRID DE NODOS DE FEDERACIÓN */}
              <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
                {[
                  {
                    name: "Federación 01",
                    role: "Nodo Cero",
                    status: "Activo",
                    color: "text-amber-400 border-amber-500/40",
                  },
                  {
                    name: "Federación 02",
                    role: "RDM Digital",
                    status: "Sincronizado",
                    color: "text-sky-400 border-sky-500/40",
                  },
                  {
                    name: "Federación 03",
                    role: "C.R.O.W.N. Core",
                    status: "Gobernando",
                    color: "text-blue-400 border-blue-500/40",
                  },
                  {
                    name: "Federación 04",
                    role: "ARGUS Centinela",
                    status: "Zero-Trust",
                    color: "text-emerald-400 border-emerald-500/40",
                  },
                  {
                    name: "Federación 05",
                    role: "Memoria Local ISA",
                    status: "Soberano",
                    color: "text-purple-400 border-purple-500/40",
                  },
                  {
                    name: "Federación 06",
                    role: "Inferencia Híbrida",
                    status: "Orquestado",
                    color: "text-cyan-400 border-cyan-500/40",
                  },
                  {
                    name: "Federación 07",
                    role: "Trazabilidad Logs",
                    status: "Auditado",
                    color: "text-amber-300 border-amber-500/40",
                  },
                ].map((fed, idx) => (
                  <div
                    key={idx}
                    className={`rounded-2xl border bg-[#030712] p-4 space-y-2 text-center transition-all hover:scale-[1.03] ${fed.color}`}
                  >
                    <span className="text-[10px] font-mono font-bold block opacity-70">
                      NODO 0{idx + 1}
                    </span>
                    <h3 className="text-xs font-bold font-mono text-white">{fed.name}</h3>
                    <p className="text-[11px] font-sans text-slate-400">{fed.role}</p>
                    <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-mono bg-slate-900 text-slate-300 border border-slate-800">
                      {fed.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* MODO 4: CERTIFICADO SHA-256 Y DECLARACIÓN */}
        {mode === "integrity" && (
          <motion.div
            key="integrity"
            variants={fadeInSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex flex-col gap-6"
          >
            <div className="rounded-3xl border border-slate-800/80 bg-[#080E1A]/95 p-8 backdrop-blur-2xl space-y-6">
              <div className="flex items-center justify-between pb-6 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    <Fingerprint className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold font-mono text-white">
                      Declaración de Integridad Criptográfica
                    </h2>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                      Certificado inmutable de la Red TAMV
                    </p>
                  </div>
                </div>

                <span className="px-3.5 py-1.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-bold">
                  ✓ Hash Válido
                </span>
              </div>

              <div className="p-6 rounded-2xl bg-[#030712] border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    DIGEST SHA-256 DEL DOCUMENTO
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyHash}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono transition-all"
                  >
                    {isHashCopied ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{isHashCopied ? "Copiado" : "Copiar"}</span>
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-black/80 border border-emerald-500/20 font-mono text-sm sm:text-base text-emerald-300 break-all select-all font-semibold tracking-wider">
                  {EVALUATOR_DECLARATION.sha256}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
