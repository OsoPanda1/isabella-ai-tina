import React, { useState } from "react";
import { Key, ShieldAlert, Copy, RefreshCw } from "lucide-react";

export const AuthManager: React.FC = () => {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const generateApiKey = async () => {
    setGenerating(true);
    // Simulate internal 512-bit native generation for Isabella
    setTimeout(async () => {
      // 512 bits = 64 bytes
      const array = new Uint8Array(64);
      window.crypto.getRandomValues(array);
      const hex = Array.from(array)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      setApiKey(`iv_live_${hex}`);
      setGenerating(false);
    }, 1200);
  };

  const copyToClipboard = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
    }
  };

  return (
    <div className="bg-slate-900/50 rounded-2xl border border-slate-700/50 p-6 font-sans">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-purple-900/40 rounded-lg border border-purple-500/30">
          <Key className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-200">Native Authentication (512-bit)</h3>
          <p className="text-xs text-slate-400">
            Generate sovereign API keys for Isabella Villaseñor AI
          </p>
        </div>
      </div>

      <div className="bg-[#0A192F]/60 p-5 rounded-xl border border-slate-700 mb-6">
        <div className="flex items-start gap-3 mb-4">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-sm text-slate-300 leading-relaxed">
            Keys generated here use a secure internal 512-bit entropy pool. These keys are prefixed
            with <span className="font-mono text-xs bg-slate-800 px-1 rounded">iv_live_</span> and
            must be passed via the{" "}
            <span className="font-mono text-xs bg-slate-800 px-1 rounded">
              Authorization: Bearer
            </span>{" "}
            header.
          </p>
        </div>

        <button
          onClick={generateApiKey}
          disabled={generating}
          className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold transition-colors shadow-lg shadow-purple-900/20 flex justify-center items-center gap-2"
        >
          {generating ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Key className="w-5 h-5" />
          )}
          {generating ? "Synthesizing 512-bit Key..." : "Generate Native API Key"}
        </button>
      </div>

      {apiKey && (
        <div className="bg-slate-950 p-4 rounded-xl border border-purple-500/30 flex items-center justify-between">
          <div className="font-mono text-xs text-purple-300 break-all pr-4">{apiKey}</div>
          <button
            onClick={copyToClipboard}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors shrink-0"
            title="Copy to clipboard"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
