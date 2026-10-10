import "react";

export function EoctPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="panel-header">
        <h1 className="text-2xl font-bold text-white">EOCT · Event Trace</h1>
        <p className="text-sm text-slate-400">
          Rastro de eventos en tiempo real · Objective-Causal Tracer.
        </p>
      </header>
      <div className="surface-raised frame-sapphire">
        <div className="panel-content text-slate-300">
          Event Object Causal Traceability pipeline en ejecución.
        </div>
      </div>
    </div>
  );
}

export default EoctPage;
