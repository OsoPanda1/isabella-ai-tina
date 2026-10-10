import "react";

export function LedgerPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="panel-header">
        <h1 className="text-2xl font-bold text-white">BookPI Ledger</h1>
        <p className="text-sm text-slate-400">Libro mayor cognitivo · Cadena soberana.</p>
      </header>
      <div className="surface-raised frame-gold">
        <div className="panel-content text-slate-300">
          Explorador de bloques BookPI · Consenso proof-of-sovereignty.
        </div>
      </div>
    </div>
  );
}

export default LedgerPage;
