import React from "react";
import { ShieldCheck, Lock, CheckCircle } from "lucide-react";
import { useCrown } from "../../context/CrownContext";

export const CrownGovernanceCard: React.FC = () => {
  const { state } = useCrown();
  const { securityGovernance, inferenceMode } = state;

  return (
    <div className="p-4 rounded-xl border border-slate-800/60 bg-[#030712] relative overflow-hidden flex flex-col justify-between">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="text-xs font-bold font-mono text-slate-400 flex items-center gap-2 uppercase tracking-wider">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Gobernanza C.R.O.W.N.
          </h4>
          <p className="text-[10px] text-slate-500 font-mono mt-1">
            Supervisión Zero-Trust & ARGUS Sentinel
          </p>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
          L4 Active
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-slate-400">Puntaje Integridad:</span>
          <span className="text-emerald-400 font-bold">
            {(securityGovernance.integrityPercent * 100).toFixed(1)}%
          </span>
        </div>

        <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-800">
          <div
            className="bg-emerald-400 h-full transition-all duration-500"
            style={{ width: `${securityGovernance.integrityPercent * 100}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[10px]">
          <div className="p-2 rounded bg-slate-900/60 border border-slate-800/80">
            <span className="text-slate-500 block">Modo Inferencia</span>
            <span className="text-slate-200 font-bold flex items-center gap-1 mt-0.5">
              <Lock className="w-3 h-3 text-amber-400" />
              {inferenceMode === "local_sovereign" ? "Nodo Cero" : "Cloud Fed."}
            </span>
          </div>

          <div className="p-2 rounded bg-slate-900/60 border border-slate-800/80">
            <span className="text-slate-500 block">Veto ARGUS</span>
            <span className="text-emerald-400 font-bold flex items-center gap-1 mt-0.5">
              <CheckCircle className="w-3 h-3 text-emerald-400" />
              Sin Riesgo
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[9px] font-mono text-slate-500">
        <span>Firma: SHA-256 EOCT</span>
        <span className="text-slate-400">v5.0 Sovereign</span>
      </div>
    </div>
  );
};
