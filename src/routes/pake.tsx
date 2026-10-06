import { createFileRoute } from "@tanstack/react-router";
import { PakeMonitor } from "../components/pake-monitor";

export const Route = createFileRoute("/pake")({
  component: PakePage,
});

export function PakePage() {
  return (
    <div className="min-h-screen bg-[#020817] pt-24 px-4 pb-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-light text-white mb-2">PAKE Diagnostic Interface</h1>
          <p className="text-slate-400">
            Professional Anchoring of Ethical Knowledge — Active Cognitive Sandbox
          </p>
        </div>

        <PakeMonitor />
      </div>
    </div>
  );
}
