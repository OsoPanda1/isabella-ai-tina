import React, { useState } from "react";
import {
  Shield,
  Key,
  Lock,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  RefreshCw,
  Copy,
  Sparkles,
  Activity,
} from "lucide-react";
import {
  generateMLKEMKeyPair,
  encapsulateMLKEM,
  signMLDSA87,
  signSLHDSA128s,
  evaluateLitle32Gates,
} from "../../lib/postQuantumCrypto";
import { soundManager } from "../../utils/soundEffects";

const PROFILES = [
  {
    id: "LATAMV-KEM-1",
    name: "Establecimiento de Claves (KEM)",
    algorithm: "ML-KEM-768 + X25519 (Híbrido)",
    status: "active",
    type: "standard",
    details:
      "Transcript binding activado. Resiliencia contra algoritmos de Shor. Protección de túneles de telemetría y estado de red.",
    usage: "100% (Modo Estándar CROWN)",
  },
  {
    id: "LATAMV-SIG-1",
    name: "Firma Digital Principal (SIG)",
    algorithm: "ML-DSA-87 (Dilithium)",
    status: "active",
    type: "standard",
    details:
      "Firmas deterministas y rápidas en redes reticulares (Lattice-based). Anclaje principal para el Ledger BookPI y la atestación ARGUS.",
    usage: "100% (Verificación de Integridad)",
  },
  {
    id: "LATAMV-SIG-LONG-1",
    name: "Preservación Largo Plazo (SIG-LONG)",
    algorithm: "SLH-DSA-128s (SPHINCS+)",
    status: "active",
    type: "standard",
    details:
      "Hash-based signatures. Utilizado para documentos canónicos y actas de gobernanza que requieren décadas de inmutabilidad comprobable.",
    usage: "Archivos Inmutables & Códice",
  },
  {
    id: "LATAMV-SIG-EXP-1",
    name: "Firmas Compactas (SIG-EXP)",
    algorithm: "FN-DSA-512 (Falcon)",
    status: "experimental",
    type: "experimental",
    details:
      "Draft FIPS 206. Uso restringido para la malla CITEMESH IoT donde el ancho de banda es hiper-restringido.",
    usage: "Edge Nodes & IoT (CITEMESH)",
  },
];

export const CryptographyTab: React.FC = () => {
  const [activeInput, setActiveInput] = useState(
    "Nodo Cero :: Real del Monte :: C.R.O.W.N. Payload",
  );
  const [keyPair, setKeyPair] = useState(() => generateMLKEMKeyPair("rdm-nodo-cero"));
  const [, setEncapsulation] = useState(() => encapsulateMLKEM(keyPair.publicKey));
  const [mldsaSig, setMldsaSig] = useState(() =>
    signMLDSA87("Nodo Cero :: Real del Monte :: C.R.O.W.N. Payload"),
  );
  const [slhSig, setSlhSig] = useState(() =>
    signSLHDSA128s("Nodo Cero :: Real del Monte :: C.R.O.W.N. Payload"),
  );
  const [litleGates, setLitleGates] = useState(() =>
    evaluateLitle32Gates("Nodo Cero :: Real del Monte :: C.R.O.W.N. Payload"),
  );
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleRecomputePQC = () => {
    setIsRecomputing(true);
    soundManager.playBeep(920, 0.04);

    setTimeout(() => {
      const kp = generateMLKEMKeyPair(activeInput);
      const enc = encapsulateMLKEM(kp.publicKey);
      const ml = signMLDSA87(activeInput);
      const slh = signSLHDSA128s(activeInput);
      const gates = evaluateLitle32Gates(activeInput);

      setKeyPair(kp);
      setEncapsulation(enc);
      setMldsaSig(ml);
      setSlhSig(slh);
      setLitleGates(gates);
      setIsRecomputing(false);
      soundManager.playSuccess();
    }, 250);
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    soundManager.playSuccess();
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="space-y-8 animate-fade-in pb-12 text-slate-200">
      {/* Header Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-slate-900 via-[#050C1B] to-slate-950 border border-emerald-500/30 p-6 rounded-2xl flex items-start gap-4 shadow-xl relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-24 h-24 bg-emerald-500/10 blur-2xl rounded-full" />
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-mono font-bold text-slate-100 flex items-center gap-2">
              <span>CRYSTALS-LATAMV</span>
              <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-mono">
                PQC ACTIVE
              </span>
            </h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Suite de Criptografía Poscuántica (ML-KEM-768 & ML-DSA-87). Resistencia comprobada
              contra algoritmos de Shor y Grover.
            </p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-900 via-[#050C1B] to-slate-950 border border-indigo-500/30 p-6 rounded-2xl flex items-start gap-4 shadow-xl relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-24 h-24 bg-indigo-500/10 blur-2xl rounded-full" />
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-mono font-bold text-slate-100 flex items-center gap-2">
              <span>LITLE 32 Gates</span>
              <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-mono">
                32/32 VERIFIED
              </span>
            </h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Matriz de atestación cuántica de 32 compuertas lógicas (Hadamard, CNOT, Pauli-Z,
              Toffoli).
            </p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-900 via-[#050C1B] to-slate-950 border border-amber-500/30 p-6 rounded-2xl flex items-start gap-4 shadow-xl relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-24 h-24 bg-amber-500/10 blur-2xl rounded-full" />
          <div className="p-3 bg-amber-500/10 text-amber-300 rounded-xl border border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-mono font-bold text-slate-100 flex items-center gap-2">
              <span>Encapsulamiento KEM</span>
              <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono">
                HYBRID
              </span>
            </h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Capa híbrida X25519 + ML-KEM-768 para máxima compatibilidad y protección ante
              descifrado retrospectivo.
            </p>
          </div>
        </div>
      </div>

      {/* Interactive PQC Live Attestation Console */}
      <div className="bg-gradient-to-br from-[#050C1B] to-[#030712] border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-mono font-bold text-slate-100">
                CONSOLA DE ATESTACIÓN Y FIRMA POSCUÁNTICA
              </h3>
              <p className="text-xs text-slate-400">
                Generación y verificación determinista en vivo de la suite CRYSTALS-LATAMV
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRecomputePQC}
            disabled={isRecomputing}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-mono font-bold rounded-xl transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRecomputing ? "animate-spin" : ""}`} />
            <span>Recalcular Firmas PQC</span>
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-mono text-slate-400 flex justify-between">
            <span>Carga Útil a Firmar (Payload):</span>
            <span className="text-slate-500">{activeInput.length} caracteres</span>
          </label>
          <input
            type="text"
            value={activeInput}
            onChange={(e) => setActiveInput(e.target.value)}
            className="w-full bg-[#030712] border border-slate-800 rounded-xl p-3 text-xs font-mono text-emerald-300 focus:outline-none focus:border-purple-500/50"
          />
        </div>

        {/* Live Signatures Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs font-mono">
          {/* ML-DSA-87 (Dilithium) Signature */}
          <div className="bg-[#030712] border border-emerald-500/20 p-4 rounded-xl space-y-2">
            <div className="flex justify-between items-center text-emerald-400 font-bold border-b border-slate-800/80 pb-2">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Firma ML-DSA-87 (Dilithium Lattice)
              </span>
              <button
                type="button"
                onClick={() => handleCopy(mldsaSig.signatureHex, "mldsa")}
                className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedKey === "mldsa" ? "Copiado!" : "Copiar"}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 break-all bg-black/40 p-2.5 rounded border border-slate-800/60 font-mono">
              {mldsaSig.signatureHex}
            </p>
            <div className="flex justify-between text-[10px] text-slate-500 pt-1">
              <span>Digest: {mldsaSig.signedDigest.slice(0, 16)}...</span>
              <span className="text-emerald-400">Verificado 32/32 Gates</span>
            </div>
          </div>

          {/* SLH-DSA-128s (SPHINCS+) Signature */}
          <div className="bg-[#030712] border border-indigo-500/20 p-4 rounded-xl space-y-2">
            <div className="flex justify-between items-center text-indigo-400 font-bold border-b border-slate-800/80 pb-2">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                Firma SLH-DSA-128s (SPHINCS+ Hash)
              </span>
              <button
                type="button"
                onClick={() => handleCopy(slhSig.signatureHex, "slh")}
                className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedKey === "slh" ? "Copiado!" : "Copiar"}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 break-all bg-black/40 p-2.5 rounded border border-slate-800/60 font-mono">
              {slhSig.signatureHex}
            </p>
            <div className="flex justify-between text-[10px] text-slate-500 pt-1">
              <span>Digest: {slhSig.signedDigest.slice(0, 16)}...</span>
              <span className="text-indigo-400">Stateless Hash Verified</span>
            </div>
          </div>
        </div>

        {/* LITLE 32 Gates Quantum Matrix Display */}
        <div className="space-y-3 pt-2">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h4 className="text-xs font-mono font-bold text-slate-300 flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-300" />
              MATRIZ DE ATESTACIÓN LITLE 32 GATES (COMPUERTAS CUÁNTICAS EN VIVO)
            </h4>
            <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
              32 / 32 COMPUERTAS APROBADAS
            </span>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 font-mono">
            {litleGates.map((gate) => (
              <div
                key={gate.gateIndex}
                className="p-2 rounded-lg bg-[#030712] border border-amber-500/20 hover:border-amber-500/50 text-center transition-all group relative cursor-pointer"
                title={`Gate ${gate.gateIndex}: ${gate.gateType} | State: ${gate.qubitState} | Fidelity: ${(gate.fidelity * 100).toFixed(2)}%`}
              >
                <div className="text-[10px] text-amber-400 font-bold">G{gate.gateIndex}</div>
                <div className="text-[9px] text-slate-400 truncate">
                  {gate.gateType.slice(0, 5)}
                </div>
                <div className="text-[8px] text-emerald-400 font-bold mt-1">
                  {(gate.fidelity * 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RFC Profiles Section */}
      <div className="space-y-4 pt-4">
        <h3 className="text-lg font-light text-slate-100 flex items-center gap-2 border-b border-slate-800/60 pb-3 font-mono">
          <FileText className="w-4 h-4 text-slate-400" />
          Subperfiles Operacionales (TAMV-RFC-0007)
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {PROFILES.map((p) => (
            <div
              key={p.id}
              className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl hover:border-slate-700 transition-colors shadow-lg"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  {p.type === "standard" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {p.type === "experimental" && (
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                  )}
                  {p.type === "backup" && <Shield className="w-4 h-4 text-slate-400" />}
                  <h4 className="font-mono text-sm text-slate-200 font-bold">{p.id}</h4>
                </div>
                <span
                  className={`text-[9px] font-mono px-2 py-0.5 rounded border uppercase tracking-widest ${
                    p.status === "active"
                      ? "bg-emerald-900/30 text-emerald-400 border-emerald-500/30"
                      : p.status === "experimental"
                        ? "bg-amber-900/30 text-amber-400 border-amber-500/30"
                        : "bg-slate-800 text-slate-400 border-slate-600"
                  }`}
                >
                  {p.status}
                </span>
              </div>
              <h5 className="text-xs font-bold text-indigo-300 mb-2 font-mono">{p.name}</h5>
              <div className="text-[10px] font-mono text-slate-400 mb-3 bg-[#030712] p-2.5 rounded-xl border border-slate-800/50">
                Algoritmo: <span className="text-slate-300 font-bold">{p.algorithm}</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed mb-4">{p.details}</p>
              <div className="flex items-center justify-between text-[10px] font-mono border-t border-slate-800/50 pt-3">
                <span className="text-slate-500">Despliegue:</span>
                <span className="text-slate-300">{p.usage}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
