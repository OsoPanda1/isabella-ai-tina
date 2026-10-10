import * as crypto from "node:crypto";
import { ObservabilityService } from "../telemetry/observability";

export interface EntropyReport {
  timestamp: string;
  sourceType: "quantum_hybrid" | "fallback_crypto";
  entropyBits: number;
  seedHex: string;
  contributingFactors: string[];
}

class QuantumEntropyService {
  /**
   * Generates a cryptographically secure, high-entropy non-deterministic seed
   * combining hardware cryptographic sources, physical system stats drift, and
   * micro-second precise elapsed clocks for the CROWN engine's policy decision gateway.
   */
  public generatePolicySeed(): EntropyReport {
    const contributingFactors: string[] = ["node_crypto_api"];
    let finalBuffer = crypto.randomBytes(32); // 256-bits of cryptographically secure random values

    try {
      // Retrieve the current observability telemetry snapshot for a physical entropy factor
      const snapshot = ObservabilityService.getSnapshot();
      const timestampFactor = snapshot.timestamp;
      const throughputFactor = snapshot.throughput.toString();
      const latencyFactor = snapshot.avgLatencyMs.toString();

      contributingFactors.push("telemetry_drift_sensors");

      // Dynamic clock timings
      const hrt = process.hrtime();
      const microFactor = ((hrt[0] * 1e9 + hrt[1]) % 1000000007).toString();
      contributingFactors.push("hrtime_clock_drift");

      // Dynamic core temperature and load matrix hash
      const coreMetricsStr = Object.values(snapshot.cores)
        .map((c) => `${c.id}:${c.temperatureCelsius.toFixed(4)}:${c.loadPercentage.toFixed(2)}`)
        .join(";");
      contributingFactors.push("core_thermal_drift");

      const seedSourceString = `${timestampFactor}|${throughputFactor}|${latencyFactor}|${microFactor}|${coreMetricsStr}`;

      // Hash the thermal-drift source string and XOR with our crypto random bytes
      const driftHash = crypto.createHash("sha256").update(seedSourceString).digest();

      const mixedBuffer = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) {
        mixedBuffer[i] = finalBuffer[i] ^ driftHash[i];
      }

      finalBuffer = mixedBuffer;
    } catch (err) {
      console.warn("[ENTROPY_SERVICE] Drift estimation bypass, using standard Node CSPRNG.", err);
      contributingFactors.push("bypass_fallback_csprng");
    }

    const seedHex = finalBuffer.toString("hex");

    return {
      timestamp: new Date().toISOString(),
      sourceType: contributingFactors.includes("core_thermal_drift")
        ? "quantum_hybrid"
        : "fallback_crypto",
      entropyBits: 256,
      seedHex,
      contributingFactors,
    };
  }

  /**
   * Translates a generated seed to a bounded floating-point probability factor
   * in the range [0, 1] for stochastic modeling in constitutional routing.
   */
  public seedToProbability(seedHex: string): number {
    const bytes = Buffer.from(seedHex, "hex");
    const val = bytes.readUInt32BE(0); // read first 4 bytes
    return val / 0xffffffff;
  }
}

export const EntropyService = new QuantumEntropyService();
export default EntropyService;
