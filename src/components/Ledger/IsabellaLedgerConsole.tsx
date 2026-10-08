// ==== Isabella Ledger Console (endurecido) ====
// UI unificada de inspección de ledger. Principios de la propuesta:
//  - El cliente sólo presenta DTOs de la API; no es fuente de verdad.
//  - Sin MOCK_LEDGER, sin Math.random, sin porcentajes inventados, sin `as any`.
//  - Modo demo explícito + banner; producción no muestra valores ficticios.
//  - Verificación estructural inmediata (sin setTimeout artificial).
//  - Lista virtualizada de filas colapsadas; detalles fuera de la lista (aside).
//  - Sin secretos en el DOM; provenance siempre etiquetado.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Database,
  Fingerprint,
  Hash,
  KeyRound,
  Link2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { DemoDataNotice } from "../DemoDataNotice";
import { verifyLedger } from "../../lib/ledger/verify";
import { useLedger } from "../../lib/ledger/useLedger";
import type { DataOrigin, IntegrityResult, LedgerBlock } from "../../lib/ledger/contracts";

const ROW_HEIGHT = 64;
const LIST_MAX_HEIGHT = 560;

const OP_BADGES: Record<string, { bg: string; text: string; border: string }> = {
  SYSTEM_BOOT: { bg: "bg-violet-500/10", text: "text-violet-300", border: "border-violet-500/30" },
  MODEL_INVOCATION: { bg: "bg-cyan-500/10", text: "text-cyan-300", border: "border-cyan-500/30" },
  REVENUE_SPLIT_SETTLE: {
    bg: "bg-amber-500/10",
    text: "text-amber-300",
    border: "border-amber-500/30",
  },
  DATA_RIGHTS_EXPORT: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-300",
    border: "border-emerald-500/30",
  },
  MEMORY_LINK_COMMIT: { bg: "bg-sky-500/10", text: "text-sky-300", border: "border-sky-500/30" },
};
const FALLBACK_BADGE = {
  bg: "bg-slate-800/70",
  text: "text-slate-300",
  border: "border-slate-700",
};

const ORIGIN_BADGE: Record<DataOrigin, { label: string; cls: string }> = {
  live: { label: "LIVE", cls: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" },
  demo: { label: "DEMO", cls: "bg-amber-500/10 border-amber-500/30 text-amber-300" },
  cached: { label: "CACHED", cls: "bg-sky-500/10 border-sky-500/30 text-sky-300" },
  unavailable: { label: "UNAVAILABLE", cls: "bg-slate-800/70 border-slate-700 text-slate-400" },
};

function truncateHash(hash: string, start = 10, end = 10): string {
  if (hash.length <= start + end) return hash;
  return `${hash.slice(0, start)}…${hash.slice(-end)}`;
}

type CopyStatus = { id: string | null; status: "idle" | "success" | "error" };

function CopyButton({
  value,
  copyId,
  copied,
  onCopy,
}: {
  value: string;
  copyId: string;
  copied: boolean;
  onCopy: (value: string, id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(value, copyId)}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
      aria-label={copied ? "Hash copiado" : "Copiar hash"}
    >
      {copied ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

function HashField({
  label,
  value,
  icon: Icon,
  accent = false,
  copyId,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  icon: typeof Link2;
  accent?: boolean;
  copyId: string;
  copied: boolean;
  onCopy: (value: string, id: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          <Icon
            aria-hidden="true"
            className={`h-3.5 w-3.5 ${accent ? "text-emerald-400" : "text-slate-500"}`}
          />
          {label}
        </span>
        <CopyButton value={value} copyId={copyId} copied={copied} onCopy={onCopy} />
      </div>
      <code
        className={[
          "block rounded-xl border bg-[#020617] p-3 text-[11px] leading-5 break-all",
          accent ? "border-emerald-500/30 text-emerald-300" : "border-slate-800 text-slate-300",
        ].join(" ")}
      >
        {value}
      </code>
    </div>
  );
}

function BlockRow({
  block,
  selected,
  onSelect,
}: {
  block: LedgerBlock;
  selected: boolean;
  onSelect: (seq: number) => void;
}) {
  const badge = OP_BADGES[block.operation] ?? FALLBACK_BADGE;

  return (
    <div className="pb-2">
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(block.seq)}
        className={[
          "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/70",
          selected
            ? "border-emerald-500/40 bg-[#0A192F]/80 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
            : "border-slate-800/80 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/50",
        ].join(" ")}
      >
        <div className="flex h-9 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-900 font-mono text-xs font-bold text-slate-300">
          #{block.seq}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold ${badge.bg} ${badge.text} ${badge.border}`}
            >
              {block.operation}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <KeyRound aria-hidden="true" className="h-3 w-3" />
              {block.signerId}
            </span>
            <span>{block.timestamp}</span>
          </div>
        </div>
        <code className="hidden truncate font-mono text-[11px] font-bold text-emerald-400 sm:block">
          {truncateHash(block.currentHash, 8, 8)}
        </code>
      </button>
    </div>
  );
}

export const IsabellaLedgerConsole: React.FC = () => {
  const { snapshot, loading, error } = useLedger();
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<IntegrityResult | null>(null);
  const [copyState, setCopyState] = useState<CopyStatus>({ id: null, status: "idle" });
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const blocks = snapshot?.blocks ?? [];
  const origin: DataOrigin = snapshot?.origin ?? "unavailable";

  const selected = useMemo(
    () => blocks.find((b) => b.seq === selectedSeq) ?? null,
    [blocks, selectedSeq],
  );

  const handleVerify = useCallback(() => {
    if (!blocks.length) return;
    setVerifying(true);
    setResult(null);
    void verifyLedger(blocks).then((res) => {
      setResult(res);
      setVerifying(false);
    });
  }, [blocks]);

  const handleCopy = useCallback(async (value: string, id: string) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard no disponible");
      await navigator.clipboard.writeText(value);
      setCopyState({ id, status: "success" });
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopyState({ id: null, status: "idle" }), 1800);
    } catch {
      setCopyState({ id, status: "error" });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const summary = useMemo(() => {
    const byOp = new Map<string, number>();
    for (const b of blocks) byOp.set(b.operation, (byOp.get(b.operation) ?? 0) + 1);
    return {
      count: blocks.length,
      first: blocks[0]?.seq ?? null,
      last: blocks[blocks.length - 1]?.seq ?? null,
      byOp,
    };
  }, [blocks]);

  const listHeight = Math.min(LIST_MAX_HEIGHT, Math.max(blocks.length, 1) * (ROW_HEIGHT + 8));
  const originBadge = ORIGIN_BADGE[origin];

  return (
    <section
      aria-labelledby="ledger-console-title"
      className="w-full space-y-5 font-sans text-slate-200"
    >
      {origin === "demo" && <DemoDataNotice />}

      <header className="flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-2.5 text-emerald-300">
            <Hash aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="ledger-console-title"
                className="text-base font-bold tracking-tight text-slate-100"
              >
                BookPI Ledger Inspector
              </h2>
              <span
                className={`rounded-md border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider ${originBadge.cls}`}
              >
                {originBadge.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Inspección secuencial de enlaces y payloads. La verificación es estructural local; la
              firma corresponde al backend.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleVerify}
          disabled={verifying || blocks.length === 0}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-gradient-to-r from-emerald-950/80 to-slate-900 px-4 py-2 text-xs font-semibold tracking-wide text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.08)] transition-all hover:border-emerald-400/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:cursor-wait disabled:opacity-60"
        >
          {verifying ? (
            <RefreshCw
              aria-hidden="true"
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          )}
          {verifying ? "Verificando…" : "Verificar integridad"}
        </button>
      </header>

      {(loading || error) && (
        <div
          className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-400"
          role="status"
        >
          {loading ? "Cargando ledger…" : `No fue posible obtener el ledger: ${error}`}
        </div>
      )}

      {!loading && !error && blocks.length === 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-400">
          <Database aria-hidden="true" className="h-5 w-5 text-slate-600" />
          Sin datos disponibles (unavailable). No se presentan valores simulados.
        </div>
      )}

      {!loading && !error && blocks.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-[9px] uppercase tracking-widest text-slate-600">
                Bloques
              </span>
              <span className="mt-1 block font-mono text-sm font-semibold text-slate-200">
                {summary.count}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-[9px] uppercase tracking-widest text-slate-600">
                Rango
              </span>
              <span className="mt-1 block font-mono text-sm font-semibold text-slate-200">
                {summary.first === null ? "—" : `#${summary.first}`}–
                {summary.last === null ? "—" : `#${summary.last}`}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-[9px] uppercase tracking-widest text-slate-600">
                Integridad
              </span>
              <span
                className={`mt-1 block font-mono text-sm font-semibold ${result?.valid ? "text-emerald-300" : result ? "text-rose-300" : "text-slate-400"}`}
              >
                {result?.valid ? "Estructura válida" : result ? "Anomalía" : "Pendiente"}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <span className="block text-[9px] uppercase tracking-widest text-slate-600">
                Política
              </span>
              <span className="mt-1 block font-mono text-sm font-semibold text-slate-200">
                {snapshot?.policyVersion ?? "—"}
              </span>
            </div>
          </div>

          {result && (
            <div
              className={[
                "flex items-start gap-3 rounded-2xl border p-4",
                result.valid
                  ? "border-emerald-500/30 bg-emerald-950/30"
                  : "border-rose-500/30 bg-rose-950/30",
              ].join(" ")}
              role="status"
              aria-live="polite"
            >
              <div
                className={`rounded-lg p-1.5 ${result.valid ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}
              >
                {result.valid ? (
                  <ShieldCheck aria-hidden="true" className="h-5 w-5" />
                ) : (
                  <ShieldAlert aria-hidden="true" className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3
                    className={`text-xs font-bold uppercase tracking-wider ${result.valid ? "text-emerald-300" : "text-rose-300"}`}
                  >
                    {result.valid ? "Integridad estructural validada" : "Anomalía detectada"}
                  </h3>
                  <span className="font-mono text-[10px] text-slate-500">
                    {result.checked}/{result.total} bloques revisados
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-400">{result.message}</p>
                {result.valid && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    Verificación local de enlaces; no sustituye la firma criptográfica del backend.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-slate-500">
                <Database className="h-3.5 w-3.5" /> Cadena de bloques
              </h3>
              {blocks.length > 0 && (
                <div
                  className="space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800"
                  style={{ maxHeight: listHeight }}
                >
                  {blocks.map((block) => (
                    <BlockRow
                      key={block.seq}
                      block={block}
                      selected={selectedSeq === block.seq}
                      onSelect={setSelectedSeq}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-5">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-slate-500">
                <Fingerprint className="h-3.5 w-3.5" /> Detalle del bloque
              </h3>
              {selected ? (
                <div className="space-y-4 rounded-2xl border border-slate-800/80 bg-[#050914]/80 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-lg font-light text-slate-100">
                      #{selected.seq}
                    </span>
                    <span
                      className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold ${OP_BADGES[selected.operation]?.bg ?? FALLBACK_BADGE.bg} ${OP_BADGES[selected.operation]?.text ?? FALLBACK_BADGE.text} ${OP_BADGES[selected.operation]?.border ?? FALLBACK_BADGE.border}`}
                    >
                      {selected.operation}
                    </span>
                  </div>

                  <HashField
                    label="Previous hash · link"
                    value={selected.previousHash}
                    icon={Link2}
                    copyId={`prev-${selected.seq}`}
                    copied={copyState.id === `prev-${selected.seq}`}
                    onCopy={handleCopy}
                  />
                  <HashField
                    label="Current hash"
                    value={selected.currentHash}
                    icon={Fingerprint}
                    accent
                    copyId={`current-${selected.seq}`}
                    copied={copyState.id === `current-${selected.seq}`}
                    onCopy={handleCopy}
                  />
                  <HashField
                    label="Payload hash"
                    value={selected.payloadHash}
                    icon={Hash}
                    copyId={`payload-${selected.seq}`}
                    copied={copyState.id === `payload-${selected.seq}`}
                    onCopy={handleCopy}
                  />

                  <div className="grid grid-cols-2 gap-3 border-t border-slate-800/70 pt-4 text-[11px]">
                    <div>
                      <span className="text-slate-600">ALGORITMO</span>
                      <span className="mt-1 block font-semibold text-indigo-300">
                        {selected.algorithm}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-600">SIGNER</span>
                      <span className="mt-1 block font-semibold text-slate-300">
                        {selected.signerId}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-600">TIMESTAMP</span>
                      <span className="mt-1 block font-mono text-slate-300">
                        {selected.timestamp}
                      </span>
                    </div>
                    {selected.keyId && (
                      <div className="col-span-2">
                        <span className="text-slate-600">KEY ID</span>
                        <span className="mt-1 block font-mono text-slate-300">
                          {selected.keyId}
                        </span>
                      </div>
                    )}
                  </div>

                  {origin === "demo" && (
                    <p className="flex items-center gap-1.5 border-t border-slate-800/70 pt-3 text-[10px] uppercase tracking-[0.12em] text-amber-300/80">
                      <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" /> Dato de
                      demostración · no producción
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-center text-xs text-slate-500">
                  Selecciona un bloque de la cadena para inspeccionar su detalle.
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4">
                <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Resumen de operaciones
                </h4>
                <ul className="space-y-1 text-[11px] text-slate-400">
                  {[...summary.byOp.entries()].map(([op, n]) => (
                    <li key={op} className="flex items-center justify-between">
                      <span className="font-mono">{op}</span>
                      <span className="font-mono text-slate-300">{n}</span>
                    </li>
                  ))}
                  {summary.byOp.size === 0 && <li className="text-slate-600">Sin operaciones.</li>}
                </ul>
              </div>
            </div>
          </div>
        </>
      )}

      <footer className="flex flex-col gap-2 border-t border-slate-800/60 pt-4 text-[10px] uppercase tracking-[0.12em] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <span>Inspección local · solo lectura</span>
        <span className="inline-flex items-center gap-1.5 text-slate-500">
          <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" /> Verificación estructural
        </span>
      </footer>
    </section>
  );
};

export default IsabellaLedgerConsole;
