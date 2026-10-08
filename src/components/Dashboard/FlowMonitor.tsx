import React, { useEffect, useState } from "react";
import {
  Activity,
  Server,
  Zap,
  Database,
  Lock,
  Cpu,
  Globe,
  CheckCircle2,
  Shield,
  FileText,
} from "lucide-react";
import "motion/react";

const HERMES_MODULES = [
  { id: 1, name: "Orchestrator", icon: <Cpu />, status: "active", tier: 1 },
  { id: 2, name: "Prompt Builder", icon: <FileText />, status: "active", tier: 1 },
  { id: 3, name: "Context & Memory", icon: <Database />, status: "active", tier: 1 },
  { id: 4, name: "Task Planner", icon: <Activity />, status: "active", tier: 2 },
  { id: 5, name: "Skills Engine", icon: <Zap />, status: "degraded", tier: 2 },
  { id: 6, name: "Provenance", icon: <CheckCircle2 />, status: "active", tier: 2 },
  { id: 7, name: "Tools Sandbox", icon: <Server />, status: "active", tier: 3 },
  { id: 8, name: "API Gateway", icon: <Globe />, status: "active", tier: 3 },
  { id: 9, name: "Consent", icon: <Lock />, status: "active", tier: 3 },
  { id: 10, name: "Safety & Risk", icon: <Shield />, status: "active", tier: 4 },
  { id: 11, name: "Data Rights", icon: <Lock />, status: "active", tier: 4 },
  { id: 12, name: "Audit Trail", icon: <Database />, status: "active", tier: 4 },
];

export const FlowMonitor: React.FC = () => {
  const [activeNodes, setActiveNodes] = useState<number[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const numNodes = Math.floor(Math.random() * 4) + 1;
      const nodes = [];
      for (let i = 0; i < numNodes; i++) {
        nodes.push(Math.floor(Math.random() * 12) + 1);
      }
      setActiveNodes(nodes);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const tiers = [1, 2, 3, 4];

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-slate-800 bg-[#070F1E]/80 p-6 backdrop-blur-xl shadow-2xl overflow-hidden relative">
      <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-4">
        <div>
          <h3 className="text-slate-200 font-bold text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            Hermes Core Modules Flow
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Real-time status for the 12 core cognitive modules
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span> Active Flow
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span> Degraded
          </span>
        </div>
      </div>

      <div className="relative overflow-x-auto custom-scrollbar pb-4">
        <div className="min-w-[800px] flex items-stretch justify-between gap-2 px-2">
          {tiers.map((tier, tIdx) => {
            const modsInTier = HERMES_MODULES.filter((m) => m.tier === tier);
            const isTierProcessing = modsInTier.some((m) => activeNodes.includes(m.id));

            return (
              <React.Fragment key={tier}>
                {/* Column of modules */}
                <div className="flex flex-col gap-3 justify-center w-44 shrink-0">
                  <div className="text-center mb-2">
                    <span className="text-[10px] font-bold font-mono text-slate-400">
                      TIER {tier}
                    </span>
                  </div>
                  {modsInTier.map((mod) => {
                    const isProcessing = activeNodes.includes(mod.id);
                    const isDegraded = mod.status === "degraded";

                    return (
                      <div
                        key={mod.id}
                        className={`flex items-center gap-3 p-3 rounded-2xl border transition-all duration-300 ${
                          isDegraded
                            ? "bg-amber-950/20 border-amber-900/50"
                            : isProcessing
                              ? "bg-blue-900/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)] scale-[1.02]"
                              : "bg-[#030712] border-slate-800"
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isDegraded
                              ? "bg-amber-900/30 text-amber-400"
                              : isProcessing
                                ? "bg-blue-500/20 text-blue-400"
                                : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {React.isValidElement(mod.icon) ? (
                            React.cloneElement(mod.icon as React.ReactElement<any>, {
                              className: "w-4 h-4",
                            })
                          ) : (
                            <div className="w-4 h-4">{mod.icon}</div>
                          )}
                        </div>
                        <div className="text-left">
                          <div className="text-[9px] uppercase font-mono text-slate-500 mb-0.5">
                            MOD {mod.id.toString().padStart(2, "0")}
                          </div>
                          <div
                            className={`text-[11px] font-bold leading-tight ${isProcessing && !isDegraded ? "text-blue-300" : "text-slate-300"}`}
                          >
                            {mod.name}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Connector between tiers */}
                {tIdx < tiers.length - 1 && (
                  <div className="flex-1 flex flex-col items-center justify-center px-2">
                    <div
                      className={`h-1 w-full rounded-full transition-all duration-500 ${
                        isTierProcessing
                          ? "bg-gradient-to-r from-blue-500/50 via-cyan-400 to-blue-500/50 shadow-[0_0_10px_rgba(34,211,238,0.5)]"
                          : "bg-slate-800"
                      }`}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
