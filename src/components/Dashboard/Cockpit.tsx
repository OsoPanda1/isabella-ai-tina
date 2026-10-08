import React, { useEffect, useState } from "react";
import {
  ShieldAlert,
  BookOpen,
  Database,
  BrainCircuit,
  Globe,
  Landmark,
  Coins,
} from "lucide-react";
import { useServerFn } from "../../lib/tanstack-polyfill";
import { getCockpitSnapshot } from "../../lib/atlas.functions";
import { RScoreGauge } from "./RScoreGauge";
import { Litle32Gates } from "./Litle32Gates";
import { QuantumReflectionCard } from "./QuantumReflectionCard";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { FlowMonitor } from "./FlowMonitor";

export const Cockpit: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useServerFn(getCockpitSnapshot);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetchSnapshot();
        if (mounted) setData(res);
      } catch (e: any) {
        if (mounted) setError(e.message);
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  if (error) {
    return (
      <div className="p-4 bg-red-900/20 text-red-400 border border-red-500/30 rounded-xl">
        Error: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-slate-400 animate-pulse">
        Establishing connection to TAMV Kernel...
      </div>
    );
  }

  const { metrics, auditLogs, bookpi, anubis, isabella, eoct, economy, dao } = data;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="panel-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Globe className="w-6 h-6 text-blue-400" />
            Atlas Cockpit
          </h1>
          <p className="text-sm text-slate-400">
            Telemetría en vivo de la infraestructura cognitiva territorial.
          </p>
        </div>
        <div className="text-xs font-mono text-slate-500 bg-[#0B1221] px-3 py-1.5 rounded-full border border-slate-800">
          T: {new Date(data.now).toLocaleTimeString()}
        </div>
      </header>

      {/* Security & Core State */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <RScoreGauge />
        <Litle32Gates />
        <QuantumReflectionCard />
      </div>

      {/* Primary KPI Grid — Enterprise Cognitive Design System */}
      <div className="grid-kpis">
        {/* BookPI — Territory Sovereign Identity */}
        <div className="kpi-card kpi-card--territory">
          <div className="kpi-label">
            <Database className="w-4 h-4" /> BookPI Ledger
          </div>
          <div className="kpi-value">{bookpi.stats.total}</div>
          <div className="kpi-meta">Bloques Minados Soberanos</div>
          <div className="mt-3 text-[10px] text-slate-500 font-mono truncate">
            HEAD: {bookpi.stats.latestHash?.slice(0, 16)}...
          </div>
        </div>

        {/* Anubis — Electric/Security */}
        <div className="kpi-card kpi-card--electric">
          <div className="flex items-center justify-between w-full">
            <div className="kpi-label">
              <ShieldAlert className="w-4 h-4" /> Anubis Sentinel
            </div>
            {anubis.stats.criticals > 0 && (
              <span
                className="badge-dot badge-dot--danger animate-pulse"
                aria-label="Critical alerts active"
              />
            )}
          </div>
          <div className="kpi-value">{anubis.stats.total}</div>
          <div className="kpi-meta">Políticas Evaluadas · Zero-Trust</div>
          <div className="kpi-delta kpi-delta--warn">
            Crit: <span className="font-semibold">{anubis.stats.criticals}</span>
            <span className="mx-1.5 opacity-40">·</span>
            Riesgo {(anubis.stats.avgAnomalyScore * 100).toFixed(1)}%
          </div>
        </div>

        {/* Isabella — Identity */}
        <div className="kpi-card kpi-card--identity frame-isabella">
          <div className="flex items-center justify-between w-full">
            <div className="kpi-label">
              <BrainCircuit className="w-4 h-4" /> Isabella Cognitive
            </div>
            <span className="chip chip--gold">{isabella.stats.emotionalState.dominant}</span>
          </div>
          <div className="kpi-value">{isabella.stats.episodesRecorded}</div>
          <div className="kpi-meta">Episodios de Memoria Episódica</div>
          <div className="kpi-delta">
            Valencia emocional · {(isabella.stats.emotionalState.valence * 100).toFixed(0)}%
          </div>
          <div className="mt-2 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-[#e0bb5d] to-[#c98e7a] h-full"
              style={{ width: `${Math.max(10, isabella.stats.emotionalState.valence * 100)}%` }}
            />
          </div>
        </div>

        {/* Economy — Identity/Gold */}
        <div className="kpi-card kpi-card--identity">
          <div className="kpi-label">
            <Coins className="w-4 h-4" /> Lucrum Prime
          </div>
          <div className="kpi-value">${economy.stats.paidRevenue.toFixed(2)}</div>
          <div className="kpi-meta">Volumen USD · Creator Economy</div>
          <div className="kpi-delta kpi-delta--good">
            <span>Ordenes: {economy.stats.totalOrders}</span>
            <span className="mx-1.5 opacity-40">·</span>
            <span>Productos: {economy.stats.totalProducts}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FlowMonitor />
        <ActivityHeatmap />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Audit Log / EOCT Events — Sapphire Frame */}
        <div className="surface-raised frame-sapphire">
          <div className="panel-header">
            <BookOpen className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-medium text-white">Live Event Trace (EOCT &amp; Kernel)</h3>
          </div>
          <div className="space-y-3 h-[240px] overflow-y-auto pr-2 custom-scrollbar">
            {eoct.events.length === 0 && auditLogs.length === 0 && (
              <div className="text-sm text-slate-500 italic text-center py-8">
                Waiting for events...
              </div>
            )}
            {[
              ...eoct.events.map((e: any) => ({ ...e, _source: "EOCT" })),
              ...auditLogs.map((a: any) => ({ ...a, _source: "KERNEL", ts: a.ts })),
            ]
              .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
              .slice(0, 8)
              .map((item, idx) => (
                <div
                  key={idx}
                  className="flex gap-3 text-sm p-2 rounded bg-slate-800/30 hover:bg-slate-800/50 transition-colors border border-transparent hover:border-slate-700/50"
                >
                  <div className="w-1.5 rounded-full bg-blue-500/50 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-mono text-xs text-blue-300 font-medium">
                        {item._source === "EOCT" ? item.type : item.action}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(item.ts).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-slate-400 text-xs truncate">
                      {item._source === "EOCT"
                        ? `Actor: ${item.source} → Target: ${item.target || "none"}`
                        : `Actor: ${item.actor}`}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* DAO / Governance — Gold Frame */}
        <div className="surface-raised frame-gold">
          <div className="panel-header">
            <Landmark className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-medium text-white">KORIMA DAO · Gobernanza Territorial</h3>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-800/30 p-3 rounded-lg border border-slate-700/30">
              <div className="text-slate-400 text-xs uppercase mb-1">Propuestas Activas</div>
              <div className="text-xl text-white font-medium tabular-nums">
                {dao.stats.activeProposals}
              </div>
            </div>
            <div className="bg-slate-800/30 p-3 rounded-lg border border-slate-700/30">
              <div className="text-slate-400 text-xs uppercase mb-1">Votos Emitidos</div>
              <div className="text-xl text-white font-medium tabular-nums">
                {dao.stats.totalVotes}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">
              Instantánea de Métricas
            </div>
            {metrics
              .map((m: any, i: number) => (
                <div
                  key={i}
                  className="flex justify-between text-xs font-mono p-1.5 bg-slate-900/50 rounded"
                >
                  <span className="text-slate-400 truncate w-2/3">
                    {m.name}
                    {m.labels ? ` {${m.labels}}` : ""}
                  </span>
                  <span className="text-amber-300">{m.value}</span>
                </div>
              ))
              .slice(0, 8)}
          </div>
        </div>
      </div>
    </div>
  );
};
