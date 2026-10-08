import { useState, useEffect, useCallback } from "react";
import type { LedgerSnapshot, LedgerBlock } from "./contracts";
import { authFetch } from "../auth-client";

// Bloques de respaldo etiquetados `origin: "demo"` / `integrity: "unverified"`:
// los hashes son marcadores de UI, no una cadena verificada por el BFF.
const FALLBACK_POLICY_VERSION = "2.0.0";

const FALLBACK_BLOCKS: LedgerBlock[] = [
  {
    seq: 1,
    operation: "SYSTEM_BOOT",
    signerId: "KMS-SOVEREIGN-NODO-CERO",
    timestamp: "2026-09-30 08:00:00",
    previousHash: "GENESIS",
    payloadHash: "5f8a2c1d9b3e7f04a6c8d2e1b5f7a9c3d0e2f4b6a8c1d3e5f7b9a0c2d4e6f81a",
    currentHash: "a7f3b89012cd4e5f67a89b01c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1",
    algorithm: "SHA-256",
  },
  {
    seq: 2,
    operation: "MODEL_INVOCATION",
    signerId: "CROWN-GATEWAY-AUTH",
    timestamp: "2026-09-30 08:15:22",
    previousHash: "a7f3b89012cd4e5f67a89b01c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1",
    payloadHash: "1c3e5a7b9d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c",
    currentHash: "b8c4d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8",
    algorithm: "SHA-256",
  },
  {
    seq: 3,
    operation: "REVENUE_SPLIT_SETTLE",
    signerId: "BOOKPI-SETTLEMENT-HSM",
    timestamp: "2026-09-30 08:30:10",
    previousHash: "b8c4d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8",
    payloadHash: "2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f",
    currentHash: "c9d5e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0",
    algorithm: "SHA-256",
  },
  {
    seq: 4,
    operation: "DATA_RIGHTS_EXPORT",
    signerId: "ARGUS-AUDIT-SENTINEL",
    timestamp: "2026-09-30 08:45:00",
    previousHash: "c9d5e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0",
    payloadHash: "3e5a7b9d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e",
    currentHash: "d0e6f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1",
    algorithm: "SHA-256",
  },
];

function demoSnapshot(blocks: LedgerBlock[]): LedgerSnapshot {
  return {
    origin: "demo",
    integrity: "unverified",
    blocks,
    fetchedAt: new Date().toISOString(),
    policyVersion: FALLBACK_POLICY_VERSION,
  };
}

export function useLedger() {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/v1/isabella/ledger");
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.blocks)) {
          setSnapshot({
            origin: "live",
            integrity: "unverified",
            blocks: data.blocks,
            fetchedAt: new Date().toISOString(),
            policyVersion:
              typeof data.policyVersion === "string" ? data.policyVersion : FALLBACK_POLICY_VERSION,
          });
          return;
        }
      }
      // Fallback to demo snapshot
      setSnapshot(demoSnapshot(FALLBACK_BLOCKS));
    } catch {
      setSnapshot(demoSnapshot(FALLBACK_BLOCKS));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  return {
    snapshot,
    loading,
    error,
    refresh: fetchLedger,
  };
}
