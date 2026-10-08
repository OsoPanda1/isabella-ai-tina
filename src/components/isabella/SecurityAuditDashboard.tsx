import { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Search,
  Filter,
  Lock,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { getSessionToken } from "@/lib/auth-client";
import { toast } from "sonner";

export interface SecurityAuditLogItem {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  source: string;
  securityStatus: "ALLOWED" | "CHALLENGED" | "QUARANTINED" | "BLOCKED";
  severity: string;
  evidenceId: string;
}

// Conflict resolution: backend-only evidence is the single source of truth.
const INITIAL_AUDIT_LOGS: SecurityAuditLogItem[] = [];

export function SecurityAuditDashboard() {
  const [logs, setLogs] = useState<SecurityAuditLogItem[]>(INITIAL_AUDIT_LOGS);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [auditSecretVerified, setAuditSecretVerified] = useState(false);

  const fetchSecurityAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const token = getSessionToken() || sessionStorage.getItem("isabella_session_token");
      if (token) {
        const res = await fetch("/api/security?action=audit-logs", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.logs)) {
            setLogs(data.logs);
            setAuditSecretVerified(data.auditSecretVerified === true);
          }
        }
      }
    } catch {
      setLogs([]);
      setAuditSecretVerified(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSecurityAuditLogs();
  }, [fetchSecurityAuditLogs]);

  const filteredLogs = logs.filter((item) => {
    const matchesSearch =
      item.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.actor.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.source.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || item.securityStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: SecurityAuditLogItem["securityStatus"]) => {
    switch (status) {
      case "ALLOWED":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="size-3" /> PERMITIDO
          </span>
        );
      case "CHALLENGED":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-amber-400">
            <AlertTriangle className="size-3" /> DESAFÍO
          </span>
        );
      case "QUARANTINED":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-purple-400">
            <ShieldAlert className="size-3" /> CUARENTENA
          </span>
        );
      case "BLOCKED":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-rose-400">
            <XCircle className="size-3" /> BLOQUEADO
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      id="aegis-security-audit-dashboard"
      className="w-full space-y-6 rounded-3xl border border-border/20 bg-slate-950 p-6 text-slate-100 shadow-2xl"
    >
      {/* HEADER & CONTEXT STATE */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl border border-purple-500/30 bg-purple-500/10 text-purple-400 shadow-[0_0_20px_-3px_rgba(168,85,247,0.25)]">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-white font-display">
                Auditoría de Seguridad AEGIS
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold ${
                  auditSecretVerified
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                }`}
              >
                <Lock className="size-3" />
                {auditSecretVerified ? "AEGIS_AUDIT_SECRET VERIFICADO" : "CONTEXTO NO AUTENTICADO"}
              </span>
            </div>
            <p className="font-mono text-xs text-slate-400 mt-0.5">
              Registro append-only proveniente exclusivamente del backend; sin datos sintéticos.
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            void fetchSecurityAuditLogs();
            toast.success("Logs de auditoría sincronizados.");
          }}
          disabled={loading}
          className="self-start md:self-auto flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 font-mono text-xs text-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin text-purple-400" : ""}`} />
          <span>Sincronizar Logs</span>
        </button>
      </div>

      {/* FILTER & SEARCH CONTROLS */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800/80">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por acción, actor o IP..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 py-1.5 font-mono text-xs text-slate-200 placeholder-slate-500 focus:border-purple-500/50 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
          <Filter className="size-4 text-slate-400 shrink-0" />
          <span className="font-mono text-xs text-slate-400 shrink-0">Filtrar:</span>
          {["ALL", "ALLOWED", "CHALLENGED", "QUARANTINED", "BLOCKED"].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold transition-all shrink-0 border ${
                statusFilter === st
                  ? "border-purple-500 bg-purple-500/20 text-purple-300"
                  : "border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* AUDIT LOG TABLE */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-950/80">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-400 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3 font-semibold">Marca Temporal</th>
              <th className="px-4 py-3 font-semibold">Acción Auditable</th>
              <th className="px-4 py-3 font-semibold">Actor / Origen</th>
              <th className="px-4 py-3 font-semibold">Estado de Seguridad</th>
              <th className="px-4 py-3 font-semibold">Severidad</th>
              <th className="px-4 py-3 font-semibold text-right">ID de evidencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500 italic">
                  No se encontraron registros de auditoría que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-900/40 transition-colors">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {new Date(log.timestamp).toLocaleString("es-MX", {
                      hour12: false,
                    })}
                  </td>
                  <td className="px-4 py-3 font-semibold text-white flex items-center gap-1.5">
                    <FileText className="size-3.5 text-purple-400 shrink-0" />
                    <span className="truncate max-w-[200px]" title={log.action}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    <div>{log.actor}</div>
                    <div className="text-[10px] text-slate-500">{log.source}</div>
                  </td>
                  <td className="px-4 py-3">{getStatusBadge(log.securityStatus)}</td>
                  <td className="px-4 py-3 text-slate-400 font-semibold">{log.severity}</td>
                  <td className="px-4 py-3 text-right text-slate-500 font-mono text-[10px]">
                    {log.evidenceId}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-2 border-t border-slate-900">
        <span>
          Mostrando {filteredLogs.length} de {logs.length} eventos auditados por el backend
        </span>
        <span>Canal de evidencia: backend autenticado • sin datos sintéticos</span>
      </div>
    </div>
  );
}

export default SecurityAuditDashboard;
