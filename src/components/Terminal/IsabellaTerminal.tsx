import React, { useMemo, useState } from "react";
import {
  Activity,
  Bot,
  ChevronRight,
  FileCheck,
  Image,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Mic2,
  Network,
  Settings2,
  Shield,
  Trash2,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from "lucide-react";
import { useCrown } from "../../context/CrownContext";
import { MessageStream } from "./MessageStream";
import { TerminalCommandLine } from "./TerminalCommandLine";
import { soundManager } from "../../utils/soundEffects";
import { ISABELLA_AVATAR_PRIMARY } from "../../data/isabellaAvatar";
import { SubscriptionPlans } from "../Billing/SubscriptionPlans";

type NavigationItem = {
  label: string;
  description: string;
  icon: typeof MessageSquareText;
  action: () => void;
};

const getSystemStatus = (state: {
  isProcessing: boolean;
  isSpeaking: boolean;
  isListening: boolean;
}) => {
  if (state.isSpeaking) return { label: "Hablando", tone: "amber" as const };
  if (state.isListening) return { label: "Escuchando", tone: "blue" as const };
  if (state.isProcessing) return { label: "Procesando", tone: "blue" as const };
  return { label: "Disponible", tone: "green" as const };
};

const statusStyles = {
  green: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  blue: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  amber: "border-amber-400/25 bg-amber-400/10 text-amber-300",
};

export const IsabellaTerminal: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [showWorkspaceInfo, setShowWorkspaceInfo] = useState(false);

  const {
    state,
    messages,
    clearMessages,
    toggleSound,
    toggleSpeechSynthesis,
    triggerManualDiagnostic,
    setActiveView,
    openWelcomeModal,
    openShortcutsModal,
    openTrailer,
    openSecurityModal,
  } = useCrown();

  const status = getSystemStatus(state);
  const latestIsabellaMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "isabella"),
    [messages],
  );

  const navigationItems: NavigationItem[] = [
    {
      label: "Conversación",
      description: "Chat principal",
      icon: MessageSquareText,
      action: () => undefined,
    },
    {
      label: "Presencia",
      description: "Perfil y estado",
      icon: Bot,
      action: () => setActiveView("presence"),
    },
    {
      label: "Voz",
      description: "Configuración de audio",
      icon: Mic2,
      action: () => setActiveView("voice_studio"),
    },
    {
      label: "Imágenes",
      description: "Estudio visual",
      icon: Image,
      action: () => setActiveView("image_studio"),
    },
    {
      label: "Sistemas",
      description: "Estado operativo",
      icon: LayoutDashboard,
      action: () => setActiveView("architecture"),
    },
    {
      label: "Auditoría",
      description: "Trazabilidad",
      icon: FileCheck,
      action: () => setActiveView("traceability"),
    },
    {
      label: "Hub RDM",
      description: "Servicios conectados",
      icon: Network,
      action: () => setActiveView("hub"),
    },
  ];

  const closeMobileNavigation = () => setSidebarOpen(false);

  const handleClear = () => {
    soundManager.playBeep(450, 0.04);
    clearMessages();
  };

  const handleNavigation = (item: NavigationItem) => {
    soundManager.playBeep(720, 0.025);
    item.action();
    closeMobileNavigation();
  };

  const sidebar = (
    <aside className="flex h-full w-[280px] flex-col border-r border-slate-800/80 bg-slate-950/95">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-4">
        <button
          type="button"
          onClick={openTrailer}
          className="flex min-w-0 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          <img
            src={ISABELLA_AVATAR_PRIMARY}
            alt="Isabella"
            className="h-10 w-10 rounded-xl object-cover object-top ring-1 ring-slate-700"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">Isabella</span>
            <span className="block truncate text-[11px] text-slate-500">Asistente de trabajo</span>
          </span>
        </button>
        <button
          type="button"
          onClick={closeMobileNavigation}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-900 hover:text-slate-200 lg:hidden"
          aria-label="Cerrar navegación"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <button
          type="button"
          onClick={() => {
            openWelcomeModal();
            closeMobileNavigation();
          }}
          className="mb-5 flex w-full items-center gap-3 rounded-xl border border-sky-400/25 bg-sky-400/10 px-3 py-2.5 text-left transition hover:bg-sky-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          <MessageSquareText className="h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
          <span>
            <span className="block text-xs font-semibold text-sky-100">Nueva conversación</span>
            <span className="block text-[11px] text-sky-200/60">Comienza un nuevo trabajo</span>
          </span>
        </button>

        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          Espacios de trabajo
        </p>
        <nav className="space-y-1" aria-label="Espacios de trabajo">
          {navigationItems.map((item, index) => {
            const Icon = item.icon;
            const active = index === 0;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => handleNavigation(item)}
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${active ? "bg-slate-800/90 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"}`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${active ? "text-sky-300" : "text-slate-500"}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="my-5 border-t border-slate-800/80" />
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          Cuenta
        </p>
        <button
          type="button"
          onClick={() => {
            setShowPlans((value) => !value);
            closeMobileNavigation();
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-slate-400 transition hover:bg-slate-900 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          <Wallet className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <span className="flex-1">
            <span className="block text-sm font-medium">Planes y uso</span>
            <span className="block text-[11px] text-slate-500">Administrar suscripción</span>
          </span>
          <ChevronRight
            className={`h-4 w-4 transition-transform ${showPlans ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="border-t border-slate-800/80 p-4">
        <button
          type="button"
          onClick={openSecurityModal}
          className="flex w-full items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-left transition hover:border-slate-700 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          <span>
            <span className="block text-xs font-semibold text-slate-200">Protección activa</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
              Controles de seguridad y privacidad
            </span>
          </span>
        </button>
      </div>
    </aside>
  );

  return (
    <div className="relative min-h-[calc(100vh-112px)] overflow-hidden rounded-2xl border border-slate-800/90 bg-[#070b12] text-slate-200 shadow-2xl shadow-black/40">
      <div className="relative flex min-h-[calc(100vh-112px)]">
        <div className="hidden lg:block">{sidebar}</div>

        {sidebarOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 bg-black/60 lg:hidden"
              onClick={closeMobileNavigation}
              aria-label="Cerrar menú"
            />
            <div className="fixed inset-y-0 left-0 z-40 lg:hidden">{sidebar}</div>
          </>
        )}

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-[68px] items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-950/70 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white lg:hidden"
                aria-label="Abrir navegación"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-base font-semibold text-white sm:text-lg">
                    Conversación
                  </h1>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyles[status.tone]}`}
                  >
                    {status.label}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  Isabella · espacio de trabajo personal
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={openShortcutsModal}
                className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-900 hover:text-slate-200 sm:block"
                title="Preferencias y atajos"
                aria-label="Preferencias y atajos"
              >
                <Settings2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={triggerManualDiagnostic}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-900 hover:text-sky-300"
                title="Comprobar estado"
                aria-label="Comprobar estado"
              >
                <Activity className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={toggleSpeechSynthesis}
                className={`rounded-lg p-2 ${state.speechSynthesisEnabled ? "text-amber-300 hover:bg-amber-400/10" : "text-slate-500 hover:bg-slate-900 hover:text-slate-200"}`}
                title="Activar o desactivar voz"
                aria-label="Activar o desactivar voz"
                aria-pressed={state.speechSynthesisEnabled}
              >
                {state.speechSynthesisEnabled ? (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={toggleSound}
                className="hidden rounded-lg px-2 py-1.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-900 hover:text-slate-200 sm:block"
                aria-label="Activar o desactivar sonidos"
                aria-pressed={state.soundEnabled}
              >
                FX {state.soundEnabled ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-900 hover:text-rose-300"
                title="Limpiar conversación"
                aria-label="Limpiar conversación"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          {showPlans && (
            <div className="border-b border-slate-800/80 bg-slate-950/60 px-4 pt-4 sm:px-6">
              <SubscriptionPlans />
            </div>
          )}

          <main className="flex min-h-0 flex-1 flex-col px-3 py-4 sm:px-6">
            <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-950/45">
              <div className="border-b border-slate-800/80 px-4 py-3 sm:px-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-300">¿En qué trabajamos?</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Escribe una pregunta, idea o tarea.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowWorkspaceInfo((value) => !value)}
                    className="hidden text-[11px] text-slate-500 hover:text-slate-300 sm:block"
                    aria-expanded={showWorkspaceInfo}
                  >
                    {showWorkspaceInfo ? "Ocultar ayuda" : "Cómo funciona"}
                  </button>
                </div>
                {showWorkspaceInfo && (
                  <p className="mt-3 max-w-2xl text-xs leading-relaxed text-slate-500">
                    Isabella puede ayudarte a redactar, analizar, planificar y crear. Las funciones
                    avanzadas están disponibles desde la navegación lateral.
                  </p>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-5">
                <MessageStream messages={messages} />
              </div>

              <div className="border-t border-slate-800/80 bg-slate-950/70 p-3 sm:p-4">
                <TerminalCommandLine />
              </div>
            </div>
          </main>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 px-4 py-2.5 text-[10px] text-slate-600 sm:px-6">
            <span>Isabella · Nodo Cero</span>
            <span>{latestIsabellaMessage?.isabellaState?.mood || "Asistente disponible"}</span>
          </footer>
        </section>
      </div>
    </div>
  );
};
