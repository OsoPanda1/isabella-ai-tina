import React from "react";
import { IsabellaLedgerConsole } from "../Ledger/IsabellaLedgerConsole";
import { AuthManager } from "./AuthManager";
import { Lock } from "lucide-react";

export const AdminPanelView: React.FC = () => {
  return (
    <div className="flex flex-col h-[calc(100vh-145px)] min-h-[580px] max-h-[900px] rounded-3xl border border-slate-700/50 bg-[#02040A] shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden relative font-sans text-slate-200">
      <header className="px-7 py-5 border-b border-slate-800/80 bg-[#050810]/95 backdrop-blur-xl relative z-10 flex items-center gap-4">
        <div className="p-2.5 bg-red-900/30 rounded-xl border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
          <Lock className="w-6 h-6 text-red-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#F8FAFC]">
            Administrative Nexus
          </h2>
          <p className="text-[11px] font-mono text-red-400/80 tracking-wider uppercase mt-1">
            Gobernanza • Auditoría • Autenticación
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-7 custom-scrollbar grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10">
        <div className="space-y-6">
          <AuthManager />
        </div>
        <div className="space-y-6">
          <IsabellaLedgerConsole />
        </div>
      </div>
    </div>
  );
};
