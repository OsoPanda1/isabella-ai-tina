import React, { useState, useEffect } from "react";
import { Shield, Search, Play, Printer, RefreshCw, Lock, Check, Server } from "lucide-react";
import { soundManager } from "../../utils/soundEffects";
import {
  territoryContextService,
  TerritoryContextSnapshot,
} from "../../services/territoryContextService";
import { useCrown } from "../../context/CrownContext";
import { CryptographyTab } from "./CryptographyTab";
import { LedgerInspector } from "./LedgerInspector";

export interface TraceStep {
  id: "input" | "intent" | "risk_check" | "tool_use" | "output";
  name: string;
  subsystem: string;
  status: "completed" | "evaluating" | "escalated" | "blocked" | "idle";
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  summary: string;
  details: Record<string, any>;
  sha256Digest: string;
}

export interface CognitiveTraceRecord {
  traceId: string;
  timestamp: string;
  rawInput: string;
  actorId: string;
  territoryId: string;
  inferenceEngine: "Cloud Federated (Gemini 3.7 Pro)" | "Local Sovereign Engine (Nodo Cero)";
  overallLatencyMs: number;
  policyStatus: "allowed" | "requires_approval" | "denied";
  riskLevel: "low" | "medium" | "high";
  steps: TraceStep[];
  territorySnapshot: TerritoryContextSnapshot;
  finalSynthesis: string;
  immutableLedgerHash: string;
}

const PipelineVisualizer: React.FC<{
  steps: TraceStep[];
  activeStepId: string;
  onStepClick: (id: string) => void;
}> = ({ steps, activeStepId, onStepClick }) => {
  const activeIndex = steps.findIndex((s) => s.id === activeStepId);

  return (
    <div className="relative w-full max-w-3xl mx-auto h-24 flex items-center justify-between px-8">
      {/* Background Track */}
      <div className="absolute left-8 right-8 h-[1px] bg-slate-800" />

      {/* Animated Fill Track */}
      <div
        className="absolute left-8 h-[1.5px] bg-amber-400/80 transition-all duration-700 ease-in-out shadow-[0_0_10px_rgba(251,191,36,0.4)]"
        style={{
          width: `calc(${(activeIndex / Math.max(steps.length - 1, 1)) * 100}% - ${activeIndex === steps.length - 1 ? 0 : 32}px)`,
        }}
      />

      {steps.map((step, i) => {
        const isActive = i === activeIndex;
        const isPast = i <= activeIndex;
        return (
          <div
            key={step.id}
            className="group relative flex flex-col items-center cursor-pointer z-10"
            onClick={() => onStepClick(step.id)}
          >
            {/* Node Circle */}
            <div className="relative flex items-center justify-center w-8 h-8">
              {isActive && (
                <div className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping" />
              )}
              <div
                className={`w-3 h-3 rounded-full transition-all duration-500 ring-4 ring-[#060A12] ${
                  isActive
                    ? "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)] scale-125"
                    : isPast
                      ? "bg-amber-600/60"
                      : "bg-slate-700"
                }`}
              />
            </div>

            {/* Label */}
            <div className="absolute top-10 w-32 text-center">
              <span
                className={`text-[10px] uppercase tracking-widest font-mono transition-colors duration-300 block ${
                  isActive
                    ? "text-amber-300 font-bold"
                    : isPast
                      ? "text-slate-400"
                      : "text-slate-600"
                }`}
              >
                {step.name.split(". ")[1] || step.name}
              </span>
              <div
                className={`text-[9px] font-mono mt-1 transition-opacity duration-300 ${
                  isActive ? "text-slate-400 opacity-100" : "opacity-0"
                }`}
              >
                {step.latencyMs}ms
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const TraceabilityDashboard: React.FC = () => {
  const { state } = useCrown();
  const [activeTab, setActiveTab] = useState<"traceability" | "cryptography" | "ledger">(
    "traceability",
  );
  const [selectedTrace, setSelectedTrace] = useState<CognitiveTraceRecord | null>(null);
  const [activeStepId, setActiveStepId] = useState<TraceStep["id"]>("input");
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulatedInputText, setSimulatedInputText] = useState<string>(
    "Consultar inventario de patrimonio minero en Mina de Acosta y verificar integridad.",
  );
  const [simulatedRiskPreset, setSimulatedRiskPreset] = useState<"low" | "medium" | "high">("low");
  const [auditFilter, setAuditFilter] = useState<string>("");

  const [traceHistory, setTraceHistory] = useState<CognitiveTraceRecord[]>([
    {
      traceId: "tr-crown-rdm-2026-9810",
      timestamp: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
      rawInput:
        "Consultar inventario de patrimonio minero en Mina de Acosta y verificar integridad de registros históricos.",
      actorId: "usr-investigador-04",
      territoryId: "rdm-nodo-cero",
      inferenceEngine:
        state.inferenceMode === "local_sovereign"
          ? "Local Sovereign Engine (Nodo Cero)"
          : "Cloud Federated (Gemini 3.7 Pro)",
      overallLatencyMs: 142,
      policyStatus: "allowed",
      riskLevel: "low",
      territorySnapshot: territoryContextService.getSnapshot(),
      finalSynthesis:
        "Se verificó la integridad del registro minero de Mina de Acosta (1727). Tiro de mina y casa de máquinas Cornish validados con firma SHA-256 en Enclave Territorial.",
      immutableLedgerHash: "—",
      steps: [
        {
          id: "input",
          name: "1. Ingestión",
          subsystem: "C.R.O.W.N. Sensory Gateway",
          status: "completed",
          latencyMs: 8,
          tokensIn: 34,
          summary:
            "Percepción normalizada en canal UTF-8 y etiquetada con identificador de territorio 'rdm-nodo-cero'.",
          details: {
            sourceChannel: "academic_console",
            encoding: "UTF-8 / strict",
            ipHash: "9a82f3...01c4",
            sovereigntyEnclave: "ND-RDM-001",
          },
          sha256Digest: "8f49b1a03e481c7e923e201b2a758d689622d99d10e6e76191b7a2d3b45c2210",
        },
        {
          id: "intent",
          name: "2. Intención",
          subsystem: "ORION Cognitive Core",
          status: "completed",
          latencyMs: 38,
          tokensIn: 34,
          tokensOut: 62,
          summary:
            "Vector semántico clasificado en categoría 'Patrimonio & Memoria Territorial' con afinidad 98.4%.",
          details: {
            intentVector: [0.892, 0.412, -0.125, 0.764],
            primaryAffinity: "Territorial_Heritage_Research",
            confidenceScore: 0.984,
          },
          sha256Digest: "3c7a9b109e201948bc81726aef19283746591028374651928374650192837465",
        },
        {
          id: "risk_check",
          name: "3. Zero-Trust",
          subsystem: "ARGUS Policy Gate",
          status: "completed",
          latencyMs: 14,
          summary:
            "Evaluación de políticas C.R.O.W.N. Zero-Trust satisfactoria. Nivel de riesgo bajo; sin exfiltración.",
          details: {
            ruleChecks: [
              { rule: "RULE_01_ZERO_TRUST_TOOL_WHITELIST", verdict: "PASS" },
              { rule: "RULE_02_TERRITORIAL_DATA_BOUNDARY", verdict: "PASS" },
            ],
            riskLevel: "low",
          },
          sha256Digest: "fa82910bc7461928374651928374650192837465910283746501928374659102",
        },
        {
          id: "tool_use",
          name: "4. Ejecución",
          subsystem: "Sovereign Tool Execution Engine",
          status: "completed",
          latencyMs: 44,
          summary:
            "Ejecución de 'rdm_territory_query' con payload de patrimonio minero en memoria territorial.",
          details: {
            toolName: "rdm_territory_query",
            arguments: { category: "mineria", query: "Mina de Acosta 1727" },
            sandboxStatus: "isolated_container_ok",
          },
          sha256Digest: "1928374659102837465019283746591028374650192837465910283746501928",
        },
        {
          id: "output",
          name: "5. Síntesis",
          subsystem: "ISA + SOPHIA Resonator",
          status: "completed",
          latencyMs: 38,
          tokensOut: 118,
          summary:
            "Generación de respuesta epistemológica y asentamiento criptográfico en el libro mayor SHA-256.",
          details: {
            synthesisModule: "ISA_Executive",
            ledgerCommitBlock: "#408,192",
            proofChain: "e3b0c442...52b855",
          },
          sha256Digest: "—",
        },
      ],
    },
  ]);

  useEffect(() => {
    if (!selectedTrace && traceHistory.length > 0) {
      setSelectedTrace(traceHistory[0]);
    }
  }, [traceHistory, selectedTrace]);

  const handleSimulatePipeline = () => {
    if (isSimulating || !simulatedInputText.trim()) return;

    setIsSimulating(true);
    soundManager.playBeep(720, 0.04);

    const newTraceId = `tr-crown-rdm-${Date.now().toString().slice(-6)}`;
    const snapshot = territoryContextService.getSnapshot();

    const initialRecord: CognitiveTraceRecord = {
      traceId: newTraceId,
      timestamp: new Date().toISOString(),
      rawInput: simulatedInputText,
      actorId: "usr-analista-rdm",
      territoryId: "rdm-nodo-cero",
      inferenceEngine:
        state.inferenceMode === "local_sovereign"
          ? "Local Sovereign Engine (Nodo Cero)"
          : "Cloud Federated (Gemini 3.7 Pro)",
      overallLatencyMs: 168,
      policyStatus: simulatedRiskPreset === "high" ? "requires_approval" : "allowed",
      riskLevel: simulatedRiskPreset,
      territorySnapshot: snapshot,
      finalSynthesis:
        simulatedRiskPreset === "high"
          ? "ATENCIÓN: La solicitud fue clasificada como de alto riesgo por ARGUS. Se requiere ratificación humana antes del desembolso."
          : `Síntesis soberana completada. Registro auditado y vinculado al nodo territorial Real del Monte.`,
      immutableLedgerHash: `sha256_${Date.now().toString(16)}_rdm_sovereign_proof`,
      steps: [
        {
          id: "input",
          name: "1. Ingestión",
          subsystem: "C.R.O.W.N. Sensory Gateway",
          status: "completed",
          latencyMs: 12,
          tokensIn: Math.round(simulatedInputText.length / 3.8),
          summary: "Percepción recibida y normalizada en el canal de soberanía territorial.",
          details: { channel: "academic_evaluation", timestamp: new Date().toISOString() },
          sha256Digest: `hash_input_${Date.now().toString(16)}`,
        },
        {
          id: "intent",
          name: "2. Intención",
          subsystem: "ORION Cognitive Core",
          status: "completed",
          latencyMs: 42,
          tokensIn: Math.round(simulatedInputText.length / 3.8),
          tokensOut: 48,
          summary:
            "Clasificación semántica e inferencia de objetivos en el plano multidimensional.",
          details: {
            intentClass:
              simulatedRiskPreset === "high"
                ? "Financial_Or_Critical_Mutation"
                : "Knowledge_Synthesis",
            confidenceScore: 0.976,
          },
          sha256Digest: `hash_intent_${Date.now().toString(16)}`,
        },
        {
          id: "risk_check",
          name: "3. Zero-Trust",
          subsystem: "ARGUS Policy Gate",
          status: simulatedRiskPreset === "high" ? "escalated" : "completed",
          latencyMs: 18,
          summary:
            simulatedRiskPreset === "high"
              ? "POLÍTICA ZERO-TRUST: Requiere escalamiento y aprobación humana obligatoria."
              : "Validación estricta de políticas superada sin riesgos de exfiltración.",
          details: {
            riskLevel: simulatedRiskPreset,
            governanceStatus:
              simulatedRiskPreset === "high"
                ? "REQUIRES_HUMAN_SIGNATURE"
                : "APPROVED_AUTOMATICALLY",
          },
          sha256Digest: `hash_policy_${Date.now().toString(16)}`,
        },
        {
          id: "tool_use",
          name: "4. Ejecución",
          subsystem: "Sovereign Tool Execution Engine",
          status: simulatedRiskPreset === "high" ? "blocked" : "completed",
          latencyMs: 48,
          summary:
            simulatedRiskPreset === "high"
              ? "Herramientas en pausa preventiva en espera de aprobación de firma."
              : "Consulta y orquestación ejecutadas en entorno seguro con aislamiento completo.",
          details: {
            toolTriggered: "territory_knowledge_query",
            executionBoundary: "local_sandbox",
          },
          sha256Digest: `hash_tool_${Date.now().toString(16)}`,
        },
        {
          id: "output",
          name: "5. Síntesis",
          subsystem: "ISA + SOPHIA Resonator",
          status: "completed",
          latencyMs: 48,
          tokensOut: 96,
          summary:
            "Respuesta formulada con precisión académica y commit en el registro inmutable de auditoría.",
          details: {
            ledgerReceipt: "CONFIRMED",
            enclaveDigest: `enclave_rdm_${Date.now().toString(16)}`,
          },
          sha256Digest: `hash_synthesis_${Date.now().toString(16)}`,
        },
      ],
    };

    setTimeout(() => {
      setTraceHistory((prev) => [initialRecord, ...prev]);
      setSelectedTrace(initialRecord);
      setActiveStepId("input"); // Reset visualization to start
      setIsSimulating(false);
      soundManager.playSuccess();
    }, 800);
  };

  const handlePrintAudit = () => {
    window.print();
  };

  const filteredHistory = traceHistory.filter((t) => {
    if (!auditFilter) return true;
    const q = auditFilter.toLowerCase();
    return t.traceId.toLowerCase().includes(q) || t.rawInput.toLowerCase().includes(q);
  });

  const activeStep =
    selectedTrace?.steps.find((s) => s.id === activeStepId) || selectedTrace?.steps[0];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-12 animate-fade-in text-slate-200">
      {/* Refined Header & Simulator */}
      <header className="flex flex-col items-center text-center space-y-6">
        <div className="inline-flex items-center justify-center p-2 rounded-xl bg-slate-900 border border-slate-800 text-amber-300">
          <Shield className="w-5 h-5" />
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-light text-slate-100 tracking-wide">Auditoría Zero-Trust</h2>
          <p className="text-sm font-mono text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Inspección determinista del flujo cognitivo. Garantizando la soberanía de datos y la
            alineación territorial en el Nodo Cero.
          </p>
        </div>

        <div className="flex bg-slate-900/50 p-1 border border-slate-800/80 rounded-xl">
          <button
            onClick={() => setActiveTab("traceability")}
            className={`px-6 py-2 text-xs font-mono rounded-lg transition-colors ${
              activeTab === "traceability"
                ? "bg-slate-800 text-slate-200 border border-slate-700"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            Trazabilidad Cognitiva
          </button>
          <button
            onClick={() => setActiveTab("cryptography")}
            className={`px-6 py-2 text-xs font-mono rounded-lg transition-colors ${
              activeTab === "cryptography"
                ? "bg-slate-800 text-slate-200 border border-slate-700"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            Perfil Criptográfico PQC
          </button>
          <button
            onClick={() => setActiveTab("ledger")}
            className={`px-6 py-2 text-xs font-mono rounded-lg transition-colors ${
              activeTab === "ledger"
                ? "bg-slate-800 text-slate-200 border border-slate-700"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            Ledger BookPI
          </button>
        </div>

        {/* Minimalist Command Input Simulator */}
        {activeTab === "traceability" && (
          <div className="w-full max-w-2xl mx-auto mt-6 relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500/0 via-amber-500/10 to-amber-500/0 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-1000"></div>
            <div className="relative flex items-center bg-[#030712] border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
              <input
                type="text"
                value={simulatedInputText}
                onChange={(e) => setSimulatedInputText(e.target.value)}
                className="flex-1 bg-transparent px-5 py-3.5 text-sm font-mono text-slate-200 focus:outline-none placeholder:text-slate-600"
                placeholder="Ingresa instrucción para flujo de auditoría..."
                onKeyDown={(e) => e.key === "Enter" && handleSimulatePipeline()}
              />
              <div className="flex items-center px-2 gap-3 border-l border-slate-800">
                <select
                  value={simulatedRiskPreset}
                  onChange={(e) =>
                    setSimulatedRiskPreset(e.target.value as "low" | "medium" | "high")
                  }
                  className="bg-transparent text-xs font-mono text-slate-400 focus:outline-none cursor-pointer py-2 pl-2"
                >
                  <option value="low">Riesgo Bajo</option>
                  <option value="medium">Riesgo Medio</option>
                  <option value="high">Riesgo Alto</option>
                </select>
                <button
                  onClick={handleSimulatePipeline}
                  disabled={isSimulating}
                  className="p-2.5 text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isSimulating ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {activeTab === "cryptography" && <CryptographyTab />}
      {activeTab === "ledger" && <LedgerInspector />}

      {activeTab === "traceability" && (
        <>
          {/* Elegant SVG Pipeline Visualizer */}
          {selectedTrace && (
            <div className="relative py-8">
              <PipelineVisualizer
                steps={selectedTrace.steps}
                activeStepId={activeStepId}
                onStepClick={(id) => {
                  setActiveStepId(id as TraceStep["id"]);
                  soundManager.playBeep(750, 0.02);
                }}
              />
            </div>
          )}

          {/* Main Master-Detail Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 border-t border-slate-800/60 pt-12">
            {/* Left Column: Minimal Trace History */}
            <div className="lg:col-span-4 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest">
                  Registro Histórico ({traceHistory.length})
                </h3>
                <button
                  onClick={handlePrintAudit}
                  className="text-slate-500 hover:text-slate-300 transition-colors"
                  title="Imprimir Reporte"
                >
                  <Printer className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-600 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={auditFilter}
                  onChange={(e) => setAuditFilter(e.target.value)}
                  placeholder="Buscar hash o texto..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-transparent border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-slate-600 transition-colors"
                />
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {filteredHistory.map((t) => {
                  const isSelected = selectedTrace?.traceId === t.traceId;
                  return (
                    <div
                      key={t.traceId}
                      onClick={() => {
                        setSelectedTrace(t);
                        setActiveStepId("input");
                        soundManager.playBeep(800, 0.02);
                      }}
                      className={`p-4 rounded-xl border text-left cursor-pointer transition-all duration-300 ${
                        isSelected
                          ? "bg-slate-900 border-slate-700 shadow-sm"
                          : "bg-transparent border-slate-800/50 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[11px] font-bold text-slate-300">
                          {t.traceId}
                        </span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${t.policyStatus === "allowed" ? "bg-emerald-400" : "bg-amber-400"}`}
                        />
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                        {t.rawInput}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Detailed Typography-Driven Inspector */}
            <div className="lg:col-span-8">
              {activeStep ? (
                <div className="space-y-10 animate-fade-in">
                  {/* Step Header Description */}
                  <div className="space-y-3">
                    <h3 className="text-2xl font-light text-slate-100">
                      {activeStep.name.split(". ")[1] || activeStep.name}
                      <span className="text-sm text-slate-500 font-mono ml-3 block sm:inline mt-1 sm:mt-0">
                        ({activeStep.subsystem})
                      </span>
                    </h3>
                    <p className="text-sm text-slate-400 leading-relaxed max-w-2xl font-sans">
                      {activeStep.summary}
                    </p>
                  </div>

                  {/* Data & Cryptography Sections */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 border-t border-slate-800/50">
                    {/* Details Payload */}
                    <div className="space-y-4">
                      <h4 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Server className="w-3 h-3" />
                        Metadatos de Subsistema (Evidence Record)
                      </h4>

                      {/* Detailed Evidence Metadata Drawer (Glassmorphism) */}
                      <div className="bg-slate-900/30 backdrop-blur-md border border-slate-700/50 p-5 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.37)] space-y-4 hover:bg-slate-800/40 transition-all cursor-pointer">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1 border-r border-slate-700/50 pr-2">
                            <div className="text-[9px] font-mono text-slate-500 uppercase">
                              Content Hash
                            </div>
                            <div
                              className="text-xs font-mono text-slate-300 truncate"
                              title={activeStep.sha256Digest}
                            >
                              {activeStep.sha256Digest.slice(0, 16)}...
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[9px] font-mono text-slate-500 uppercase">
                              Identity Confidence
                            </div>
                            <div className="text-xs font-bold font-sans text-emerald-400">
                              Auto-verificado (local)
                            </div>
                          </div>
                          <div className="space-y-1 col-span-2 border-t border-slate-700/50 pt-3">
                            <div className="text-[9px] font-mono text-slate-500 uppercase">
                              Freshness Score
                            </div>
                            <div className="text-xs font-sans text-slate-300 flex items-center gap-2">
                              <div className="w-full bg-slate-800 rounded-full h-1.5">
                                <div className="bg-blue-400 h-1.5 rounded-full w-[95%]"></div>
                              </div>
                              <span className="text-blue-400 font-bold">0.95</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <pre className="text-[11px] font-mono text-slate-400 bg-[#030712] p-4 rounded-xl border border-slate-800/60 overflow-x-auto shadow-inner leading-relaxed mt-4">
                        {JSON.stringify(activeStep.details, null, 2)}
                      </pre>
                    </div>

                    {/* Cryptographic Ledger */}
                    <div className="space-y-4">
                      <h4 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Lock className="w-3 h-3" />
                        Firma Criptográfica SHA-256
                      </h4>
                      <div className="text-[11px] font-mono text-slate-400 break-all leading-relaxed p-4 bg-[#030712] border border-slate-800/60 rounded-xl shadow-inner">
                        {activeStep.sha256Digest}
                      </div>

                      <div className="flex gap-4 pt-2">
                        <div className="space-y-1">
                          <div className="text-[10px] text-slate-500 font-mono uppercase">
                            Latencia
                          </div>
                          <div className="text-sm font-mono text-slate-300">
                            {activeStep.latencyMs}ms
                          </div>
                        </div>
                        {activeStep.tokensIn && (
                          <div className="space-y-1">
                            <div className="text-[10px] text-slate-500 font-mono uppercase">
                              Tokens In
                            </div>
                            <div className="text-sm font-mono text-slate-300">
                              {activeStep.tokensIn}
                            </div>
                          </div>
                        )}
                        {activeStep.tokensOut && (
                          <div className="space-y-1">
                            <div className="text-[10px] text-slate-500 font-mono uppercase">
                              Tokens Out
                            </div>
                            <div className="text-sm font-mono text-slate-300">
                              {activeStep.tokensOut}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Final Synthesis Block - Only prominent if looking at output or naturally nested at the bottom */}
                  {activeStep.id === "output" && selectedTrace && (
                    <div className="pt-8 mt-4 border-t border-slate-800/50 space-y-4 animate-fade-in">
                      <h4 className="text-[10px] font-bold font-mono text-amber-500/70 uppercase tracking-widest flex items-center gap-2">
                        <Check className="w-3.5 h-3.5" />
                        Síntesis Final & Asentamiento Inmutable
                      </h4>
                      <p className="text-sm font-sans text-slate-300 leading-relaxed max-w-3xl bg-slate-900/40 p-4 rounded-xl border border-slate-800/60">
                        {selectedTrace.finalSynthesis}
                      </p>
                      <div className="text-[10px] font-mono text-slate-500">
                        Hash de Auditoría Principal:{" "}
                        <span className="text-slate-400">{selectedTrace.immutableLedgerHash}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs p-12">
                  Seleccione un registro para inspeccionar el flujo.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
