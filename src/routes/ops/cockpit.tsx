import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/ops/cockpit")({
  component: CockpitOps,
});

export function CockpitOps() {
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const connect = () => {
      try {
        ws = new WebSocket(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/quantum/telemetry`,
        );
        ws.onmessage = (e) => {
          const data = JSON.parse(e.data);
          setSnapshot(data);
          setLatency(data.latencyMs ?? null);
        };
        ws.onclose = () => {
          ws = null;
          poll = setInterval(async () => {
            const res = await fetch("/api/v1/quantum/telemetry");
            if (res.ok) setSnapshot(await res.json());
          }, 3000);
        };
      } catch {
        // Fallback poll 3s si WebSocket no disponible
        poll = setInterval(async () => {
          const res = await fetch("/api/v1/quantum/telemetry");
          if (res.ok) setSnapshot(await res.json());
        }, 3000);
      }
    };
    connect();
    return () => {
      ws?.close();
      if (poll) clearInterval(poll);
    };
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Cockpit Atlas — Nodo Cero</h1>
      <p className="text-sm text-muted-foreground">
        Telemetría cardinal en tiempo real — federaciones
        ARGUS/CROWN/MESH/OBSERVE/RESILIENCE/LITLE/QENGINE — latencia {latency ?? "—"} ms
      </p>
      <pre className="bg-slate-950 text-slate-100 p-4 rounded-xl text-xs overflow-auto">
        {snapshot
          ? JSON.stringify(snapshot, null, 2)
          : "Conectando vía WebSocket... fallback poll 3s"}
      </pre>
    </div>
  );
}
