import React, { useState, useEffect } from "react";
import {
  LayoutGrid,
  Zap,
  MessageSquare,
  Settings,
  Terminal,
  Image as ImageIcon,
  Volume2,
  Box,
  Activity,
  Sparkles,
  Monitor,
  BookOpen,
  Network,
  Database,
  Globe,
  Layers,
  Shield,
  X,
  Bot,
} from "lucide-react";
import { useCrown } from "../../context/CrownContext";
import { soundManager } from "../../utils/soundEffects";
import { IsabellaVectorAvatar } from "../Avatar/IsabellaVectorAvatar";

interface EnterpriseRetractableDockProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

interface NavSubItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: React.ElementType;
  action: () => void;
  badge?: string;
  badgeColor?: string;
}

interface NavGroup {
  id: string;
  title: string;
  tag: string;
  icon: React.ElementType;
  items: NavSubItem[];
}

export const EnterpriseRetractableDock: React.FC<EnterpriseRetractableDockProps> = ({
  isOpen,
  onToggle,
  onClose,
}) => {
  const {
    state,
    setActiveView,
    openWelcomeModal,
    openSecurityModal,
    openShortcutsModal,
    openCinematicIntro,
    toggleSound,
    toggleSpeechSynthesis,
    clearMessages,
  } = useCrown();

  const [activeCategory, setActiveCategory] = useState<string>("modules");
  const [filterQuery, setFilterQuery] = useState<string>("");

  // Keyboard shortcut Alt+M to toggle retractable dock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        onToggle();
      } else if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onToggle, onClose]);

  const handleItemClick = (action: () => void) => {
    soundManager.playBeep(750, 0.03, "sine", 0.02);
    action();
    // On small screens, close automatically; on desktop, allow quick navigation
    if (window.innerWidth < 1024) {
      onClose();
    }
  };

  const navGroups: NavGroup[] = [
    {
      id: "modules",
      title: "Módulos de Sistema",
      tag: "Arquitectura CROWN",
      icon: LayoutGrid,
      items: [
        {
          id: "terminal",
          label: "Compositor & Terminal",
          sublabel: "Diálogo socrático y ejecución de tareas",
          icon: Terminal,
          action: () => setActiveView("terminal"),
          badge: "Principal",
          badgeColor: "bg-sky-500/20 text-sky-300 border-sky-500/30",
        },
        {
          id: "presence",
          label: "Presencia & Avatar Dinámico",
          sublabel: "Identidad, voz neuronal y estados vectoriales",
          icon: Bot,
          action: () => setActiveView("presence"),
          badge: "Interactivo",
          badgeColor: "bg-pink-500/20 text-pink-300 border-pink-500/30",
        },
        {
          id: "prompt_guide",
          label: "Guía de Prompts & Conversación",
          sublabel: "Explora preguntas, órdenes y disparadores cognitivos",
          icon: Sparkles,
          action: () => setActiveView("prompt_guide"),
          badge: "Guía",
          badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
        },
        {
          id: "cognitive_telemetry",
          label: "Telemetría Cognitiva CROWN",
          sublabel: "Osciloscopio sináptico y balance de pesos",
          icon: Activity,
          action: () => setActiveView("cognitive_telemetry"),
          badge: "En vivo",
          badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
        },
        {
          id: "architecture",
          label: "Arquitectura Cognitiva",
          sublabel: "Matriz de 5 módulos CROWN y balance de carga",
          icon: Box,
          action: () => setActiveView("architecture"),
        },
        {
          id: "synapse",
          label: "Malla Sináptica & Cockpit",
          sublabel: "Visualización de flujo neuronal e intenciones",
          icon: Network,
          action: () => setActiveView("synapse"),
        },
        {
          id: "traceability",
          label: "Auditoría & Trazabilidad",
          sublabel: "Firmas criptográficas SHA3 y verificación",
          icon: Activity,
          action: () => setActiveView("traceability"),
        },
        {
          id: "telemetry",
          label: "Telemetría en Vivo",
          sublabel: "Métricas de latencia, tokens y salud del nodo",
          icon: Monitor,
          action: () => setActiveView("telemetry"),
        },
        {
          id: "image_studio",
          label: "Taller Visual (Image Studio)",
          sublabel: "Generación y edición multimodal",
          icon: ImageIcon,
          action: () => setActiveView("image_studio"),
        },
        {
          id: "voice_studio",
          label: "Estudio Vocal & Locución",
          sublabel: "Síntesis fonética con acento mexicano natural",
          icon: Volume2,
          action: () => setActiveView("voice_studio"),
        },
        {
          id: "presentation",
          label: "Dossier Institucional",
          sublabel: "Presentación corporativa y rigor académico",
          icon: Layers,
          action: () => setActiveView("presentation"),
        },
        {
          id: "hub",
          label: "Hub Nodo Cero RDM",
          sublabel: "Servicios federados y API Gateway",
          icon: Globe,
          action: () => setActiveView("hub"),
        },
      ],
    },
    {
      id: "skills",
      title: "Habilidades & Protocolos",
      tag: "Especialidades",
      icon: Zap,
      items: [
        {
          id: "skill_quantum",
          label: "Malla Cuántica",
          sublabel: "Topología cuántica y simulación de estados",
          icon: Box,
          action: () => setActiveView("quantum_mesh"),
          badge: "Quantum",
          badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/30",
        },
        {
          id: "skill_language",
          label: "Lenguaje Atlas",
          sublabel: "Especificación formal de semántica y ontologías",
          icon: BookOpen,
          action: () => setActiveView("atlas_language"),
        },
        {
          id: "skill_ledger",
          label: "Libro Mayor BookPI",
          sublabel: "Registro inmutable con criptografía post-cuántica",
          icon: Database,
          action: () => setActiveView("ledger_page"),
        },
        {
          id: "skill_eoct",
          label: "Federación EOCT",
          sublabel: "Orquestación de enclaves seguros TEE",
          icon: Network,
          action: () => setActiveView("eoct_page"),
        },
      ],
    },
    {
      id: "settings",
      title: "Gobernanza & Ajustes",
      tag: "Configuración",
      icon: Settings,
      items: [
        {
          id: "set_security",
          label: "Salvaguardas & Soberanía",
          sublabel: "Controles zero-trust y enclaves seguros",
          icon: Shield,
          action: () => openSecurityModal(),
        },
        {
          id: "set_cinematic",
          label: "Intro Cinematográfica",
          sublabel: "Reproducir la introducción y despertar de Isabella",
          icon: Sparkles,
          action: () => openCinematicIntro(),
          badge: "Cinemática",
          badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
        },
        {
          id: "set_welcome",
          label: "Onboarding & Bienvenida",
          sublabel: "Guía de inicio interactiva de Isabella",
          icon: BookOpen,
          action: () => openWelcomeModal(),
        },
        {
          id: "set_shortcuts",
          label: "Atajos de Teclado",
          sublabel: "Comandos rápidos y combinaciones de navegación",
          icon: Zap,
          action: () => openShortcutsModal(),
        },
        {
          id: "set_voice",
          label: `Locución Vocal: ${state.speechSynthesisEnabled ? "Activada" : "Desactivada"}`,
          sublabel: "Alternar síntesis de voz en respuestas",
          icon: Volume2,
          action: () => toggleSpeechSynthesis(),
        },
        {
          id: "set_sound",
          label: `Efectos Sonoros: ${state.soundEnabled ? "Activados" : "Silenciados"}`,
          sublabel: "Retroalimentación acústica del sistema",
          icon: Volume2,
          action: () => toggleSound(),
        },
        {
          id: "set_clear",
          label: "Limpiar Conversación",
          sublabel: "Reiniciar historial de diálogo activo",
          icon: MessageSquare,
          action: () => clearMessages(),
        },
      ],
    },
  ];

  return (
    <>
      {/* 1. Sleek Floating Retractable Toggle Pill (Always available when closed) */}
      {!isOpen && (
        <aside
          aria-label="Acceso rápido a módulos"
          className="fixed left-2 top-20 z-30 flex items-center"
        >
          <button
            type="button"
            onClick={onToggle}
            className="group flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-700/80 bg-[#070b14]/90 hover:bg-[#0f172a] text-slate-300 hover:text-white shadow-xl shadow-black/50 backdrop-blur-xl transition-all duration-300 hover:scale-105 cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-400"
            title="Abrir Módulos y Navegación (Alt+M)"
          >
            <div className="relative flex h-5 w-5 items-center justify-center">
              <LayoutGrid className="w-4 h-4 text-amber-400 group-hover:rotate-45 transition-transform duration-300" />
            </div>
            <span className="text-xs font-mono font-medium hidden sm:inline tracking-wide">
              Módulos <span className="text-[10px] text-slate-500 ml-1 font-normal">[Alt+M]</span>
            </span>
          </button>
        </aside>
      )}

      {/* 2. Backdrop Overlay when Retractable Drawer is Opened */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity animate-fade-in"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* 3. Retractable Enterprise Drawer Panel */}
      <aside
        id="retractable-enterprise-dock"
        aria-label="Panel de navegación ejecutiva"
        className={`fixed top-0 left-0 bottom-0 z-50 w-full sm:w-[380px] lg:w-[420px] bg-[#030611]/98 border-r border-slate-800/90 shadow-2xl flex flex-col backdrop-blur-2xl transition-transform duration-300 ease-out transform ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Drawer Top Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800/80 bg-gradient-to-r from-slate-950 via-[#060c1c] to-slate-950">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl overflow-hidden border border-amber-400/40 bg-slate-900 flex items-center justify-center shadow-[0_0_15px_rgba(224,187,93,0.2)]">
                <IsabellaVectorAvatar size={36} showAura={false} />
              </div>
              <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-slate-950 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-wide">
                  Isabella{" "}
                  <span className="font-serif italic font-normal text-amber-300">
                    Villaseñor AI
                  </span>
                </h2>
              </div>
              <p className="text-[11px] font-mono text-slate-400">Módulos Ejecutivos · Nodo Cero</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
            aria-label="Cerrar panel de navegación"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex border-b border-slate-800/80 bg-slate-950/60 px-3 py-2 gap-1 overflow-x-auto">
          {navGroups.map((group) => {
            const Icon = group.icon;
            const isSelected = activeCategory === group.id;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  setActiveCategory(group.id);
                  soundManager.playBeep(800, 0.02, "sine", 0.01);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isSelected
                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/40 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{group.title.split(" ")[0]}</span>
              </button>
            );
          })}
        </div>

        {/* Search & Filter Input */}
        <div className="p-3 border-b border-slate-800/60 bg-[#02050e]">
          <input
            type="text"
            placeholder="Buscar módulo, habilidad o comando..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400/60 font-mono"
          />
        </div>

        {/* Scrollable Navigation Items List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
          {navGroups
            .filter((g) => (activeCategory ? g.id === activeCategory : true))
            .map((group) => {
              const filteredItems = group.items.filter(
                (item) =>
                  !filterQuery ||
                  item.label.toLowerCase().includes(filterQuery.toLowerCase()) ||
                  (item.sublabel &&
                    item.sublabel.toLowerCase().includes(filterQuery.toLowerCase())),
              );

              if (filteredItems.length === 0) return null;

              return (
                <div key={group.id} className="space-y-1.5">
                  <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500">
                      {group.title}
                    </span>
                    <span className="text-[10px] font-mono text-slate-600">{group.tag}</span>
                  </div>

                  <div className="space-y-1">
                    {filteredItems.map((item) => {
                      const Icon = item.icon;
                      const isCurrentActive =
                        state.activeView === item.id ||
                        (item.id === "cattleya_finance" && state.activeView === "cattleya_finance");

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleItemClick(item.action)}
                          className={`w-full flex items-start gap-3 p-2.5 rounded-xl text-left transition-all duration-200 cursor-pointer ${
                            isCurrentActive
                              ? "bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent border border-amber-400/40 text-white shadow-md"
                              : "border border-transparent hover:border-slate-800 hover:bg-slate-900/60 text-slate-300 hover:text-white"
                          }`}
                        >
                          <div
                            className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                              isCurrentActive
                                ? "bg-amber-400/20 text-amber-300"
                                : "bg-slate-900 text-slate-400 group-hover:text-slate-200"
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold truncate">{item.label}</span>
                              {item.badge && (
                                <span
                                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                    item.badgeColor ||
                                    "bg-slate-800 text-slate-400 border-slate-700"
                                  }`}
                                >
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            {item.sublabel && (
                              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                {item.sublabel}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Drawer Bottom Status & Quick Action Footer */}
        <div className="p-3.5 border-t border-slate-800/80 bg-slate-950/80 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px]">Nodo Cero · 100% Operativo</span>
          </div>

          <button
            type="button"
            onClick={openShortcutsModal}
            className="text-[11px] text-amber-400/80 hover:text-amber-300 hover:underline"
          >
            Ver atajos [?]
          </button>
        </div>
      </aside>
    </>
  );
};
