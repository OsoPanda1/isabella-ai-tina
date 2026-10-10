import React, { useState, useEffect } from "react";
import { Keyboard, X, Terminal, Mic, Sparkles, Zap, Layers, Search, Command } from "lucide-react";
import { soundManager } from "../../utils/soundEffects";
import "../../context/CrownContext";

interface ShortcutItem {
  keys: string[];
  description: string;
  category: "terminal" | "audio" | "navigation" | "system";
  actionName?: string;
  recommended?: boolean;
}

const SHORTCUT_LIST: ShortcutItem[] = [
  // Terminal & Prompting
  {
    keys: ["Ctrl", "Enter"],
    description: "Enviar mensaje / Despachar prompt a Isabella (también ⌘+Enter)",
    category: "terminal",
    recommended: true,
  },
  {
    keys: ["Enter"],
    description: "Despachar mensaje si el cursor está en el prompt",
    category: "terminal",
  },
  {
    keys: ["Shift", "Enter"],
    description: "Insertar nueva línea en el campo de texto",
    category: "terminal",
  },
  {
    keys: ["Ctrl", "K"],
    description: "Limpiar terminal y reiniciar historial de pantalla (⌘+K)",
    category: "terminal",
    recommended: true,
  },
  {
    keys: ["Ctrl", "L"],
    description: "Enfocar el campo de texto (Prompt) desde cualquier vista (⌘+L)",
    category: "terminal",
    recommended: true,
  },
  {
    keys: ["↑", "↓"],
    description: "Navegar por el historial de comandos ejecutados en la CLI",
    category: "terminal",
  },

  // Audio & Voz
  {
    keys: ["Ctrl", "M"],
    description: "Activar / Pausar micrófono (Dictado de voz a texto)",
    category: "audio",
    recommended: true,
  },
  {
    keys: ["Ctrl", "Shift", "S"],
    description: "Detener reproducción de voz actual de Isabella",
    category: "audio",
  },
  {
    keys: ["Ctrl", "Shift", "V"],
    description: "Alternar narración por voz automática (ON / OFF)",
    category: "audio",
  },
  {
    keys: ["Ctrl", "Shift", "F"],
    description: "Alternar efectos de sonido sintéticos (FX ON / OFF)",
    category: "audio",
  },

  // Navigation
  {
    keys: ["Alt", "1"],
    description: "Ir a la vista Terminal CROWN (o Ctrl+1)",
    category: "navigation",
    recommended: true,
  },
  {
    keys: ["Alt", "2"],
    description: "Ir a la vista Presencia de Isabella (o Ctrl+2)",
    category: "navigation",
    recommended: true,
  },
  {
    keys: ["Alt", "3"],
    description: "Ir al Estudio Visual / Galería de Arte (o Ctrl+3)",
    category: "navigation",
  },
  {
    keys: ["Alt", "4"],
    description: "Ir al Estudio Acústico de Voz (o Ctrl+4)",
    category: "navigation",
  },
  {
    keys: ["Alt", "5"],
    description: "Ir al Diagrama de Arquitectura y Sinapsis (o Ctrl+5)",
    category: "navigation",
  },
  {
    keys: ["Alt", "6"],
    description: "Ir a la Matriz Cognitiva y Telemetría (o Ctrl+6)",
    category: "navigation",
  },
  {
    keys: ["Alt", "7"],
    description: "Ir a la Presentación & Auditoría Arquitectónica de Nodo Cero",
    category: "navigation",
    recommended: true,
  },
  {
    keys: ["Alt", "8"],
    description: "Ir al Hub RDM & Consola de Gobernanza /api/v1/isabella",
    category: "navigation",
    recommended: true,
  },

  // System & Dialogs
  {
    keys: ["Ctrl", "/"],
    description: "Abrir este panel de Atajos de Teclado (o pulsar ?)",
    category: "system",
    recommended: true,
  },
  {
    keys: ["Ctrl", "Shift", "D"],
    description: "Ejecutar diagnóstico instantáneo de subsistemas (/status)",
    category: "system",
  },
  {
    keys: ["Esc"],
    description: "Cerrar modales activos, cancelar dictado o desenfocar",
    category: "system",
  },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [filter, setFilter] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    if (isOpen) {
      soundManager.playBeep(880, 0.04);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const categories = [
    { id: "all", label: "Todos los Atajos", icon: Command },
    { id: "terminal", label: "Terminal y Prompt", icon: Terminal },
    { id: "audio", label: "Voz y Micrófono", icon: Mic },
    { id: "navigation", label: "Navegación Rápida", icon: Layers },
    { id: "system", label: "Sistema CROWN", icon: Zap },
  ];

  const filteredShortcuts = SHORTCUT_LIST.filter((item) => {
    const matchesCategory = activeCategory === "all" || item.category === activeCategory;
    const matchesSearch =
      filter === "" ||
      item.description.toLowerCase().includes(filter.toLowerCase()) ||
      item.keys.some((k) => k.toLowerCase().includes(filter.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const renderKeyBadge = (key: string) => {
    let displayKey = key;
    if (isMac) {
      if (key === "Ctrl") displayKey = "⌘";
      if (key === "Alt") displayKey = "⌥";
      if (key === "Shift") displayKey = "⇧";
    }
    return (
      <kbd
        key={key}
        className="inline-flex items-center justify-center min-w-[24px] px-2 py-1 text-xs font-mono font-bold text-sky-200 bg-[#060D1A] border border-sky-500/40 rounded-lg shadow-inner shadow-blue-950/50"
      >
        {displayKey}
      </kbd>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#030712]/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl bg-[#070F1E]/95 border border-slate-700/60 shadow-2xl shadow-blue-950/50 overflow-hidden text-[#F8FAFC] font-sans"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0B1526]/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-950/80 border border-sky-500/50 text-sky-300">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#F8FAFC] tracking-wide">
                  Atajos de Teclado Globales
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-blue-500/20 text-sky-300 border border-sky-500/30">
                  Power User Hub
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Interactúa con Isabella Villaseñor a la velocidad del pensamiento
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl bg-[#081220] hover:bg-[#0E2038] border border-slate-800 transition-colors cursor-pointer"
            title="Cerrar modal (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter bar & Categories tabs */}
        <div className="px-6 pt-4 pb-2 space-y-3 bg-[#050B14]/80 border-b border-slate-800">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar atajo por acción o tecla (ej. 'limpiar', 'Ctrl+K', 'voz', 'Enter')..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#081220] border border-slate-700/80 rounded-xl text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/60"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs font-mono">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    soundManager.playBeep(600, 0.02);
                    setActiveCategory(cat.id);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl whitespace-nowrap transition-all cursor-pointer ${
                    active
                      ? "bg-blue-600 text-white font-bold shadow-md shadow-blue-500/25"
                      : "bg-[#081220] text-slate-400 hover:text-slate-200 hover:bg-[#0B1A2E] border border-slate-800"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Shortcut items list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5 max-h-[50vh]">
          {filteredShortcuts.length === 0 ? (
            <div className="py-12 text-center text-slate-500 font-mono text-xs">
              No se encontraron atajos que coincidan con &quot;{filter}&quot;.
            </div>
          ) : (
            filteredShortcuts.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-4 p-3 rounded-2xl bg-[#0B1526]/80 border border-slate-800 hover:border-sky-500/40 hover:bg-[#0E1F38] transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    {item.keys.map((k, kIdx) => (
                      <React.Fragment key={kIdx}>
                        {kIdx > 0 && <span className="text-slate-500 font-mono text-xs">+</span>}
                        {renderKeyBadge(k)}
                      </React.Fragment>
                    ))}
                  </div>

                  {item.recommended && (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-md">
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      Recomendado
                    </span>
                  )}
                </div>

                <div className="text-right text-xs font-mono text-slate-300 group-hover:text-sky-200 transition-colors max-w-md">
                  {item.description}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer tips */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-[#0B1526]/90 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-bold">Consejo:</span>
            <span>
              Usa{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-[#060D1A] text-sky-300 border border-slate-700 text-[11px]">
                Ctrl+K
              </kbd>{" "}
              para limpiar y{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-[#060D1A] text-sky-300 border border-slate-700 text-[11px]">
                Ctrl+Enter
              </kbd>{" "}
              para enviar rápidamente.
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-all active:scale-95 cursor-pointer shadow-md shadow-blue-600/30"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
