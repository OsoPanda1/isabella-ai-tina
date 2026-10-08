import React, { useState, useEffect } from "react";
import { Activity, Server, Wifi, WifiOff } from "lucide-react";
import "../../lib/apiInterceptor";

export const APIHealthMonitor: React.FC = () => {
  const [latency, setLatency] = useState<number | null>(null);
  const [status, setStatus] = useState<"healthy" | "degraded" | "offline">("healthy");
  const [lastCheck, setLastCheck] = useState<Date>(new Date());

  useEffect(() => {
    let isMounted = true;

    const checkHealth = async () => {
      try {
        const start = performance.now();
        // A simple ping to the local API which would then represent gateway health
        // Alternatively we can ping Gemini directly, but for now we ping our server health
        const res = await fetch("/api/health").catch(() => null);

        const end = performance.now();

        if (isMounted) {
          if (res && res.ok) {
            const currentLatency = Math.round(end - start);
            setLatency(currentLatency);
            setStatus(currentLatency > 1500 ? "degraded" : "healthy");
          } else {
            setStatus("offline");
            setLatency(null);
          }
          setLastCheck(new Date());
        }
      } catch (err) {
        if (isMounted) {
          setStatus("offline");
          setLatency(null);
          setLastCheck(new Date());
        }
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000); // Check every 10 seconds

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="bg-[#0A101F]/80 backdrop-blur-md border border-white/10 p-5 rounded-2xl flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-widest text-slate-300 uppercase flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          Métricas de Enlace (API)
        </h3>
        {status === "healthy" ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-full border border-emerald-500/20">
            <Wifi className="w-3.5 h-3.5" /> ONLINE
          </span>
        ) : status === "degraded" ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 text-amber-400 text-xs font-medium rounded-full border border-amber-500/20">
            <Wifi className="w-3.5 h-3.5" /> DEGRADADO
          </span>
        ) : (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-500/10 text-rose-400 text-xs font-medium rounded-full border border-rose-500/20">
            <WifiOff className="w-3.5 h-3.5" /> OFFLINE
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-black/20 rounded-lg p-3 border border-white/5">
          <div className="text-xs text-slate-500 mb-1">Latencia de Red</div>
          <div className="text-2xl font-light font-mono text-white flex items-baseline gap-1">
            {latency !== null ? latency : "---"}{" "}
            <span className="text-xs text-slate-500 font-sans">ms</span>
          </div>
        </div>

        <div className="bg-black/20 rounded-lg p-3 border border-white/5">
          <div className="text-xs text-slate-500 mb-1">Último Pulso</div>
          <div className="text-sm font-light text-slate-300 mt-1.5">
            {lastCheck.toLocaleTimeString([], {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </div>
        </div>
      </div>

      <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
        <Server className="w-3.5 h-3.5" />
        Gateway Zero-Trust Activo
      </div>
    </div>
  );
};
