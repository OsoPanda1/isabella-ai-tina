/**
 * NCUA — privacidad soberana: presupuesto de privacidad diferencial,
 * ruido Laplace/Gauss, k-anonimato, l-diversidad y cota superior de
 * riesgo de membresía. Las cifras aquí son cotas computables, no
 * promesas de anonimato absoluto.
 */

export interface PrivacyBudgetState {
  totalEpsilon: number;
  totalDelta: number;
  queriesSpent: number;
}

export class PrivacyBudget {
  private readonly maxEpsilon: number;
  private readonly maxDelta: number;
  private consumedEpsilon = 0;
  private consumedDelta = 0;
  private spent = 0;

  constructor(maxEpsilon = 1.0, maxDelta = 1e-5) {
    this.maxEpsilon = maxEpsilon;
    this.maxDelta = maxDelta;
  }

  get state(): PrivacyBudgetState {
    return {
      totalEpsilon: this.maxEpsilon,
      totalDelta: this.maxDelta,
      queriesSpent: this.spent,
    };
  }

  get remainingEpsilon(): number {
    return Math.max(0, this.maxEpsilon - this.consumedEpsilon);
  }

  spare(epsilonPerQuery: number, deltaPerQuery = 0): boolean {
    return (
      this.consumedEpsilon + epsilonPerQuery <= this.maxEpsilon &&
      this.consumedDelta + deltaPerQuery <= this.maxDelta
    );
  }

  spend(epsilonPerQuery: number, deltaPerQuery = 0): boolean {
    if (!this.spare(epsilonPerQuery, deltaPerQuery)) return false;
    this.consumedEpsilon += epsilonPerQuery;
    this.consumedDelta += deltaPerQuery;
    this.spent += 1;
    return true;
  }

  noisy(
    value: number,
    sensitivity: number,
    mechanism: "laplace" | "gaussian",
    epsilonPerQuery: number,
  ): number | null {
    if (!this.spend(epsilonPerQuery)) return null;
    if (mechanism === "laplace") {
      const scale = sensitivity / Math.max(1e-12, epsilonPerQuery);
      return value + laplaceNoise(scale);
    }
    const sigma = gaussianSigma(sensitivity, epsilonPerQuery);
    return value + gaussianNoise(sigma);
  }
}

function secureUniform(): number {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure randomness unavailable: crypto.getRandomValues is required");
  }
  const values = new Uint32Array(1);
  cryptoApi.getRandomValues(values);
  return (values[0] + 1) / 4294967297;
}

export function laplaceNoise(scale: number): number {
  const uniform = secureUniform();
  const adjusted = Math.max(1e-12, Math.min(1 - 1e-12, uniform));
  if (adjusted > 0.5) {
    return -scale * Math.log(2 * (1 - adjusted));
  }
  return scale * Math.log(2 * adjusted);
}

export function gaussianSigma(sensitivity: number, epsilonPerQuery: number, delta = 1e-5): number {
  return (sensitivity * Math.sqrt(2 * Math.log(1.25 / delta))) / Math.max(1e-12, epsilonPerQuery);
}

export function gaussianNoise(sigma: number): number {
  const u1 = secureUniform();
  const u2 = secureUniform();
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface AnonymityReport {
  satisfiesK: boolean;
  minGroupSize: number;
  groups: number;
}

export function kAnonymity(
  rows: Array<Record<string, string>>,
  quasiIdentifiers: string[],
  k: number,
): AnonymityReport {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const key = quasiIdentifiers.map((column) => row[column] ?? "").join("\u0001");
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const groupSizes = Array.from(groups.values());
  const minGroupSize = groupSizes.length === 0 ? 0 : Math.min(...groupSizes);
  return {
    satisfiesK: minGroupSize >= k,
    minGroupSize,
    groups: groupSizes.length,
  };
}

export interface DiversityReport {
  satisfiesL: boolean;
  sensitiveGroups: number;
  distinctValues: number;
}

export function lDiversity(
  rows: Array<Record<string, string>>,
  quasiIdentifiers: string[],
  sensitiveColumn: string,
  l: number,
): DiversityReport {
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = quasiIdentifiers.map((column) => row[column] ?? "").join("\u0001");
    const set = groups.get(key) ?? new Set<string>();
    set.add(row[sensitiveColumn] ?? "");
    groups.set(key, set);
  }
  const distinctValues = Array.from(groups.values()).reduce((sum, set) => sum + set.size, 0);
  const weakest =
    groups.size === 0 ? 0 : Math.min(...Array.from(groups.values(), (set) => set.size));
  return {
    satisfiesL: weakest >= l,
    sensitiveGroups: groups.size,
    distinctValues,
  };
}

export function membershipRiskBound(epsilon: number): number {
  const expE = Math.exp(epsilon);
  return (expE - 1) / (expE + 1);
}
