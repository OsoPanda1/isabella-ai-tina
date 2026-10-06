import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ChevronLeft, ChevronRight, Download, FolderOpen } from "lucide-react";
import { useIsabella } from "@/lib/useIsabella";
import {
  CrystalNavigation,
  NAV_GROUPS,
  type NavTabId,
} from "@/components/isabella/CrystalNavigation";

import { IsabellaCinematicExperience } from "@/components/Welcome/IsabellaCinematicExperience";
const CommandLine = lazy(() =>
  import("@/components/isabella/CommandLine").then((m) => ({
    default: m.CommandLine,
  })),
);
const MessageStream = lazy(() =>
  import("@/components/isabella/MessageStream").then((m) => ({
    default: m.MessageStream,
  })),
);
const RightRails = lazy(() =>
  import("@/components/isabella/RightRails").then((m) => ({
    default: m.RightRails,
  })),
);
const Starfield = lazy(() =>
  import("@/components/isabella/Starfield").then((m) => ({
    default: m.Starfield,
  })),
);
const ApiCatalogExplorer = lazy(() =>
  import("@/components/isabella/ApiCatalogExplorer").then((m) => ({
    default: m.ApiCatalogExplorer,
  })),
);
const TerminalView = lazy(() =>
  import("@/components/isabella/TerminalView").then((m) => ({
    default: m.TerminalView,
  })),
);
const MonetizationDashboard = lazy(() =>
  import("@/components/isabella/MonetizationDashboard").then((m) => ({
    default: m.MonetizationDashboard,
  })),
);
const QuantumUtilityDashboard = lazy(() =>
  import("@/components/isabella/QuantumUtilityDashboard").then((m) => ({
    default: m.QuantumUtilityDashboard,
  })),
);
const AiInterfacesHub = lazy(() =>
  import("@/components/isabella/AiInterfacesHub").then((m) => ({
    default: m.AiInterfacesHub,
  })),
);
const LatamAegisDashboard = lazy(() =>
  import("@/components/isabella/LatamAegisDashboard").then((m) => ({
    default: m.LatamAegisDashboard,
  })),
);
const CognitiveStatusDashboard = lazy(() =>
  import("@/components/isabella/CognitiveStatusDashboard").then((m) => ({
    default: m.CognitiveStatusDashboard,
  })),
);
const FindarepoDashboard = lazy(() =>
  import("@/components/isabella/FindarepoDashboard").then((m) => ({
    default: m.FindarepoDashboard,
  })),
);
const VideoEngineXDashboard = lazy(() =>
  import("@/components/isabella/VideoEngineXDashboard").then((m) => ({
    default: m.VideoEngineXDashboard,
  })),
);

const INTRO_SEEN_KEY = "isabella.entry.intro.v2";

function ClientFallback({ label = "Cargando módulo Isabella…" }: { label?: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-border/20 bg-background/40">
      <div className="text-center" role="status" aria-live="polite">
        <div className="mx-auto mb-4 size-9 animate-pulse rounded-full border border-electric/40 bg-electric/10" />
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          {label}
        </p>
      </div>
    </div>
  );
}

function IndexClient() {
  // La intro se muestra una vez por sesión al entrar; ?intro=1 la fuerza de nuevo.
  // La interfaz sigue siendo accesible mediante Escape o el botón de omitir.
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const introRequested = params.get("intro") === "1";
      const introSeen = window.sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
      setIntroDone(!introRequested && introSeen);
    } catch {
      setIntroDone(true);
    }
  }, []);

  const handleIntroComplete = useCallback(() => {
    try {
      window.sessionStorage.setItem(INTRO_SEEN_KEY, "1");
    } catch {
      // Storage may be unavailable; the UI remains functional.
    }
    setIntroDone(true);
  }, []);

  if (!introDone) {
    return (
      <Suspense fallback={<ClientFallback label="Inicializando experiencia Isabella…" />}>
        <IsabellaCinematicExperience
          isOpen
          enableCinematic
          onEnter={handleIntroComplete}
          onClose={handleIntroComplete}
        />
      </Suspense>
    );
  }
  return <IsabellaInterface />;
}

function IsabellaInterface() {
  const isabella = useIsabella();
  const [panel, setPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTabId>(() => {
    if (typeof window === "undefined") return "terminal";
    const candidate = window.location.hash.replace(/^#/, "") as NavTabId;
    return [
      "terminal",
      "cli",
      "governance",
      "catalog",
      "monetization",
      "quantum",
      "interfaces",
      "aegis",
      "findarepo",
      "video-x",
    ].includes(candidate)
      ? candidate
      : "terminal";
  });
  const [monetizationSubTab, setMonetizationSubTab] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [upperOpen, setUpperOpen] = useState(false);
  const [middleOpen, setMiddleOpen] = useState(false);
  const [lowerOpen, setLowerOpen] = useState(false);
  const lastInput = useRef<{
    text: string;
    attachments: Parameters<typeof isabella.send>[1];
    config?: Parameters<typeof isabella.send>[2];
  }>({ text: "", attachments: [] });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const chatSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const isAutoScrollPinned = useRef(true);

  // User-controlled auto-scroll toggle state
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("isabella_autoscroll_enabled");
      return stored !== null ? stored === "true" : true;
    } catch {
      return true;
    }
  });

  const scrollToBottom = useCallback((smooth = true) => {
    const el = chatSurfaceRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
    isAutoScrollPinned.current = true;
    setShowScrollBottom(false);
  }, []);

  const toggleAutoScroll = useCallback(() => {
    setAutoScrollEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("isabella_autoscroll_enabled", String(next));
      } catch {
        // Storage access may be restricted
      }
      if (next) {
        scrollToBottom(true);
      }
      return next;
    });
  }, [scrollToBottom]);

  const handleChatScroll = useCallback(() => {
    const el = chatSurfaceRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceToBottom < 80;
    isAutoScrollPinned.current = isNearBottom;
    setShowScrollBottom(!isNearBottom);
  }, []);

  useEffect(() => {
    if (autoScrollEnabled && isAutoScrollPinned.current) {
      scrollToBottom(true);
    }
  }, [isabella.messages, isabella.isProcessing, scrollToBottom, autoScrollEnabled]);

  useEffect(() => {
    const el = chatSurfaceRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (autoScrollEnabled && isAutoScrollPinned.current) {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: "smooth",
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [activeTab, autoScrollEnabled]);

  const selectTab = useCallback((tab: NavTabId) => {
    setActiveTab(tab);
    try {
      window.history.replaceState(null, "", `#${tab}`);
    } catch {
      // URL state is non-critical to the application runtime.
    }
  }, []);

  const handleMonetizationNavigate = useCallback(
    (subTab: string) => {
      selectTab("monetization");
      setMonetizationSubTab(subTab);
      try {
        window.history.replaceState(null, "", `#monetization-${subTab}`);
      } catch {
        // URL history is non-critical to the application runtime.
      }
    },
    [selectTab],
  );

  const send = useCallback(
    (
      text: string,
      attachments: Parameters<typeof isabella.send>[1] = [],
      config?: Parameters<typeof isabella.send>[2],
    ) => {
      lastInput.current = { text, attachments, config };
      void isabella.send(text, attachments, config);
    },
    [isabella],
  );

  useEffect(() => {
    const syncHash = () => {
      const candidate = window.location.hash.replace(/^#/, "") as NavTabId;
      if (
        [
          "terminal",
          "cli",
          "governance",
          "catalog",
          "monetization",
          "quantum",
          "interfaces",
          "aegis",
          "findarepo",
          "video-x",
        ].includes(candidate)
      ) {
        setActiveTab(candidate);
      }
    };
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const navGroups = NAV_GROUPS(
    { cognition: upperOpen, catalog: middleOpen, sovereignty: lowerOpen },
    (id) => {
      if (id === "cognition") setUpperOpen((open) => !open);
      else if (id === "catalog") setMiddleOpen((open) => !open);
      else if (id === "sovereignty") setLowerOpen((open) => !open);
    },
  );

  return (
    <Suspense fallback={<ClientFallback />}>
      <div className="isabella-shell relative flex min-h-screen bg-background text-foreground transition-colors duration-300">
        <Starfield />

        <aside
          id="isabella-sidebar"
          className={`isabella-sidebar glass sticky top-0 z-30 flex h-screen flex-col justify-between border-r border-border/20 transition-all duration-300 ease-out ${
            isSidebarOpen ? "w-[310px]" : "w-[75px]"
          }`}
          aria-label="Navegación Isabella"
        >
          <div className="flex flex-1 select-none flex-col overflow-x-hidden overflow-y-auto">
            <div className="flex shrink-0 flex-col items-center justify-center border-b border-border/15 p-4">
              <div className="group relative">
                <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-electric via-iris to-pearl opacity-40 blur-md transition-all duration-500 group-hover:opacity-75" />
                <img
                  src="/favicon.png"
                  alt="Isabella Logo"
                  className={`relative rounded-xl border border-border/40 object-cover transition-all duration-300 ease-out ${
                    isSidebarOpen ? "size-18" : "size-10"
                  }`}
                  width={isSidebarOpen ? 72 : 40}
                  height={isSidebarOpen ? 72 : 40}
                />
              </div>
              {isSidebarOpen && (
                <div className="mt-3 animate-rise text-center">
                  <h2 className="font-display text-[16px] font-bold tracking-wide text-iridescent">
                    Isabella Villaseñor AI
                  </h2>
                  <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.24em] text-muted-foreground">
                    Contexto, límites y decisión humana
                  </p>
                </div>
              )}
            </div>

            <CrystalNavigation
              groups={navGroups}
              activeTab={activeTab}
              onSelect={selectTab}
              collapsed={!isSidebarOpen}
            />
          </div>

          <div className="flex shrink-0 flex-col gap-2 border-t border-border/15 p-3">
            {isSidebarOpen && (
              <div className="flex flex-col gap-1.5 rounded-2xl border border-border/20 bg-secondary/15 p-2 font-mono text-[10.5px] animate-rise">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Operador:</span>
                  <span className="max-w-[120px] truncate font-semibold text-platinum">
                    Soberano
                  </span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Región:</span>
                  <span className="font-semibold text-platinum">Nodo 0 (Hgo)</span>
                </div>
              </div>
            )}
            <button
              type="button"
              aria-label={isSidebarOpen ? "Contraer panel" : "Expandir panel"}
              aria-expanded={isSidebarOpen}
              aria-controls="isabella-sidebar"
              onClick={() => setIsSidebarOpen((open) => !open)}
              className="flex w-full items-center justify-center rounded-xl border border-border/30 bg-secondary/25 p-2 text-muted-foreground transition-all hover:bg-secondary/45 hover:text-platinum crystal-glow-electric"
            >
              {isSidebarOpen ? (
                <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                  <ChevronLeft className="size-4" /> Contraer Panel
                </span>
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
          </div>
        </aside>

        <div className="isabella-workspace flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
          <header className="isabella-topbar hairline shrink-0 bg-background/70 backdrop-blur-xl">
            <div className="isabella-command-strip flex items-center justify-between gap-4 px-6 py-3.5 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <span className="isabella-status-orb size-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
                <div>
                  <h1 className="font-mono text-[13px] font-bold uppercase leading-none tracking-wider text-platinum">
                    Isabella C.R.O.W.N. Terminal
                  </h1>
                  <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-widest text-muted-foreground">
                    {activeTab === "terminal" &&
                      `                    Canal gobernado: ${isabella.preset.name} · Decisión humana`}
                    {activeTab === "cli" && "Consola de Operaciones Directa"}
                    {activeTab === "governance" && "Gobernanza y Salud de Módulos Cognitivos"}
                    {activeTab === "catalog" && "Gobernanza de APIs e Invocaciones"}
                    {activeTab === "monetization" && "Tablero de Consumo Soberano"}
                    {activeTab === "quantum" && "Optimización y Transpilación Cuántica (qup)"}
                    {activeTab === "interfaces" && "Interfaces de Inteligencia Artificial"}
                    {activeTab === "aegis" && "Muro de Defensa Activa LATAM AEGIS-X"}
                    {activeTab === "findarepo" && "Ranking Global de Agentes (Findarepo)"}
                  </p>
                </div>
              </div>

              <div className="hidden items-center gap-2 xl:flex" aria-label="Estado del sistema">
                <span className="isabella-topbar-chip">
                  <span className="size-1.5 rounded-full bg-emerald-400" /> CROWN ONLINE
                </span>
                <span className="isabella-topbar-chip">LAT 42MS</span>
                <span className="isabella-topbar-chip isabella-topbar-chip--accent">
                  NODO 0 / HGO
                </span>
              </div>

              {activeTab === "terminal" && (
                <div className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json"
                    className="sr-only"
                    aria-label="Abrir conversación JSON"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void isabella.openConversation(file).catch(() => undefined);
                    }}
                  />
                  <button
                    type="button"
                    onClick={isabella.downloadConversation}
                    className="flex items-center gap-1.5 rounded-xl border border-border/30 bg-secondary/15 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground transition-all hover:bg-secondary/35 hover:text-platinum crystal-glow-electric"
                  >
                    <Download className="size-3" /> Descargar
                  </button>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-xl border border-border/30 bg-secondary/15 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground transition-all hover:bg-secondary/35 hover:text-platinum crystal-glow-electric"
                  >
                    <FolderOpen className="size-3" /> Reabrir
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanel((open) => !open)}
                    className="rounded-xl border border-border/30 bg-secondary/15 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground transition-all hover:bg-secondary/35 hover:text-platinum lg:hidden crystal-glow-electric"
                  >
                    {panel ? "Cerrar" : "Telemetría"}
                  </button>
                </div>
              )}
            </div>
          </header>

          <main className="isabella-content flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            {activeTab === "terminal" && (
              <div className="mx-auto grid h-full max-w-[1450px] items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
                <section className="flex min-w-0 flex-col gap-4">
                  <div
                    ref={chatSurfaceRef}
                    onScroll={handleChatScroll}
                    className="isabella-chat-surface glass relative min-h-[56vh] flex-1 overflow-y-auto rounded-[1.35rem] border-border/30 p-1 shadow-surface scroll-smooth"
                  >
                    <div className="isabella-surface-label px-5 pb-2 pt-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/5">
                      <div className="flex items-center gap-2">
                        <span>Canal cognitivo</span>
                        <span className="isabella-live-line" aria-hidden="true" />
                        <span className="text-emerald-300/80">ENCRIPTADO</span>
                      </div>

                      {/* User-controlled Auto-scroll Toggle Switch */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          role="switch"
                          id="chat-autoscroll-toggle"
                          aria-checked={autoScrollEnabled}
                          aria-label="Alternar desplazamiento automático a los mensajes más recientes"
                          onClick={toggleAutoScroll}
                          className="group flex items-center gap-2 rounded-full border border-border/40 bg-secondary/20 px-2.5 py-1 text-[10px] font-mono transition-all hover:border-electric/40 hover:bg-secondary/40 cursor-pointer"
                        >
                          <span className="text-muted-foreground group-hover:text-platinum">
                            Auto-scroll:
                          </span>
                          <span
                            className={`relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
                              autoScrollEnabled ? "bg-electric" : "bg-slate-700/80"
                            }`}
                          >
                            <span
                              className={`inline-block size-2.5 transform rounded-full bg-black transition-transform duration-200 ease-in-out ${
                                autoScrollEnabled ? "translate-x-3" : "translate-x-0.5"
                              }`}
                            />
                          </span>
                          <span
                            className={`text-[9px] font-bold tracking-wider ${
                              autoScrollEnabled ? "text-electric" : "text-muted-foreground"
                            }`}
                          >
                            {autoScrollEnabled ? "ON" : "OFF"}
                          </span>
                        </button>
                      </div>
                    </div>
                    <MessageStream
                      messages={isabella.messages}
                      onRetry={() => {
                        const retry = lastInput.current;
                        if (retry.text) send(retry.text, retry.attachments, retry.config);
                      }}
                    />

                    {/* Floating Jump to Latest Message / Auto-scroll button */}
                    {showScrollBottom && (
                      <div className="sticky bottom-3 z-30 flex justify-center pb-2 pointer-events-none">
                        <button
                          type="button"
                          onClick={() => scrollToBottom(true)}
                          className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-electric/40 bg-[#070b14]/95 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-electric shadow-xl shadow-black/70 hover:bg-electric hover:text-black transition-all cursor-pointer backdrop-blur-md animate-bounce"
                          aria-label="Desplazar hacia el mensaje más reciente"
                        >
                          <ArrowDown className="size-3" />
                          <span>Último mensaje</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="rounded-2xl crystal-glow-electric">
                    <CommandLine
                      onSend={send}
                      onStop={isabella.stop}
                      onReset={isabella.reset}
                      isProcessing={isabella.isProcessing}
                    />
                  </div>
                </section>
                <div
                  className={`${panel ? "block animate-rise" : "hidden lg:block"} flex flex-col gap-4`}
                >
                  <RightRails
                    presetId={isabella.presetId}
                    setPresetId={isabella.setPresetId}
                    decision={isabella.decision}
                    isProcessing={isabella.isProcessing}
                    onMonetizationNavigate={handleMonetizationNavigate}
                  />
                </div>
              </div>
            )}

            {activeTab === "cli" && (
              <div className="mx-auto max-w-[1300px] overflow-hidden rounded-3xl crystal-glow-electric">
                <TerminalView />
              </div>
            )}
            {activeTab === "governance" && (
              <div className="mx-auto max-w-[1300px]">
                <CognitiveStatusDashboard />
              </div>
            )}
            {activeTab === "catalog" && (
              <div className="mx-auto max-w-[1300px] overflow-hidden rounded-3xl crystal-glow-crown">
                <ApiCatalogExplorer />
              </div>
            )}
            {activeTab === "monetization" && (
              <div className="mx-auto max-w-[1300px] overflow-hidden rounded-3xl crystal-glow-emerald">
                <MonetizationDashboard initialTab={monetizationSubTab} />
              </div>
            )}
            {activeTab === "quantum" && (
              <div className="mx-auto max-w-[1300px] overflow-hidden rounded-3xl crystal-glow-crown">
                <QuantumUtilityDashboard />
              </div>
            )}
            {activeTab === "interfaces" && (
              <div className="mx-auto max-w-[1300px] overflow-hidden rounded-3xl crystal-glow-crown">
                <AiInterfacesHub />
              </div>
            )}
            {activeTab === "aegis" && (
              <div className="mx-auto max-w-[1300px] overflow-hidden rounded-3xl crystal-glow-crown">
                <LatamAegisDashboard />
              </div>
            )}
            {activeTab === "findarepo" && (
              <div className="mx-auto h-[85vh] max-w-[1300px] overflow-hidden rounded-3xl crystal-glow-electric">
                <FindarepoDashboard />
              </div>
            )}
            {activeTab === "video-x" && (
              <div className="mx-auto max-w-[1300px] overflow-hidden rounded-3xl crystal-glow-electric">
                <VideoEngineXDashboard />
              </div>
            )}
          </main>
        </div>
      </div>
    </Suspense>
  );
}

export default IndexClient;
