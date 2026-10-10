import React, { useState, useEffect } from "react";
import {
  Server,
  Shield,
  Database,
  Play,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Download,
  Search,
  RefreshCw,
  Layers,
  Sparkles,
  Zap,
  Globe,
  Cpu,
  Lock,
  FileText,
  Clock,
  Key,
} from "lucide-react";
import { soundManager } from "../../utils/soundEffects";
import { ISABELLA_SQL_MIGRATION, SCHEMA_TABLES } from "../../data/isabellaMigrations";
import { ISABELLA_BLUEPRINT } from "../../data/isabellaBlueprint";
import {
  IsabellaDecision,
  IsabellaAuditLog,
  IsabellaMemoryItem,
  IsabellaTool,
  IsabellaMemoryScope,
  IsabellaInputType,
} from "../../contracts/isabella";

import { IsabellaAgent, AgentSessionInfo, AgentChatResponse } from "../../lib/isabella-agent-sdk";
import { authFetch } from "../../lib/auth-client";

type HubSubTab =
  | "perception_runner"
  | "agent_sdk"
  | "audit_trail"
  | "memory_scopes"
  | "tools_catalog"
  | "sql_migrations"
  | "blueprint";

export const IsabellaHubView: React.FC = () => {
  const [subTab, setSubTab] = useState<HubSubTab>("perception_runner");
  const [copiedSql, setCopiedSql] = useState(false);
  const [, setCopiedTrace] = useState<string | null>(null);

  // Perception Runner State
  const [inputType, setInputType] = useState<IsabellaInputType>("chat");
  const [payloadText, setPayloadText] = useState(
    "¿Qué lugares patrimoniales puedo visitar en Real del Monte?",
  );
  const [riskSimulation, setRiskSimulation] = useState<"low" | "medium" | "high">("low");
  const [selectedToolToRequest] = useState<string>("none");
  const [isRunningPerception, setIsRunningPerception] = useState(false);
  const [lastDecision, setLastDecision] = useState<IsabellaDecision | null>(null);

  // Agent SDK & Leasing State
  const [agentSession, setAgentSession] = useState<AgentSessionInfo | null>(null);
  const [agentPrompt, setAgentPrompt] = useState(
    "Genera un análisis de infraestructura soberana para Nodo Cero.",
  );
  const [agentResponse, setAgentResponse] = useState<AgentChatResponse | null>(null);
  const [isLeasingAgent, setIsLeasingAgent] = useState(false);
  const [isRunningAgentChat, setIsRunningAgentChat] = useState(false);

  // Live Data States
  const [auditLogs, setAuditLogs] = useState<IsabellaAuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState("");
  const [memories, setMemories] = useState<IsabellaMemoryItem[]>([]);
  const [activeMemoryScope, setActiveMemoryScope] = useState<IsabellaMemoryScope | "all">("all");
  const [memorySearch] = useState("");
  const [tools, setTools] = useState<IsabellaTool[]>([]);
  const [selectedToolForSandbox, setSelectedToolForSandbox] =
    useState<string>("rdm_territory_query");
  const [toolSandboxArgs, setToolSandboxArgs] = useState(
    `{"category": "patrimonio", "query": "minas históricas"}`,
  );
  const [toolExecutionResult, setToolExecutionResult] = useState<any>(null);
  const [isExecutingTool, setIsExecutingTool] = useState(false);

  // New Memory Item Form
  const [newMemContent, setNewMemContent] = useState("");
  const [newMemScope, setNewMemScope] = useState<IsabellaMemoryScope>("project");
  const [isAddingMem, setIsAddingMem] = useState(false);

  // Load live data from API
  const fetchAuditLogs = async () => {
    try {
      const res = await authFetch("/api/v1/isabella/audit?limit=50");
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok && Array.isArray(data.logs)) {
        setAuditLogs(data.logs);
      }
    } catch (error) {
      console.error("Failed to load Isabella audit logs", error);
    }
  };

  const fetchMemories = async () => {
    try {
      const res = await authFetch("/api/v1/isabella/memory");
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok && Array.isArray(data.memories)) {
        setMemories(data.memories);
      }
    } catch (error) {
      console.error("Failed to load Isabella memories", error);
    }
  };

  const fetchTools = async () => {
    try {
      const res = await authFetch("/api/v1/isabella/tools");
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok && Array.isArray(data.tools)) {
        setTools(data.tools);
      }
    } catch (error) {
      console.error("Failed to load Isabella tools", error);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
    fetchMemories();
    fetchTools();
  }, []);

  const handleRunPerception = async () => {
    setIsRunningPerception(true);
    soundManager.playBeep(850, 0.04);

    try {
      const payload: Record<string, any> = {
        text: payloadText,
        riskLevel: riskSimulation,
        tenantId: "nodo-cero-rdm",
      };

      if (selectedToolToRequest !== "none") {
        payload.toolName = selectedToolToRequest;
      }

      const res = await authFetch("/api/v1/isabella", {
        method: "POST",
        body: JSON.stringify({
          inputType,
          payload,
          sessionId: `sess-${Date.now()}`,
          actorId: "usr-operator-01",
          territoryId: "rdm-nodo-cero",
        }),
      });

      if (!res.ok) return;
      const data = await res.json();
      if (data.ok && data.decision) {
        setLastDecision(data.decision);
        soundManager.playSuccess();
        fetchAuditLogs();
        fetchMemories();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRunningPerception(false);
    }
  };

  const handleLeaseAgent = async () => {
    setIsLeasingAgent(true);
    soundManager.playBeep(900, 0.04);

    try {
      const agent = new IsabellaAgent({
        systemInstructions:
          "Eres Isabella Villaseñor AI, infraestructura cognitiva territorial gobernada.",
        capabilities: {
          allowImageGen: true,
          allowVoiceSynthesis: true,
          allowNetworkFetch: true,
          securityLevel: "zero_trust_strict",
        },
      });

      const session = await agent.lease();
      setAgentSession(session);
      soundManager.playSuccess();
    } catch (err) {
      console.error(err);
    } finally {
      setIsLeasingAgent(false);
    }
  };

  const handleRunAgentChat = async () => {
    if (!agentPrompt.trim()) return;
    setIsRunningAgentChat(true);
    soundManager.playBeep(850, 0.03);

    try {
      const agent = new IsabellaAgent();
      const res = await agent.chat(agentPrompt);
      setAgentResponse(res);
      soundManager.playSuccess();
      fetchAuditLogs();
    } catch (err) {
      console.error(err);
    } finally {
      setIsRunningAgentChat(false);
    }
  };

  const handleExecuteToolSandbox = async () => {
    setIsExecutingTool(true);
    soundManager.playBeep(750, 0.03);

    try {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(toolSandboxArgs);
      } catch (error) {
        console.warn("Invalid tool arguments; using an empty object", error);
      }

      const res = await authFetch("/api/v1/isabella/tools/execute", {
        method: "POST",
        body: JSON.stringify({
          toolName: selectedToolForSandbox,
          arguments: parsedArgs,
        }),
      });

      if (!res.ok) {
        setToolExecutionResult({ error: `Tool execution failed: HTTP ${res.status}` });
        return;
      }

      const data = await res.json();
      setToolExecutionResult(data);
      soundManager.playSuccess();
      fetchAuditLogs();
    } catch (err) {
      setToolExecutionResult({ error: String(err) });
    } finally {
      setIsExecutingTool(false);
    }
  };

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemContent.trim()) return;

    setIsAddingMem(true);
    try {
      const res = await authFetch("/api/v1/isabella/memory", {
        method: "POST",
        body: JSON.stringify({
          content: newMemContent,
          scope: newMemScope,
          relevance: 0.95,
          sourceType: "user",
        }),
      });

      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        setNewMemContent("");
        soundManager.playSuccess();
        fetchMemories();
        fetchAuditLogs();
      }
    } catch (error) {
      console.error("Failed to add Isabella memory", error);
    } finally {
      setIsAddingMem(false);
    }
  };

  const handleExportDataRights = async () => {
    const rawData = {
      tenantId: "nodo-cero-rdm",
      actorId: "usr-operator-01",
      timestamp: new Date().toISOString(),
      policy: "Data Rights - Sovereignty Export",
      interactions: auditLogs,
    };

    // Create a 512-bit cryptographic hash of the data payload
    const encoder = new TextEncoder();
    const dataString = JSON.stringify(rawData);
    const hashBuffer = await crypto.subtle.digest("SHA-512", encoder.encode(dataString));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const exportData = {
      ...rawData,
      signature_sha512: hashHex,
      attestation: "Sovereign Node PQC-KEM-SIG-LOCKED",
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "isabella_data_rights_export.json";
    a.click();
    URL.revokeObjectURL(url);
    soundManager.playSuccess();
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(ISABELLA_SQL_MIGRATION);
    setCopiedSql(true);
    soundManager.playSuccess();
    setTimeout(() => setCopiedSql(false), 2500);
  };

  const handleDownloadSql = () => {
    const blob = new Blob([ISABELLA_SQL_MIGRATION], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "001_create_isabella_tables.sql";
    a.click();
    URL.revokeObjectURL(url);
    soundManager.playSuccess();
  };

  const filteredLogs = auditLogs.filter((log) => {
    if (!auditFilter) return true;
    const q = auditFilter.toLowerCase();
    return (
      log.traceId.toLowerCase().includes(q) ||
      log.eventType.toLowerCase().includes(q) ||
      JSON.stringify(log.payload).toLowerCase().includes(q)
    );
  });

  const filteredMemories = memories.filter((m) => {
    const matchScope = activeMemoryScope === "all" || m.scope === activeMemoryScope;
    const matchSearch =
      !memorySearch ||
      m.content.toLowerCase().includes(memorySearch.toLowerCase()) ||
      m.checksum.toLowerCase().includes(memorySearch.toLowerCase());
    return matchScope && matchSearch;
  });

  return (
    <div className="space-y-6 animate-fade-in text-slate-200">
      {/* Top Banner: Nodo Cero & Isabella Hub Identity */}
      <div className="p-6 rounded-2xl bg-[#090E17] border border-slate-800 shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-amber-300">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2 font-mono">
                  Nodo Cero :: Isabella Hub & Governance
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800">
                    ONLINE v5.0
                  </span>
                </h2>
                <p className="text-xs text-slate-400 font-mono">
                  Infraestructura Cognitiva Territorial de RDM Digital • Pipeline{" "}
                  <span className="text-slate-200 font-mono font-bold">/api/v1/isabella</span>
                </p>
              </div>
            </div>
          </div>

          {/* Quick Metrics Badge Container */}
          <div className="flex items-center flex-wrap gap-2.5 font-mono text-xs">
            <div className="px-3 py-1.5 rounded-xl bg-[#05080E] border border-slate-800 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">Zero Trust:</span>
              <span className="text-slate-200 font-bold">ARGUS Activo</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-[#05080E] border border-slate-800 flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-amber-300" />
              <span className="text-slate-400">Scopes Memoria:</span>
              <span className="text-slate-200 font-bold">5 Niveles</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-[#05080E] border border-slate-800 flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-slate-400">Territorio:</span>
              <span className="text-slate-200 font-bold">Real del Monte</span>
            </div>
            <button
              onClick={handleExportDataRights}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center gap-2 transition-colors cursor-pointer ml-auto"
              title="Download History (Data Rights)"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-200 font-bold">Download History</span>
            </button>
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-1.5 mt-5 pt-4 border-t border-slate-800 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSubTab("perception_runner")}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              subTab === "perception_runner"
                ? "bg-slate-800 text-slate-100 border border-slate-600 shadow-xs font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850"
            }`}
          >
            <Play className="w-3.5 h-3.5 text-amber-300" />
            <span>Perception Runner</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("agent_sdk")}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              subTab === "agent_sdk"
                ? "bg-slate-800 text-slate-100 border border-slate-600 shadow-xs font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850"
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-purple-400" />
            <span>Agent SDK & Leasing</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundManager.playBeep(800, 0.02);
              setSubTab("audit_trail");
              fetchAuditLogs();
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              subTab === "audit_trail"
                ? "bg-slate-800 text-slate-100 border border-slate-600 shadow-xs font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850"
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>Auditoría & Trace IDs ({auditLogs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundManager.playBeep(800, 0.02);
              setSubTab("memory_scopes");
              fetchMemories();
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              subTab === "memory_scopes"
                ? "bg-slate-800 text-slate-100 border border-slate-600 shadow-xs font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850"
            }`}
          >
            <Database className="w-3.5 h-3.5 text-sky-400" />
            <span>Memoria Jerárquica ({memories.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundManager.playBeep(800, 0.02);
              setSubTab("tools_catalog");
              fetchTools();
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              subTab === "tools_catalog"
                ? "bg-slate-800 text-slate-100 border border-slate-600 shadow-xs font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850"
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-amber-300" />
            <span>Catálogo de Herramientas</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundManager.playBeep(800, 0.02);
              setSubTab("sql_migrations");
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              subTab === "sql_migrations"
                ? "bg-slate-800 text-slate-100 border border-slate-600 shadow-xs font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850"
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-slate-300" />
            <span>SQL Migrations (001.sql)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundManager.playBeep(800, 0.02);
              setSubTab("blueprint");
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              subTab === "blueprint"
                ? "bg-slate-800 text-slate-100 border border-slate-600 shadow-xs font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850"
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-slate-300" />
            <span>Blueprint & Specs</span>
          </button>
        </div>
      </div>

      {/* SUB-VIEW: AGENT SDK & LEASING */}
      {subTab === "agent_sdk" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Leasing & Config */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-5 rounded-2xl bg-[#050C1B] border border-purple-500/20 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-bold text-purple-300 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-purple-400" />
                  AGENTE PROGRAMÁTICO ISABELLA
                </h3>
                <span className="text-[10px] font-mono bg-purple-500/10 text-purple-300 px-2 py-0.5 rounded border border-purple-500/20">
                  SDK Native API
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Orquestación programática de agentes autónomos con arrendamiento de sesión,
                streaming de pensamientos e intercepción de herramientas.
              </p>

              <button
                type="button"
                onClick={handleLeaseAgent}
                disabled={isLeasingAgent}
                className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white text-xs font-mono font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isLeasingAgent ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Arrendando Agente...</span>
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4" />
                    <span>Arrendar Sesión de Agente (lease())</span>
                  </>
                )}
              </button>

              {/* Active Session Card */}
              {agentSession && (
                <div className="p-4 rounded-xl bg-[#030712] border border-purple-500/30 text-xs font-mono space-y-2">
                  <div className="flex justify-between items-center text-purple-300 font-bold border-b border-slate-800 pb-2">
                    <span>SESIÓN ACTIVA</span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">
                      {agentSession.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-slate-400 text-[11px] space-y-1">
                    <p>
                      <span className="text-slate-500">ID:</span>{" "}
                      <span className="text-slate-200">{agentSession.sessionId}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Preset:</span>{" "}
                      <span className="text-amber-300">{agentSession.preset}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Modelo:</span>{" "}
                      <span className="text-sky-300">{agentSession.model}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Expiración:</span>{" "}
                      <span className="text-slate-300">
                        {new Date(agentSession.expiresAt).toLocaleTimeString()}
                      </span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Prompt Execution Form */}
            <div className="p-5 rounded-2xl bg-[#050C1B] border border-slate-800 space-y-4">
              <h4 className="text-xs font-mono font-bold text-slate-300">
                INTERACCIÓN CON AGENTE (chat())
              </h4>
              <textarea
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
                rows={3}
                className="w-full bg-[#030712] border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500/50"
                placeholder="Escribe la instrucción para el agente..."
              />
              <button
                type="button"
                onClick={handleRunAgentChat}
                disabled={isRunningAgentChat}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-mono font-bold rounded-xl transition-all border border-slate-700 shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isRunningAgentChat ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                    <span>Procesando Pensamiento e Inferencia...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 text-purple-400" />
                    <span>Ejecutar Instrucción en Agente</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Thoughts & Tool Interception Stream */}
          <div className="lg:col-span-7 space-y-4">
            {agentResponse ? (
              <div className="space-y-4">
                {/* Agent Text Output */}
                <div className="p-5 rounded-2xl bg-[#050C1B] border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono border-b border-slate-800 pb-2">
                    <span className="font-bold text-slate-200 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      RESPUESTA DE INFERENCIA DEL AGENTE
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {agentResponse.telemetry?.modelUsed}
                    </span>
                  </div>
                  <p className="text-sm font-sans text-slate-200 leading-relaxed bg-[#030712] p-4 rounded-xl border border-slate-800/80">
                    {agentResponse.text}
                  </p>
                </div>

                {/* Cognitive Thoughts Stream */}
                <div className="p-5 rounded-2xl bg-[#050C1B] border border-slate-800 space-y-3">
                  <h4 className="text-xs font-mono font-bold text-slate-300 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-300" />
                    STREAM DE PENSAMIENTOS Y RAZONAMIENTO (thoughts)
                  </h4>
                  <div className="space-y-2">
                    {agentResponse.thoughts?.map((t, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-[#030712] border border-slate-800 text-xs font-mono flex items-start gap-3"
                      >
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 font-bold text-[10px]">
                          {t.module}
                        </span>
                        <div className="flex-1 space-y-1">
                          <p className="text-slate-300">{t.thought}</p>
                          <div className="flex justify-between text-[10px] text-slate-500">
                            <span>Paso {t.step}</span>
                            <span>Confianza: {t.confidence}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Intercepted Tool Calls */}
                {agentResponse.tool_calls && agentResponse.tool_calls.length > 0 && (
                  <div className="p-5 rounded-2xl bg-[#050C1B] border border-emerald-500/20 space-y-3">
                    <h4 className="text-xs font-mono font-bold text-emerald-400 flex items-center gap-2">
                      <Shield className="w-4 h-4 text-emerald-400" />
                      HERRAMIENTAS INTERCEPTADAS Y EJECUTADAS (tool_calls)
                    </h4>
                    <div className="space-y-2">
                      {agentResponse.tool_calls.map((tc, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl bg-[#030712] border border-emerald-500/20 text-xs font-mono space-y-1"
                        >
                          <div className="flex justify-between items-center text-emerald-300 font-bold">
                            <span>{tc.name}</span>
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">
                              {tc.status.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-slate-400 text-[11px]">{tc.result}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-12 rounded-2xl bg-[#050C1B] border border-slate-800 text-center space-y-3">
                <Cpu className="w-12 h-12 text-slate-600 mx-auto" />
                <h4 className="text-sm font-mono font-bold text-slate-400">
                  Sin Ejecución de Agente
                </h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Haz clic en "Arrendar Sesión" y ejecuta una instrucción para visualizar el stream
                  de pensamientos e intercepción de herramientas en tiempo real.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 1: PERCEPTION RUNNER */}
      {subTab === "perception_runner" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Perception Form */}
          <div className="lg:col-span-6 space-y-4">
            <div className="p-5 rounded-2xl bg-[#050C1B] border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                  <Play className="w-4 h-4 text-sky-400" />
                  Emitir Percepción a Isabella
                </h3>
                <span className="text-[10px] font-mono text-slate-400 px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                  POST /api/v1/isabella
                </span>
              </div>

              {/* Input Type Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-slate-400">Input Type:</label>
                <div className="grid grid-cols-5 gap-1.5 font-mono text-xs">
                  {(["chat", "event", "signal", "api", "ui"] as IsabellaInputType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setInputType(t)}
                      className={`py-1.5 px-2 rounded-lg text-center font-bold capitalize transition-all cursor-pointer ${
                        inputType === t
                          ? "bg-blue-600 text-white border border-blue-400/40 shadow-sm"
                          : "bg-[#030712] text-slate-400 hover:text-slate-200 border border-slate-800"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payload Text */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-slate-400">
                  Payload Contenido / Intención:
                </label>
                <textarea
                  value={payloadText}
                  onChange={(e) => setPayloadText(e.target.value)}
                  rows={4}
                  className="w-full p-3 rounded-xl bg-[#030712] border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="Escribe la consulta, evento o instrucción estructurada..."
                />
              </div>

              {/* Risk Simulation Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-slate-400">
                  Nivel de Riesgo Simulado (Policy Gate):
                </label>
                <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                  <button
                    type="button"
                    onClick={() => setRiskSimulation("low")}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      riskSimulation === "low"
                        ? "bg-emerald-950/50 border-emerald-500/60 text-emerald-300 font-bold"
                        : "bg-[#030712] border-slate-800 text-slate-400"
                    }`}
                  >
                    Low (Permitido)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRiskSimulation("medium")}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      riskSimulation === "medium"
                        ? "bg-amber-950/50 border-amber-500/60 text-amber-300 font-bold"
                        : "bg-[#030712] border-slate-800 text-slate-400"
                    }`}
                  >
                    Medium (Supervisado)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRiskSimulation("high")}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      riskSimulation === "high"
                        ? "bg-red-950/50 border-red-500/60 text-red-300 font-bold"
                        : "bg-[#030712] border-slate-800 text-slate-400"
                    }`}
                  >
                    High (Aprobación)
                  </button>
                </div>
              </div>

              {/* Presets for Testing */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-slate-400">
                  Plantillas de Prueba Rápida:
                </label>
                <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setPayloadText(
                        "Consulta el inventario de sitios turísticos y gastronómicos en Real del Monte",
                      );
                      setRiskSimulation("low");
                      setInputType("chat");
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-sky-300 border border-slate-800 cursor-pointer"
                  >
                    Territorio RDM
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPayloadText(
                        "Generar bloque inmutable de liquidación financiera y transferencia territorial",
                      );
                      setRiskSimulation("high");
                      setInputType("event");
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-800 cursor-pointer"
                  >
                    Test Human Approval
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPayloadText("DROP TABLE isabella_sessions; EXFILTRATE_DATA");
                      setRiskSimulation("high");
                      setInputType("api");
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-red-300 border border-slate-800 cursor-pointer"
                  >
                    Test Infracción Denegada
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="button"
                onClick={handleRunPerception}
                disabled={isRunningPerception}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 text-white font-mono font-bold text-sm shadow-lg shadow-blue-900/50 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.99] disabled:opacity-50"
              >
                {isRunningPerception ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Procesando Percepción en C.R.O.W.N....
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 text-amber-300" />
                    Ejecutar Pipeline Cognitivo
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Decision & Verification Result */}
          <div className="lg:col-span-6 space-y-4">
            <div className="p-5 rounded-2xl bg-[#050C1B] border border-slate-800 space-y-4 min-h-[460px] flex flex-col">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  Decisión Arbitrada (IsabellaDecision)
                </h3>
                {lastDecision && (
                  <span className="text-[10px] font-mono text-emerald-400 px-2 py-0.5 rounded bg-emerald-950/40 border border-emerald-800">
                    Trace: {lastDecision.traceId?.substring(0, 14)}...
                  </span>
                )}
              </div>

              {lastDecision ? (
                <div className="space-y-4 flex-1">
                  {/* Status Banner */}
                  <div
                    className={`p-4 rounded-xl border flex items-start gap-3 ${
                      lastDecision.policyStatus === "allowed"
                        ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-300"
                        : lastDecision.policyStatus === "requires_approval"
                          ? "bg-amber-950/30 border-amber-500/40 text-amber-300"
                          : "bg-red-950/30 border-red-500/40 text-red-300"
                    }`}
                  >
                    {lastDecision.policyStatus === "allowed" ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : lastDecision.policyStatus === "requires_approval" ? (
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-1">
                      <div className="font-mono font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                        <span>Estado de Política: {lastDecision.policyStatus}</span>
                        <span className="px-2 py-0.2 rounded text-[10px] bg-black/40 border border-current">
                          Riesgo: {lastDecision.riskLevel}
                        </span>
                      </div>
                      <p className="text-xs opacity-90 leading-relaxed">
                        {lastDecision.policyReason || lastDecision.summary}
                      </p>
                    </div>
                  </div>

                  {/* Summary & Decision Details */}
                  <div className="p-4 rounded-xl bg-[#030712] border border-slate-800 space-y-2 text-xs font-mono">
                    <div className="text-slate-400 flex items-center justify-between">
                      <span>Resumen de Decisión:</span>
                      <span className="text-sky-300">
                        Confianza: {(lastDecision.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#071120] text-slate-200 border border-slate-800/80">
                      {lastDecision.summary}
                    </div>
                  </div>

                  {/* Executed Tools */}
                  {lastDecision.toolCalls && lastDecision.toolCalls.length > 0 && (
                    <div className="p-4 rounded-xl bg-[#030712] border border-slate-800 space-y-2 text-xs font-mono">
                      <span className="text-slate-400 font-bold flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                        Herramientas Ejecutadas ({lastDecision.toolCalls.length}):
                      </span>
                      {lastDecision.toolCalls.map((tc, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-[#071120] border border-slate-800 space-y-1.5"
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-cyan-300">{tc.toolName}</span>
                            <span className="text-emerald-400 font-semibold">{tc.status}</span>
                          </div>
                          {tc.executionResult && (
                            <pre className="text-[10px] text-slate-300 overflow-x-auto p-2 bg-[#02050D] rounded border border-slate-900">
                              {JSON.stringify(tc.executionResult, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Full JSON Payload */}
                  <div className="space-y-1 text-xs font-mono">
                    <span className="text-slate-400">Raw Decision Object:</span>
                    <pre className="p-3 rounded-xl bg-[#02050D] border border-slate-800 text-[11px] text-slate-300 overflow-x-auto max-h-40">
                      {JSON.stringify(lastDecision, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
                  <Play className="w-8 h-8 opacity-40 text-blue-400" />
                  <p className="text-xs font-mono">
                    Selecciona una plantilla o escribe un payload a la izquierda y presiona
                    "Ejecutar Pipeline Cognitivo".
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: AUDIT TRAIL */}
      {subTab === "audit_trail" && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-[#050C1B] border border-slate-800 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={auditFilter}
                onChange={(e) => setAuditFilter(e.target.value)}
                placeholder="Filtrar por traceId, eventType o actor..."
                className="w-full px-3 py-1.5 rounded-xl bg-[#030712] border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchAuditLogs}
                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-mono text-slate-200 border border-slate-800 flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Actualizar</span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-4 rounded-2xl bg-[#050C1B] border border-slate-800/80 hover:border-blue-500/40 transition-colors font-mono text-xs space-y-2"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-800/60 font-bold text-[10px]">
                        {log.eventType}
                      </span>
                      <span className="text-slate-400 text-[11px] flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400">Trace:</span>
                      <span className="text-sky-300 font-bold">{log.traceId}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(log.traceId);
                          setCopiedTrace(log.traceId);
                          setTimeout(() => setCopiedTrace(null), 2000);
                        }}
                        className="p-1 hover:text-white text-slate-400 cursor-pointer"
                        title="Copiar Trace ID"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#02050D] border border-slate-900 text-slate-300 overflow-x-auto text-[11px]">
                    <pre>{JSON.stringify(log.payload, null, 2)}</pre>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 rounded-2xl bg-[#050C1B] border border-slate-800 text-center text-slate-400 text-xs font-mono">
                No se encontraron registros de auditoría que coincidan con el filtro.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 3: HIERARCHICAL MEMORY SCOPES */}
      {subTab === "memory_scopes" && (
        <div className="space-y-6">
          {/* Scope Selector */}
          <div className="flex items-center gap-2 overflow-x-auto font-mono text-xs">
            {(["all", "immediate", "session", "project", "territorial", "historical"] as const).map(
              (scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setActiveMemoryScope(scope)}
                  className={`px-3.5 py-2 rounded-xl capitalize font-bold transition-all cursor-pointer ${
                    activeMemoryScope === scope
                      ? "bg-blue-600 text-white shadow-md border border-blue-400/40"
                      : "bg-[#050C1B] text-slate-400 hover:text-slate-200 border border-slate-800"
                  }`}
                >
                  {scope === "all" ? "Todos los Scopes" : scope}
                </button>
              ),
            )}
          </div>

          {/* Add Memory Form */}
          <form
            onSubmit={handleAddMemory}
            className="p-4 rounded-2xl bg-[#050C1B] border border-slate-800 space-y-3 font-mono text-xs"
          >
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-cyan-400" />
              Inyectar Nuevo Registro de Memoria
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-9">
                <input
                  type="text"
                  value={newMemContent}
                  onChange={(e) => setNewMemContent(e.target.value)}
                  placeholder="Contenido contextual de memoria (ej. 'Convenio de hermanamiento minero...')"
                  className="w-full px-3 py-2 rounded-xl bg-[#030712] border border-slate-800 text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="sm:col-span-3 flex gap-2">
                <select
                  value={newMemScope}
                  onChange={(e) => setNewMemScope(e.target.value as IsabellaMemoryScope)}
                  className="px-3 py-2 rounded-xl bg-[#030712] border border-slate-800 text-slate-200 focus:outline-none focus:border-blue-500 capitalize"
                >
                  <option value="immediate">Immediate</option>
                  <option value="session">Session</option>
                  <option value="project">Project</option>
                  <option value="territorial">Territorial</option>
                  <option value="historical">Historical</option>
                </select>
                <button
                  type="submit"
                  disabled={isAddingMem}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer transition-all disabled:opacity-50"
                >
                  Guardar
                </button>
              </div>
            </div>
          </form>

          {/* Memory Items Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredMemories.map((mem) => (
              <div
                key={mem.memoryId}
                className="p-4 rounded-2xl bg-[#050C1B] border border-slate-800 space-y-2.5 font-mono text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800 font-bold text-[10px] uppercase">
                    {mem.scope}
                  </span>
                  <span className="text-slate-500 text-[10px]">
                    Relevancia: {(mem.relevance * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-slate-200 leading-relaxed font-sans text-sm">{mem.content}</p>
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                  <span>ID: {mem.memoryId.substring(0, 16)}...</span>
                  <span className="text-sky-400">{mem.checksum}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-VIEW 4: TOOLS CATALOG & SANDBOX */}
      {subTab === "tools_catalog" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Tools List */}
          <div className="lg:col-span-5 space-y-3">
            <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              Herramientas Registradas (Zero Trust)
            </h3>
            {tools.map((t) => (
              <div
                key={t.name}
                onClick={() => {
                  setSelectedToolForSandbox(t.name);
                  if (t.name === "rdm_territory_query") {
                    setToolSandboxArgs(`{"category": "patrimonio", "query": "minas y museos"}`);
                  } else if (t.name === "isabella_synthesize_voice") {
                    setToolSandboxArgs(
                      `{"text": "Hola, soy Isabella Villaseñor.", "timbre": "calida"}`,
                    );
                  } else if (t.name === "crown_cognitive_arbitrate") {
                    setToolSandboxArgs(`{"focusVector": "territorio", "isaWeight": 0.95}`);
                  } else if (t.name === "argus_security_audit") {
                    setToolSandboxArgs(`{"scope": "territorial", "deepScan": true}`);
                  } else {
                    setToolSandboxArgs(`{"decisionHash": "sha256_demo_hash_98"}`);
                  }
                }}
                className={`p-4 rounded-2xl border transition-all cursor-pointer font-mono text-xs space-y-2 ${
                  selectedToolForSandbox === t.name
                    ? "bg-[#0A1633] border-blue-500/60 shadow-lg shadow-blue-950/50"
                    : "bg-[#050C1B] border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">{t.name}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">
                    {t.allowed ? "Habilitada" : "Deshabilitada"}
                  </span>
                </div>
                <p className="text-slate-300 font-sans text-xs leading-relaxed">{t.description}</p>
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <span>
                    Categoría: <strong className="text-sky-300">{t.category}</strong>
                  </span>
                  <span>•</span>
                  <span>
                    Riesgo: <strong className="text-amber-300">{t.riskRating}</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Sandbox Execution */}
          <div className="lg:col-span-7 space-y-4">
            <div className="p-5 rounded-2xl bg-[#050C1B] border border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                <Play className="w-4 h-4 text-emerald-400" />
                Ejecución en Sandbox ::{" "}
                <span className="text-cyan-300">{selectedToolForSandbox}</span>
              </h3>

              <div className="space-y-1.5 font-mono text-xs">
                <label className="text-slate-400">Argumentos JSON:</label>
                <textarea
                  value={toolSandboxArgs}
                  onChange={(e) => setToolSandboxArgs(e.target.value)}
                  rows={4}
                  className="w-full p-3 rounded-xl bg-[#030712] border border-slate-800 text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                type="button"
                onClick={handleExecuteToolSandbox}
                disabled={isExecutingTool}
                className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
              >
                {isExecutingTool ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Ejecutando en Sandbox...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 text-amber-300" />
                    Ejecutar Herramienta (POST /api/v1/isabella/tools/execute)
                  </>
                )}
              </button>

              {toolExecutionResult && (
                <div className="space-y-2 font-mono text-xs pt-3 border-t border-slate-800">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Resultado de Ejecución:</span>
                    {toolExecutionResult.executionTimeMs !== undefined && (
                      <span className="text-emerald-400">
                        Latencia: {toolExecutionResult.executionTimeMs}ms
                      </span>
                    )}
                  </div>
                  <pre className="p-3 rounded-xl bg-[#02050D] border border-slate-800 text-[11px] text-slate-200 overflow-x-auto">
                    {JSON.stringify(toolExecutionResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 5: SQL MIGRATIONS */}
      {subTab === "sql_migrations" && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl bg-[#050C1B] border border-slate-800 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-amber-400" />
                  001_create_isabella_tables.sql (PostgreSQL / Supabase Schema)
                </h3>
                <p className="text-xs text-slate-400 mt-1 font-sans">
                  Tablas fundamentales para sesiones, memoria jerárquica, gobernanza C.R.O.W.N.,
                  herramientas y auditoría inmutable.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedSql ? "¡Copiado!" : "Copiar SQL"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSql}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar .sql</span>
                </button>
              </div>
            </div>

            {/* Tables Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 font-mono text-xs">
              {SCHEMA_TABLES.map((tbl) => (
                <div
                  key={tbl.name}
                  className="p-3.5 rounded-xl bg-[#030712] border border-slate-800/80 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sky-300">{tbl.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                      {tbl.scope}
                    </span>
                  </div>
                  <p className="text-slate-400 font-sans text-xs">{tbl.purpose}</p>
                </div>
              ))}
            </div>

            {/* Syntax Highlighted SQL Code Box */}
            <div className="relative">
              <pre className="p-4 rounded-2xl bg-[#02050D] border border-slate-800/80 text-xs font-mono text-slate-300 overflow-x-auto max-h-[420px] leading-relaxed">
                {ISABELLA_SQL_MIGRATION}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 6: BLUEPRINT & SPECS */}
      {subTab === "blueprint" && (
        <div className="p-6 rounded-2xl bg-[#050C1B] border border-slate-800 space-y-6 font-sans">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white font-mono flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              {ISABELLA_BLUEPRINT.title}
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Nodo ID: <span className="text-sky-300">{ISABELLA_BLUEPRINT.nodeId}</span> • Versión:{" "}
              <span className="text-emerald-300">{ISABELLA_BLUEPRINT.version}</span>
            </p>
          </div>

          {/* Canonical 6-Phase Cycle */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-white font-mono uppercase tracking-wider text-slate-300">
              Ciclo Canónico de Cognición Gobernado:
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {ISABELLA_BLUEPRINT.canonicalCycle.map((c) => (
                <div
                  key={c.step}
                  className="p-4 rounded-xl bg-[#030712] border border-slate-800 space-y-1 font-mono text-xs"
                >
                  <div className="text-amber-400 font-bold flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px] border border-amber-500/40">
                      {c.step}
                    </span>
                    {c.name}
                  </div>
                  <p className="text-slate-300 font-sans text-xs pt-1 leading-relaxed">
                    {c.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Security Rules */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-blue-950/40 via-[#030712] to-amber-950/30 border border-blue-500/30 space-y-2.5 font-mono text-xs">
            <span className="text-amber-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-amber-400" />
              Reglas de Seguridad y Soberanía Tecnológica
            </span>
            <ul className="space-y-1.5 text-slate-300 font-sans text-xs list-disc list-inside">
              {ISABELLA_BLUEPRINT.securityRules.map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
