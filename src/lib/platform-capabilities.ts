/**
 * Runtime capability registry.
 * A capability is only advertised as verified when a real code path and
 * validation evidence exist. This prevents documentation from becoming an
 * authorization boundary or an unsupported production claim.
 */
export type CapabilityStatus =
  "implemented" | "verified" | "experimental" | "simulated" | "shadow" | "planned" | "unavailable";

export interface PlatformCapability {
  id: string;
  owner: "CROWN" | "ARGUS" | "ISA" | "SOPHIA" | "ORION" | "MNEMOS" | "BookPI" | "QUP";
  status: CapabilityStatus;
  productionSafe: boolean;
  evidence: readonly string[];
  notes?: string;
}

export const PLATFORM_CAPABILITIES: readonly PlatformCapability[] = [
  {
    id: "governance.crown",
    owner: "CROWN",
    status: "verified",
    productionSafe: true,
    evidence: ["src/lib/crown.ts", "src/lib/policy-engine.ts", "tests"],
  },
  {
    id: "security.aegis-x",
    owner: "ARGUS",
    status: "implemented",
    productionSafe: false,
    evidence: ["src/lib/latam-aegis-x.ts", "src/routes/api/security.ts"],
    notes:
      "Implemented and testable, but production runtime evidence is not yet equivalent to the verified CROWN gate.",
  },
  {
    id: "evidence.bookpi",
    owner: "BookPI",
    status: "implemented",
    productionSafe: false,
    evidence: [
      "src/lib/repositories/bookpi-postgres-repository.ts",
      "src/lib/bookpi-dev-adapter.ts",
    ],
    notes:
      "Durable evidence path exists; production database and operational evidence are still required before this registry can mark it production-safe.",
  },
  {
    id: "memory.pentacapa",
    owner: "MNEMOS",
    status: "implemented",
    productionSafe: false,
    evidence: ["src/lib/memory-engine.ts", "src/lib/repositories/memory-repository.ts"],
    notes:
      "Implementation exists; production-safe status requires runtime isolation and persistence evidence.",
  },
  {
    id: "tools.sandbox",
    owner: "ORION",
    status: "implemented",
    productionSafe: false,
    evidence: ["src/lib/sovereign-sandbox.ts", "src/lib/tool-registry.ts"],
    notes:
      "Sandbox boundary is implemented, but real executor isolation and image/runtime evidence are required before production approval.",
  },
  {
    id: "quantum.bridge",
    owner: "QUP",
    status: "experimental",
    productionSafe: false,
    evidence: ["quantum_utility_platform/", "src/lib/quantum*"],
    notes: "Simulator/fallback boundary; no QPU or quantum-safe certification is claimed.",
  },
  {
    id: "cryptography.post-quantum-signatures",
    owner: "QUP",
    status: "simulated",
    productionSafe: false,
    evidence: ["src/lib/sovereign-audit.ts", "src/lib/qup-v3-engine.ts"],
    notes:
      "ML-DSA simulation is not cryptographic signature authority and must never be advertised as verified.",
  },
  {
    id: "economy.ledger",
    owner: "BookPI",
    status: "implemented",
    productionSafe: false,
    evidence: [
      "src/lib/monetization/",
      "src/lib/repositories/bookpi-postgres-repository.ts",
      "src/lib/bookpi-dev-adapter.ts",
    ],
    notes:
      "Requires production reconciliation, payout provider verification, and operational controls before live funds.",
  },
  {
    id: "federation.external",
    owner: "CROWN",
    status: "planned",
    productionSafe: false,
    evidence: [],
    notes: "Connectors require explicit provider contracts and trust roots.",
  },
  {
    id: "category.tina",
    owner: "ISA",
    status: "implemented",
    productionSafe: false,
    evidence: [
      "src/lib/tina/category.ts",
      "src/lib/tina/orchestrator.ts",
      "src/lib/skills/tina-category.ts",
      "test/unit/tina-category.test.ts",
    ],
    notes:
      "TINA (Trusted Intelligence, Native & Adaptive) — Isabella Villaseñor AI es la primera AI declarada en la categoría. Implementación real con router, triage ético+AEGIS, ledger hash-chain y skill de runtime. Declaración de categoría ≠ productionSafe; no ejecuta tools ni modelos externos sin backend autorizado.",
  },
] as const;

export function getCapability(id: string): PlatformCapability | undefined {
  return PLATFORM_CAPABILITIES.find((capability) => capability.id === id);
}

export function assertProductionCapability(id: string): PlatformCapability {
  const capability = getCapability(id);
  if (!capability || !capability.productionSafe) {
    throw new Error(`Capability '${id}' is not approved for production execution.`);
  }
  return capability;
}

export function capabilitySummary() {
  return PLATFORM_CAPABILITIES.reduce<Record<CapabilityStatus, number>>(
    (summary, capability) => {
      summary[capability.status] += 1;
      return summary;
    },
    {
      implemented: 0,
      verified: 0,
      experimental: 0,
      simulated: 0,
      shadow: 0,
      planned: 0,
      unavailable: 0,
    },
  );
}

export const CAPABILITY_REGISTRY = {
  list: PLATFORM_CAPABILITIES,
  get: getCapability,
  assertProduction: assertProductionCapability,
  summary: capabilitySummary,
};
