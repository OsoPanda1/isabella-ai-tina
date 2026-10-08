import React from "react";
import { Shield, CheckCircle2, Lock, Radio, X, Cpu } from "lucide-react";
import { useCrown } from "../../context/CrownContext";
import { soundManager } from "../../utils/soundEffects";
import { territoryContextService } from "../../services/territoryContextService";

export const SecurityGovernanceModal: React.FC = () => {
  const { state, isSecurityModalOpen, closeSecurityModal, toggleInferenceMode } = useCrown();
  const { securityGovernance, inferenceMode } = state;
  const snapshot = territoryContextService.getSnapshot();

  if (!isSecurityModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#080D16] border border-slate-700/80 shadow-2xl p-6 space-y-6 text-slate-200 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-amber-300">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 font-mono tracking-tight flex items-center gap-2">
                Gobernanza C.R.O.W.N. & Zero-Trust
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800">
                  {securityGovernance.levelName}
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Protocolo de Soberanía Digital y Salvaguarda de Consciencia · Nodo Cero
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              soundManager.playBeep(600, 0.02);
              closeSecurityModal();
            }}
            className="p-2 rounded-xl bg-slate-900 text-slate-400 hover:text-slate-100 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Security Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
          <div className="p-3.5 rounded-xl bg-[#05080E] border border-slate-800 space-y-1">
            <span className="text-slate-500 text-[10px] uppercase font-bold">
              Integridad de Sesión
            </span>
            <div className="text-lg font-bold text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>{securityGovernance.integrityPercent}%</span>
            </div>
            <span className="text-[10px] text-slate-400">Zero-Trust Evaluado</span>
          </div>

          <div className="p-3.5 rounded-xl bg-[#05080E] border border-slate-800 space-y-1">
            <span className="text-slate-500 text-[10px] uppercase font-bold">
              Límite Territorial
            </span>
            <div className="text-base font-bold text-slate-200 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-amber-400" />
              <span>
                {inferenceMode === "local_sovereign" ? "Estricto Local" : "Federado Seguro"}
              </span>
            </div>
            <span className="text-[10px] text-slate-400">Enclave ND-RDM-001</span>
          </div>

          <div className="p-3.5 rounded-xl bg-[#05080E] border border-slate-800 space-y-1">
            <span className="text-slate-500 text-[10px] uppercase font-bold">Centinela ARGUS</span>
            <div className="text-base font-bold text-sky-400 flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-sky-400" />
              <span>Activo 100%</span>
            </div>
            <span className="text-[10px] text-slate-400">Sin Exfiltración</span>
          </div>
        </div>

        {/* Sovereign Mode Switcher inside Modal */}
        <div className="p-4 rounded-xl bg-[#05080E] border border-slate-800 space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-200 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              Modo de Inferencia y Soberanía:
            </span>
            <button
              type="button"
              onClick={() => toggleInferenceMode()}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer font-bold transition-all active:scale-95"
            >
              Conmutar a{" "}
              {inferenceMode === "cloud_federated" ? "Nodo Cero Local" : "Inferencia Cloud"}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
            {inferenceMode === "local_sovereign"
              ? "El sistema opera actualmente en modo de Fallback Soberano On-Premise. Todo el cómputo y la memoria se resguardan estrictamente en la infraestructura local de Nodo Cero en Real del Monte."
              : "El sistema opera en modo Federado Cloud asistido por Gemini 3.7 Pro bajo el control de políticas y cortafuegos Zero-Trust de ARGUS."}
          </p>
        </div>

        {/* Zero-Trust Active Policies Checklist */}
        <div className="space-y-2 font-mono text-xs">
          <span className="text-slate-400 font-bold uppercase tracking-wider text-[11px]">
            Políticas Zero-Trust Activas en Tiempo Real:
          </span>
          <div className="space-y-1.5">
            {[
              {
                id: "zt_01",
                name: "Whitelist de Herramientas Registradas",
                desc: "Ninguna herramienta no declarada en el blueprint puede ejecutarse.",
                status: "Cumplida",
              },
              {
                id: "zt_02",
                name: "Aislamiento Territorial de Memoria",
                desc: "Los recuerdos territoriales e históricos residen en SQLite/Postgres local cifrado.",
                status: "Cumplida",
              },
              {
                id: "zt_03",
                name: "Verificación Criptográfica de Intención",
                desc: "Cada decisión de enrutamiento genera un digest SHA-256 inmutable.",
                status: "Cumplida",
              },
              {
                id: "zt_04",
                name: "Fallback Automático por Pérdida de Conectividad",
                desc: "Degradación suave a modelo local sin interrupción de la presencia de Isabella.",
                status: "Disponible",
              },
            ].map((rule) => (
              <div
                key={rule.id}
                className="p-2.5 rounded-lg bg-[#05080E] border border-slate-800 flex items-start justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="font-bold text-slate-200">{rule.name}</div>
                  <div className="text-[11px] text-slate-400 font-sans">{rule.desc}</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-800 shrink-0">
                  {rule.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Cryptographic Ledger Info */}
        <div className="p-3.5 rounded-xl bg-[#05080E] border border-slate-800 space-y-1.5 font-mono text-xs">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="font-bold">Digest SHA-256 del Libro Mayor:</span>
            <span>Nodo: {snapshot.nodeId}</span>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-slate-900 text-[10px] text-slate-300 break-all select-all">
            {securityGovernance.sha256LedgerDigest}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4 font-mono text-xs">
          <button
            type="button"
            onClick={closeSecurityModal}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer font-bold transition-colors"
          >
            Cerrar Panel
          </button>
        </div>
      </div>
    </div>
  );
};
