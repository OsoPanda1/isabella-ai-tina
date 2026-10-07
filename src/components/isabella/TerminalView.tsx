import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { Terminal, RefreshCw } from "lucide-react";
import { useIsabella } from "@/lib/useIsabella";
import { usePerformanceMonitor } from "@/hooks/usePerformanceMonitor";
import { ISABELLA_VERSION } from "@/lib/isabella-crown";

interface TerminalLine {
  text: string;
  type: "input" | "output" | "system" | "error" | "success" | "header";
}

export function TerminalView() {
  const isabella = useIsabella();
  const { startTrack } = usePerformanceMonitor("TerminalView");
  const [inputVal, setInputVal] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [lines, setLines] = useState<TerminalLine[]>([
    { text: `ISABELLA COGNITIVE SHELL v${ISABELLA_VERSION}-SOVEREIGN`, type: "header" },
    {
      text: "TAMV ONLINE NETWORK · Nodo Cero · Real del Monte, Hidalgo",
      type: "system",
    },
    {
      text: "Gobernanza C.R.O.W.N. activa en canal criptográfico seguro.",
      type: "success",
    },
    {
      text: 'Escribe "help" para listar los comandos constitucionales disponibles.',
      type: "system",
    },
    {
      text: "--------------------------------------------------------",
      type: "system",
    },
  ]);

  const bufferEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bufferEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // Focus the input when clicking anywhere in the terminal container
  const handleTerminalClick = () => {
    inputRef.current?.focus();
  };

  const addLine = (text: string, type: TerminalLine["type"]) => {
    setLines((prev) => [...prev, { text, type }]);
  };

  const handleCommandSubmit = async (cmdStr: string) => {
    const trimmed = cmdStr.trim();
    if (!trimmed) return;

    // Start performance tracking of CLI command execution
    const stopTrack = startTrack(`CLI Command Execution: ${trimmed.split(" ")[0]}`);

    // Save to command history
    setHistory((prev) => [trimmed, ...prev]);
    setHistoryIndex(-1);

    addLine(`operator@isabella-node-zero:~$ ${trimmed}`, "input");
    setInputVal("");

    const args = trimmed.split(" ");
    const command = args[0]?.toLowerCase();

    switch (command) {
      case "help":
        addLine("Comandos Constitucionales Disponibles:", "success");
        addLine("  help      - Muestra esta lista de comandos.", "output");
        addLine("  info      - Muestra las especificaciones cognitivas de Isabella.", "output");
        addLine("  status    - Evalúa la salud de las cabezas y latencia de red.", "output");
        addLine("  audit     - Muestra las trazas de decisiones C.R.O.W.N. recientes.", "output");
        addLine("  monetize  - Carga el plan constitucional de monetización soberana.", "output");
        addLine("  clear     - Limpia el búfer de la terminal.", "output");
        addLine("  [texto]   - Envía cualquier otra consulta al motor de Isabella.", "output");
        stopTrack();
        break;

      case "clear":
        setLines([]);
        stopTrack();
        break;

      case "info":
        addLine("Especificaciones del Sistema Cognitivo:", "success");
        addLine("  - Arquitectura: Cognitiva Híbrida Gobernada", "output");
        addLine("  - Autoría: Edwin Oswaldo Castillo Trejo (Anubis Villaseñor)", "output");
        addLine("  - ORCID: 0009-0008-5050-1539", "output");
        addLine("  - Gateway: CROWN Decision Router", "output");
        addLine("  - Licencia: CC Attribution 4.0 International", "output");
        stopTrack();
        break;

      case "status":
        addLine("Escanenado Cabezas Cognitivas...", "system");
        setTimeout(() => {
          addLine(
            "  [✓] ISA Core       - En línea (Latencia: 8ms) - Modulación empática activa",
            "output",
          );
          addLine(
            "  [✓] SOPHIA Engine  - En línea (Latencia: 14ms) - Verificador epistemológico activo",
            "output",
          );
          addLine(
            "  [✓] ORION Engine   - En línea (Latencia: 11ms) - Ejecutor PRAXIS habilitado",
            "output",
          );
          addLine(
            "  [✓] ARGUS Sentinel - En línea (Latencia: 5ms) - Filtro de veto constitucional activo",
            "output",
          );
          addLine(
            "  [✓] CROWN Gateway  - En línea (Latencia: 3ms) - Orquestador C.R.O.W.N. activo",
            "output",
          );
          addLine("Estado general del nodo: EXCELENTE (Soberanía Territorial 100%)", "success");
          stopTrack();
        }, 300);
        break;

      case "audit":
        addLine("Recuperando registro de auditoría C.R.O.W.N...", "system");
        setTimeout(() => {
          if (isabella.decision) {
            addLine(`Última Decisión [ID: ${isabella.decision.traceId}]:`, "success");
            addLine(`  - Ruta: ${isabella.decision.primary.toUpperCase()}`, "output");
            addLine(`  - Evaluación: ${isabella.decision.policy.toUpperCase()}`, "output");
            addLine(`  - Justificación: ${isabella.decision.rationale}`, "output");
            addLine(`  - Regla: ${isabella.decision.policyReason}`, "output");
          } else {
            addLine(
              "No se encontraron decisiones previas en esta sesión. Envía un mensaje normal para activar el gateway.",
              "error",
            );
          }
          stopTrack();
        }, 200);
        break;

      case "monetize":
        addLine("Cargando Directrices de Monetización Soberana...", "system");
        setTimeout(() => {
          addLine("Ecosistema Económico Sostenible de Isabella:", "success");
          addLine(
            "  1. Plan Gratuito      - Freemium con límites para reducir barrera de entrada.",
            "output",
          );
          addLine(
            "  2. Membresías         - Suscripciones mensuales/anuales (Pro, Creator, Research).",
            "output",
          );
          addLine(
            "  3. Créditos           - Consumo de capacidades complejas (Ledger exacto).",
            "output",
          );
          addLine(
            "  4. API Developers     - Acceso controlado mediante OAuth con scopes estrictos.",
            "output",
          );
          addLine(
            "  5. Marketplace Skills - Venta de herramientas PRAXIS validadas mediante SAST.",
            "output",
          );
          addLine(
            'Escribe "monetize --detail" o ingresa a la pestaña "Modelos de Monetización" para ver el plan completo.',
            "success",
          );
          stopTrack();
        }, 200);
        break;

      case "monetize --detail":
        addLine("Monetización Detallada:", "success");
        addLine(
          "  - Regla de Oro: Se cobra por infraestructura y procesamiento; la privacidad es un derecho básico.",
          "output",
        );
        addLine(
          "  - Ledger: BookPI maneja transacciones con precisión decimal absoluta.",
          "output",
        );
        addLine(
          "  - Proporciones sugeridas: 40% Enterprise, 25% Suscripciones, 15% APIs, 10% Servicios.",
          "output",
        );
        stopTrack();
        break;

      default:
        // Handle as standard chat input
        addLine("Isabella procesando entrada...", "system");
        try {
          // Direct call to useIsabella's logic
          await isabella.send(trimmed, []);
        } catch {
          addLine("Error en percepción de canal.", "error");
        }
        stopTrack();
        break;
    }
  };

  // Sync isabella response streams back to the terminal CLI
  useEffect(() => {
    if (isabella.messages.length === 0) return;
    const lastMsg = isabella.messages[isabella.messages.length - 1];
    if (lastMsg && lastMsg.role === "isabella" && !lastMsg.streaming) {
      // Avoid duplicate lines of assistant replies
      const text = lastMsg.content;
      const isDuplicate = lines.some((l) => l.text === text && l.type === "output");
      if (!isDuplicate) {
        addLine(text, "output");
      }
    }
  }, [isabella.messages, lines]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void handleCommandSubmit(inputVal);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0 && historyIndex < history.length - 1) {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        const prevCmd = history[nextIdx];
        if (prevCmd) setInputVal(prevCmd);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        const prevCmd = history[nextIdx];
        if (prevCmd) setInputVal(prevCmd);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputVal("");
      }
    }
  };

  return (
    <div
      onClick={handleTerminalClick}
      className="glass rounded-3xl overflow-hidden border border-border/40 shadow-glass flex flex-col h-[65vh] font-mono text-[13px] leading-relaxed cursor-text"
    >
      {/* Top Header Bar */}
      <div className="bg-secondary/20 border-b border-border/30 px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-rose-500/80" />
          <span className="size-3 rounded-full bg-amber-500/80" />
          <span className="size-3 rounded-full bg-emerald-500/80" />
          <span className="ml-2 font-mono text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
            <Terminal className="size-3 text-electric" />
            isabella@cognitive-shell:~
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            SECURE PORT
          </span>
          <span className="text-[10px] text-muted-foreground">9600 BAUD</span>
        </div>
      </div>

      {/* Terminal Output Stream */}
      <div className="flex-1 overflow-y-auto p-6 space-y-2 select-text selection:bg-electric/30">
        {lines.map((l, index) => {
          let colorClass = "text-platinum/90";
          if (l.type === "header")
            colorClass = "text-iridescent text-[14px] font-bold tracking-wide";
          if (l.type === "system") colorClass = "text-muted-foreground";
          if (l.type === "error") colorClass = "text-rose-400 font-semibold";
          if (l.type === "success") colorClass = "text-emerald-400 font-semibold";
          if (l.type === "input") colorClass = "text-electric font-semibold";

          return (
            <div key={index} className="whitespace-pre-wrap break-all">
              {l.type === "input" ? (
                <span>{l.text}</span>
              ) : (
                <span className={colorClass}>{l.text}</span>
              )}
            </div>
          );
        })}
        {isabella.isProcessing && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin text-electric" />
            <span>Isabella está procesando inferencia cognitiva...</span>
          </div>
        )}
        <div ref={bufferEndRef} />
      </div>

      {/* Interactive Command Input Prompt */}
      <div className="bg-secondary/10 border-t border-border/20 px-6 py-4 flex items-center gap-2.5">
        <span className="text-electric shrink-0 font-semibold">operator@isabella-node-zero:~$</span>
        <div className="flex-1 flex items-center relative">
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isabella.isProcessing}
            className="w-full bg-transparent border-none outline-none text-platinum font-mono text-[13px] caret-transparent focus:ring-0 focus:outline-none"
            autoFocus
          />
          {/* Custom blinking caret positioned at the end of the typed characters */}
          <span
            className="absolute pointer-events-none bg-electric h-[15px] w-[8px] animate-caret"
            style={{
              left: `${Math.min(inputVal.length * 7.8, inputRef.current?.offsetWidth || 0)}px`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
