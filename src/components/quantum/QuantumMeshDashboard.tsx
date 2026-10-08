import React, { useState, useEffect, useCallback } from "react";
import {
  Activity,
  Shield,
  Cpu,
  Zap,
  Lock,
  Network,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Server,
  GitBranch,
  Eye,
  BarChart3,
  Radio,
} from "lucide-react";
import { authFetch } from "../../lib/auth-client";

interface MeshStatus {
  deviceRegistry: Array<{
    provider: string;
    implementation: string;
    trust: string;
    remote: boolean;
    enabled: boolean;
  }>;
  scheduler: {
    queued: number;
    maxQueue: number;
    utilizationPercent: number;
    byPriority: { interactive: number; normal: number; batch: number };
    metrics: {
      totalEnqueued: number;
      totalDequeued: number;
      totalExpired: number;
      totalRejected: number;
    };
  };
  workers: {
    total: number;
    idle: number;
    busy: number;
    stopped: number;
    error: number;
    byPool: Record<string, { config: Record<string, unknown>; active: number }>;
    metrics: { totalSpawned: number; totalKilled: number; totalReplaced: number };
  };
  circuitBreaker: {
    totalCircuits: number;
    open: number;
    halfOpen: number;
    closed: number;
    totalFailures: number;
  };
  bookPI: {
    totalBlocks: number;
    lastBlockHash: string;
    chainIntegrity: { valid: boolean; totalBlocks: number };
    statusBreakdown: Record<string, number>;
  };
  hsm: {
    primary: { healthy: boolean; failures: number };
    backup: { healthy: boolean; failures: number };
    activeEndpoint: string;
  };
  tee: {
    totalAttestations: number;
    verified: number;
    unverified: number;
  };
  eventBus: {
    totalEvents: number;
    lastEventHash: string;
    recentEventTypes: Record<string, number>;
  };
  recovery: {
    totalIncidents: number;
    active: number;
    resolved: number;
  };
  telemetry: {
    counters: Record<string, number>;
    activeSpans: number;
    totalSpans: number;
  };
}

const StatusBadge: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ok ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}
  >
    {ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
    {label}
  </span>
);

const MetricCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  value: string | number;
  subtitle?: string;
  ok?: boolean;
}> = ({ icon, title, value, subtitle, ok }) => (
  <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4 space-y-2">
    <div className="flex items-center gap-2 text-[#94a3b8] text-xs uppercase tracking-wider">
      {icon}
      {title}
    </div>
    <div className="text-2xl font-bold text-[#f1f5f9]">{value}</div>
    {subtitle && <div className="text-xs text-[#64748b]">{subtitle}</div>}
    {ok !== undefined && <StatusBadge ok={ok} label={ok ? "Operational" : "Degraded"} />}
  </div>
);

export const QuantumMeshDashboard: React.FC = () => {
  const [mesh, setMesh] = useState<MeshStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchMesh = useCallback(async () => {
    try {
      const res = await authFetch("/api/v1/quantum/mesh/status");
      if (!res.ok) {
        setError(`Mesh status failed: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setMesh(data.mesh);
        setError(null);
      } else {
        setError("Failed to load mesh status");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchMesh();
    const interval = setInterval(fetchMesh, 15_000);
    return () => clearInterval(interval);
  }, [fetchMesh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" />
          <p className="text-[#64748b] text-sm">Initializing Quantum Mesh...</p>
        </div>
      </div>
    );
  }

  if (error || !mesh) {
    return (
      <div className="text-center py-20 space-y-4">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
        <p className="text-red-400">{error || "Mesh unavailable"}</p>
        <button
          onClick={fetchMesh}
          className="px-4 py-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30 hover:bg-blue-600/30 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const enabledCount = mesh.deviceRegistry.filter((d) => d.enabled).length;
  const totalCount = mesh.deviceRegistry.length;
  const chainValid = mesh.bookPI.chainIntegrity.valid;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#f1f5f9] flex items-center gap-2">
            <Network className="w-5 h-5 text-blue-400" />
            Isabella Quantum Mesh
          </h2>
          <p className="text-xs text-[#64748b] mt-1">
            Governed Hybrid Quantum-Classical Execution Platform
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#475569]">Updated {lastRefresh.toLocaleTimeString()}</span>
          <button
            onClick={fetchMesh}
            className="px-3 py-1.5 bg-[#0a0f1e] border border-[#1e293b] text-[#94a3b8] rounded-lg text-xs hover:border-blue-500/40 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${chainValid ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}
      >
        <Shield className={`w-5 h-5 ${chainValid ? "text-emerald-400" : "text-red-400"}`} />
        <div className="flex-1">
          <span
            className={`text-sm font-medium ${chainValid ? "text-emerald-400" : "text-red-400"}`}
          >
            BookPI Chain: {chainValid ? "VALID" : "BROKEN"}
          </span>
          <span className="text-xs text-[#64748b] ml-3">{mesh.bookPI.totalBlocks} blocks</span>
        </div>
        <StatusBadge
          ok={mesh.circuitBreaker.open === 0}
          label={
            mesh.circuitBreaker.open === 0
              ? "All circuits closed"
              : `${mesh.circuitBreaker.open} circuit(s) open`
          }
        />
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          icon={<Cpu size={14} />}
          title="Devices"
          value={`${enabledCount}/${totalCount}`}
          ok={enabledCount > 0}
        />
        <MetricCard
          icon={<Server size={14} />}
          title="Workers"
          value={mesh.workers.total}
          subtitle={`${mesh.workers.idle} idle, ${mesh.workers.busy} busy`}
          ok={mesh.workers.error === 0}
        />
        <MetricCard
          icon={<Clock size={14} />}
          title="Queue"
          value={`${mesh.scheduler.queued}/${mesh.scheduler.maxQueue}`}
          subtitle={`${mesh.scheduler.utilizationPercent}% utilization`}
          ok={mesh.scheduler.metrics.totalRejected === 0}
        />
        <MetricCard
          icon={<Activity size={14} />}
          title="Events"
          value={mesh.eventBus.totalEvents}
          subtitle={`${mesh.telemetry.activeSpans} active spans`}
        />
      </div>

      {/* Device Registry */}
      <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1e293b] flex items-center gap-2">
          <Radio size={14} className="text-blue-400" />
          <span className="text-sm font-medium text-[#f1f5f9]">Device Registry</span>
        </div>
        <div className="divide-y divide-[#1e293b]">
          {mesh.deviceRegistry.map((device) => (
            <div key={device.provider} className="px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <StatusBadge ok={device.enabled} label={device.enabled ? "ON" : "OFF"} />
                <div>
                  <span className="text-sm text-[#e2e8f0] font-mono">{device.provider}</span>
                  <span className="text-xs text-[#64748b] ml-2">{device.implementation}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded ${device.trust === "local" ? "bg-blue-500/10 text-blue-400" : device.trust === "qpu" ? "bg-purple-500/10 text-purple-400" : "bg-amber-500/10 text-amber-400"}`}
                >
                  {device.trust}
                </span>
                {device.remote && <span className="text-xs text-[#64748b]">REMOTE</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Infrastructure Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* HSM */}
        <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[#f1f5f9]">
            <Lock size={14} className="text-amber-400" />
            HSM Status
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#94a3b8]">Primary</span>
              <StatusBadge
                ok={mesh.hsm.primary.healthy}
                label={mesh.hsm.primary.healthy ? "Healthy" : "Degraded"}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#94a3b8]">Backup</span>
              <StatusBadge
                ok={mesh.hsm.backup.healthy}
                label={mesh.hsm.backup.healthy ? "Healthy" : "Degraded"}
              />
            </div>
            <div className="text-xs text-[#64748b]">Active: {mesh.hsm.activeEndpoint}</div>
          </div>
        </div>

        {/* TEE */}
        <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[#f1f5f9]">
            <Eye size={14} className="text-purple-400" />
            TEE Attestation
          </div>
          <div className="space-y-2">
            <div className="text-2xl font-bold text-[#f1f5f9]">{mesh.tee.totalAttestations}</div>
            <div className="flex items-center gap-2">
              <StatusBadge ok={mesh.tee.unverified === 0} label={`${mesh.tee.verified} verified`} />
              {mesh.tee.unverified > 0 && (
                <StatusBadge ok={false} label={`${mesh.tee.unverified} unverified`} />
              )}
            </div>
          </div>
        </div>

        {/* Recovery */}
        <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[#f1f5f9]">
            <AlertTriangle size={14} className="text-amber-400" />
            Recovery
          </div>
          <div className="space-y-2">
            <div className="text-2xl font-bold text-[#f1f5f9]">{mesh.recovery.totalIncidents}</div>
            <div className="flex items-center gap-2">
              <StatusBadge
                ok={mesh.recovery.active === 0}
                label={`${mesh.recovery.active} active`}
              />
              <StatusBadge ok={true} label={`${mesh.recovery.resolved} resolved`} />
            </div>
          </div>
        </div>
      </div>

      {/* BookPI Chain */}
      <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f1f5f9]">
          <GitBranch size={14} className="text-emerald-400" />
          BookPI CRYSTALS-LATAMV Audit Chain
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-[#64748b]">Blocks</div>
            <div className="text-lg font-bold text-[#f1f5f9]">{mesh.bookPI.totalBlocks}</div>
          </div>
          <div>
            <div className="text-xs text-[#64748b]">Chain</div>
            <StatusBadge ok={chainValid} label={chainValid ? "Valid" : "BROKEN"} />
          </div>
          <div className="col-span-2">
            <div className="text-xs text-[#64748b]">Last Hash</div>
            <div className="text-xs font-mono text-[#94a3b8] truncate">
              {mesh.bookPI.lastBlockHash}
            </div>
          </div>
        </div>
      </div>

      {/* Circuit Breaker */}
      <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f1f5f9]">
          <Zap size={14} className="text-blue-400" />
          Circuit Breakers
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <div className="text-xs text-[#64748b]">Total</div>
            <div className="text-lg font-bold text-[#f1f5f9]">
              {mesh.circuitBreaker.totalCircuits}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748b]">Closed</div>
            <div className="text-lg font-bold text-emerald-400">{mesh.circuitBreaker.closed}</div>
          </div>
          <div>
            <div className="text-xs text-[#64748b]">Half-Open</div>
            <div className="text-lg font-bold text-amber-400">{mesh.circuitBreaker.halfOpen}</div>
          </div>
          <div>
            <div className="text-xs text-[#64748b]">Open</div>
            <div className="text-lg font-bold text-red-400">{mesh.circuitBreaker.open}</div>
          </div>
          <div>
            <div className="text-xs text-[#64748b]">Total Failures</div>
            <div className="text-lg font-bold text-[#f1f5f9]">
              {mesh.circuitBreaker.totalFailures}
            </div>
          </div>
        </div>
      </div>

      {/* Scheduler Metrics */}
      <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f1f5f9]">
          <BarChart3 size={14} className="text-cyan-400" />
          Scheduler Metrics
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <div className="text-xs text-[#64748b]">Enqueued</div>
            <div className="text-lg font-bold text-[#f1f5f9]">
              {mesh.scheduler.metrics.totalEnqueued}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748b]">Dequeued</div>
            <div className="text-lg font-bold text-emerald-400">
              {mesh.scheduler.metrics.totalDequeued}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748b]">Expired</div>
            <div className="text-lg font-bold text-amber-400">
              {mesh.scheduler.metrics.totalExpired}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748b]">Rejected</div>
            <div className="text-lg font-bold text-red-400">
              {mesh.scheduler.metrics.totalRejected}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748b]">By Priority</div>
            <div className="text-xs text-[#94a3b8]">
              i:{mesh.scheduler.byPriority.interactive} n:{mesh.scheduler.byPriority.normal} b:
              {mesh.scheduler.byPriority.batch}
            </div>
          </div>
        </div>
      </div>

      {/* 24 Cores Summary */}
      <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f1f5f9] mb-3">
          <Cpu size={14} className="text-violet-400" />
          24 Core Modules
        </div>
        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
          {Array.from({ length: 24 }, (_, i) => i + 1).map((id) => (
            <div
              key={id}
              className="bg-[#0f172a] rounded-lg p-2 text-center border border-[#1e293b]"
            >
              <div className="text-xs font-bold text-blue-400">#{String(id).padStart(2, "0")}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default QuantumMeshDashboard;
