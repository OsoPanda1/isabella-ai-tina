import React, { useState } from "react";
import {
  DollarSign,
  ShieldCheck,
  FileKey,
  BarChart4,
  TrendingUp,
  Sparkles,
  Building2,
  UserCircle,
  Briefcase,
  ChevronRight,
} from "lucide-react";
import { motion } from "motion/react";

export const CattleyaFinanceView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"wallet" | "passport" | "marketplace">("wallet");

  return (
    <div className="flex flex-col h-[calc(100vh-145px)] min-h-[580px] max-h-[900px] rounded-3xl border border-slate-800 bg-[#02040A] shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden relative font-sans text-slate-200">
      {/* Dynamic Background */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-900/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-900/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Header */}
      <header className="px-7 py-5 border-b border-slate-800/80 bg-[#050810]/95 backdrop-blur-xl relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-emerald-900/30 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
            <DollarSign className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-[#F8FAFC]">
              Cattleya Finance
            </h2>
            <p className="text-[11px] font-mono text-emerald-400/80 tracking-wider uppercase mt-1">
              Creator Economy • Programmatic Revenue Split
            </p>
          </div>
        </div>

        <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-800/80">
          <button
            onClick={() => setActiveTab("wallet")}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === "wallet" ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"}`}
          >
            Wallet & Ledger
          </button>
          <button
            onClick={() => setActiveTab("passport")}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === "passport" ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"}`}
          >
            Economic Passport
          </button>
          <button
            onClick={() => setActiveTab("marketplace")}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === "marketplace" ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"}`}
          >
            Marketplace
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-7 relative z-10 custom-scrollbar">
        {activeTab === "wallet" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-1 bg-gradient-to-br from-emerald-900/40 to-[#0A192F] p-5 rounded-2xl border border-emerald-500/20 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl" />
                <h3 className="text-sm text-emerald-100/70 font-medium mb-1">Available Balance</h3>
                <div className="text-3xl font-bold text-white mb-2 flex items-baseline gap-1">
                  $4,250<span className="text-sm font-medium text-emerald-400">.00</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
                  <TrendingUp className="w-3.5 h-3.5" /> +12.5% vs last month
                </div>
              </div>

              <div className="md:col-span-3 bg-[#0A192F]/40 p-5 rounded-2xl border border-slate-700/50">
                <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Programmatic Revenue Split (Append-Only Ledger)
                </h3>

                <div className="flex h-4 rounded-full overflow-hidden shadow-inner bg-slate-800 mb-3 border border-slate-700">
                  <div
                    className="bg-emerald-500 h-full"
                    style={{ width: "50%" }}
                    title="User/Creator (50%)"
                  />
                  <div
                    className="bg-blue-500 h-full"
                    style={{ width: "35%" }}
                    title="Isabella Ops (35%)"
                  />
                  <div
                    className="bg-purple-500 h-full"
                    style={{ width: "10%" }}
                    title="Creator Reward (10%)"
                  />
                  <div
                    className="bg-amber-500 h-full"
                    style={{ width: "5%" }}
                    title="Ecosystem Fund (5%)"
                  />
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                  <div>
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />
                    50% User
                  </div>
                  <div>
                    <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1.5" />
                    35% Ops
                  </div>
                  <div>
                    <span className="inline-block w-2 h-2 rounded-full bg-purple-500 mr-1.5" />
                    10% Reward
                  </div>
                  <div>
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5" />
                    5% Ecosystem
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#0A192F]/30 rounded-2xl border border-slate-700/50 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-200">Revenue Ledger SHA-256</h3>
                <span className="text-[10px] font-mono text-slate-500 uppercase">
                  Status: Confirmed / Settled
                </span>
              </div>
              <div className="divide-y divide-slate-800/50">
                {[
                  {
                    id: "tx_9f8a2",
                    date: "2026-08-23 14:30:12",
                    type: "Digital Asset Sale",
                    amount: "+$120.00",
                    split: "$60 to Creator",
                    hash: "a7f8e9...3b2c",
                    status: "settled",
                  },
                  {
                    id: "tx_7b3c1",
                    date: "2026-08-22 09:15:44",
                    type: "Workflow Template",
                    amount: "+$45.00",
                    split: "$22.50 to Creator",
                    hash: "f9d3a1...7e4a",
                    status: "confirmed",
                  },
                  {
                    id: "tx_2e1a9",
                    date: "2026-08-20 18:45:00",
                    type: "Consulting Booking",
                    amount: "+$350.00",
                    split: "$175.00 to Creator",
                    hash: "c5b2f8...9d1e",
                    status: "settled",
                  },
                ].map((tx, i) => (
                  <div
                    key={i}
                    className="p-4 flex items-center justify-between hover:bg-slate-800/20 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-emerald-900/20 flex items-center justify-center border border-emerald-500/20">
                        <FileKey className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-200">{tx.type}</div>
                        <div className="text-xs text-slate-500 font-mono">
                          {tx.date} • {tx.id}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-emerald-400">{tx.amount}</div>
                      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5 justify-end mt-0.5">
                        <span
                          className={`px-1.5 py-0.5 rounded ${tx.status === "settled" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"}`}
                        >
                          {tx.status}
                        </span>
                        SHA256: {tx.hash}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "passport" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="col-span-1 bg-gradient-to-b from-[#0A192F] to-[#02040A] p-6 rounded-2xl border border-slate-700/50 text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500" />
                <div className="w-24 h-24 mx-auto rounded-full bg-slate-800 border-4 border-slate-700 mb-4 flex items-center justify-center">
                  <UserCircle className="w-12 h-12 text-slate-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-1">Architect Node</h3>
                <p className="text-sm text-slate-400 mb-4 font-mono">IDNVIDA: id_rdm_8x9a2f</p>

                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium mb-6">
                  <ShieldCheck className="w-3.5 h-3.5" /> Verified Creator
                </div>

                <div className="grid grid-cols-2 gap-3 text-left">
                  <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                    <div className="text-xs text-slate-500 font-mono">Global Score</div>
                    <div className="text-lg font-bold text-white">99.4</div>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                    <div className="text-xs text-slate-500 font-mono">Evidence Lvl</div>
                    <div className="text-lg font-bold text-white">A+</div>
                  </div>
                </div>
              </div>

              <div className="col-span-2 space-y-4">
                <h3 className="text-lg font-medium text-slate-200">
                  Reputation Metrics (9-Factor)
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Quality Assessment", value: "98%", color: "bg-blue-500" },
                    { label: "Reliability Rate", value: "99.9%", color: "bg-emerald-500" },
                    { label: "Security Compliance", value: "100%", color: "bg-purple-500" },
                    { label: "Customer Retention", value: "92%", color: "bg-amber-500" },
                    { label: "Dispute Rate", value: "0.01%", color: "bg-red-500" },
                    { label: "Evidence Rigor", value: "97%", color: "bg-indigo-500" },
                  ].map((metric, idx) => (
                    <div
                      key={idx}
                      className="bg-[#0A192F]/30 p-4 rounded-xl border border-slate-700/50"
                    >
                      <div className="flex justify-between items-end mb-2">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">
                          {metric.label}
                        </span>
                        <span className="text-sm font-bold text-white">{metric.value}</span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full ${metric.color}`} style={{ width: metric.value }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "marketplace" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-slate-200">Asset Marketplace</h3>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">
                17 Opportunity Templates Available
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  title: "Cognitive Agent Model",
                  type: "Agent Workflow",
                  est: "$800 - $2,500/mo",
                  icon: Sparkles,
                  color: "text-purple-400",
                  bg: "bg-purple-500/10",
                },
                {
                  title: "Territorial Data Dataset",
                  type: "Dataset",
                  est: "$50 - $300/sale",
                  icon: BarChart4,
                  color: "text-blue-400",
                  bg: "bg-blue-500/10",
                },
                {
                  title: "Enterprise Policy Ruleset",
                  type: "Knowledge Pack",
                  est: "$1,200 - $5,000",
                  icon: Building2,
                  color: "text-emerald-400",
                  bg: "bg-emerald-500/10",
                },
                {
                  title: "Quantum Sandbox Plugin",
                  type: "Plugin / Skill",
                  est: "$500 - $1,500/mo",
                  icon: Cpu,
                  color: "text-amber-400",
                  bg: "bg-amber-500/10",
                },
                {
                  title: "Governance Consulting",
                  type: "Service",
                  est: "$2,000 - $8,000",
                  icon: Briefcase,
                  color: "text-indigo-400",
                  bg: "bg-indigo-500/10",
                },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="bg-slate-900/40 p-5 rounded-2xl border border-slate-700/50 hover:bg-slate-800/60 transition-colors cursor-pointer group"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-2.5 rounded-xl ${item.bg}`}>
                      <item.icon className={`w-5 h-5 ${item.color}`} />
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-2 py-1 bg-slate-800 rounded">
                      {item.type}
                    </span>
                  </div>
                  <h4 className="text-base font-semibold text-slate-200 mb-1 group-hover:text-blue-400 transition-colors">
                    {item.title}
                  </h4>
                  <p className="text-xs text-slate-400 mb-4 font-mono">Est: {item.est}</p>

                  <div className="flex items-center text-xs font-medium text-slate-300 group-hover:text-white">
                    Deploy Template{" "}
                    <ChevronRight className="w-4 h-4 ml-1 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

// Temp mock for Cpu icon
const Cpu = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect width="16" height="16" x="4" y="4" rx="2" />
    <rect width="6" height="6" x="9" y="9" rx="1" />
    <path d="M15 2v2" />
    <path d="M15 20v2" />
    <path d="M2 15h2" />
    <path d="M2 9h2" />
    <path d="M20 15h2" />
    <path d="M20 9h2" />
    <path d="M9 2v2" />
    <path d="M9 20v2" />
  </svg>
);
