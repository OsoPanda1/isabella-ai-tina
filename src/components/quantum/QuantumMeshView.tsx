import React, { useState } from "react";
import {
  Cpu,
  Network,
  Activity,
  AlertTriangle,
  Shield,
  CheckCircle2,
  Lock,
  FileCode2,
} from "lucide-react";
import "motion/react";

export const QuantumMeshView: React.FC = () => {
  const [labMode] = useState<boolean>(true); // Forced true for simulation visibility

  return (
    <div className="flex flex-col h-[calc(100vh-145px)] min-h-[580px] max-h-[900px] rounded-3xl border border-blue-900/50 bg-[#02040A] shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden relative font-sans text-slate-200">
      {/* Dynamic Background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute top-0 right-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />

      {/* Header */}
      <header className="px-7 py-5 border-b border-blue-900/50 bg-[#050810]/95 backdrop-blur-xl relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-blue-900/30 rounded-xl border border-blue-500/30 shadow-[0_0_15px_rgba(58,134,255,0.2)]">
            <Network className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-[#F8FAFC]">
              Quantum Mesh Bridge
            </h2>
            <p className="text-[11px] font-mono text-blue-400/80 tracking-wider uppercase mt-1">
              PennyLane Orchestration • 13 Devices • 7 Federations
            </p>
          </div>
        </div>

        {labMode && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-900/30 border border-amber-500/50 rounded-lg text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
            <AlertTriangle className="w-4 h-4 animate-pulse" />
            <span className="text-xs font-bold tracking-wider">FEATURE_LAB_MODE=TRUE</span>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-7 relative z-10 custom-scrollbar">
        {/* Epistemic Honesty Banner */}
        <div className="mb-6 bg-slate-900/60 border border-slate-700 p-4 rounded-xl flex items-start gap-3">
          <Shield className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold text-slate-200 mb-1">
              Epistemic Honesty Protocol Enforced
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Capabilities labelled as PQC (ML-KEM-768, ML-DSA-87, SLH-DSA) are operating in{" "}
              <span className="text-amber-400 font-bold bg-amber-400/10 px-1 rounded">
                SIMULATED
              </span>{" "}
              mode. Isabella AI strictly adheres to the ADRs prohibiting marketing claims without
              real hardware attestation. Honesty over hype.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Federations & Devices */}
          <div className="lg:col-span-2 space-y-6">
            <h3 className="text-lg font-medium text-slate-200 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-blue-400" />
              Active Quantum Federations
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  name: "Security & Identity",
                  role: "ARGUS/HMAC, RBAC, isolation",
                  status: "Active",
                  devices: 3,
                  icon: Shield,
                },
                {
                  name: "Governance & Policy",
                  role: "SLA, circuit costing, quotas",
                  status: "Active",
                  devices: 2,
                  icon: FileCode2,
                },
                {
                  name: "Adapter & Device Mesh",
                  role: "Multi-vendor plugin discovery",
                  status: "Active",
                  devices: 2,
                  icon: Network,
                },
                {
                  name: "Telemetry & Observability",
                  role: "Spans / latency tracking",
                  status: "Active",
                  devices: 2,
                  icon: Activity,
                },
                {
                  name: "Resilience & Fallback",
                  role: "Degradation, classic estimators",
                  status: "Active",
                  devices: 1,
                  icon: AlertTriangle,
                },
                {
                  name: "Storage & State",
                  role: "Canonical hashing, cache",
                  status: "Active",
                  devices: 1,
                  icon: Lock,
                },
                {
                  name: "Quantum Engine",
                  role: "Synthesis, execution, error mitigation",
                  status: "Simulated",
                  devices: 2,
                  icon: Cpu,
                },
              ].map((fed, i) => (
                <div
                  key={i}
                  className="bg-[#0A192F]/40 p-4 rounded-xl border border-slate-800 hover:border-blue-500/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <fed.icon className="w-4 h-4 text-blue-400" />
                      <h4 className="text-sm font-semibold text-slate-200">{fed.name}</h4>
                    </div>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded ${fed.status === "Active" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}
                    >
                      {fed.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mb-3">{fed.role}</p>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    {fed.devices} PennyLane Devices Allocated
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Telemetry Panel */}
          <div className="space-y-6">
            <div className="bg-gradient-to-b from-[#0A192F] to-[#02040A] p-5 rounded-2xl border border-blue-900/50 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl" />
              <h3 className="text-sm font-bold text-slate-200 mb-4">PennyLane Bridge Status</h3>

              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-xs text-slate-400">Total Devices</span>
                  <span className="text-sm font-mono text-white">13</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-xs text-slate-400">Circuit Executions</span>
                  <span className="text-sm font-mono text-white">4,291</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-xs text-slate-400">Avg Q-Latency</span>
                  <span className="text-sm font-mono text-white">14.2ms</span>
                </div>
                <div className="flex justify-between items-center pb-2">
                  <span className="text-xs text-slate-400">Fallback Rate</span>
                  <span className="text-sm font-mono text-emerald-400">0.05%</span>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800">
                <h4 className="text-xs font-medium text-slate-400 mb-3 uppercase tracking-wider">
                  PQC Algorithms
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-800">
                    <span className="text-xs font-mono text-slate-300">ML-KEM-768</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-800">
                    <span className="text-xs font-mono text-slate-300">ML-DSA-87</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-800">
                    <span className="text-xs font-mono text-slate-300">SLH-DSA</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
