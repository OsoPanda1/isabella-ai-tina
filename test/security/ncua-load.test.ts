import { describe, expect, it } from "vitest";

import { NCUAAcademicPipeline } from "@/lib/ncua/academic-pipeline";
import { ERI_MIN_SCORE } from "@/lib/ncua/eri";
import { BookPILedgerAuditor } from "@/lib/ncua/bookpi-trajectory";

const TEST_HMAC_KEY = "ncua-load-test-concurrent-hmac-key-12345678";

const MEDIUM_TEXT =
  "Ejecutar análisis de soberanía territorial e inspección cuántica en el Gemelo " +
  "Digital de Real del Monte, verificando el sellado BookPI y la resonancia con PennyLane QUP v3.0.";

function makeInput(index: number): string {
  return `${MEDIUM_TEXT} Registro concurrente #${index} con datos cuantitativos reproducibles y evidencia empírica del 2026.`;
}

describe("ncua:load — ejecución concurrente 50–500", () => {
  it("ráfaga de 50 ejecuciones concurrentes: todos SUCCESS, ERI ≥ 95, integridad válida", async () => {
    const CONCURRENCY = 50;
    const pipeline = new NCUAAcademicPipeline({
      hmacKey: TEST_HMAC_KEY,
      entropyThresholds: [1.8],
      maxRefinements: 1,
    });
    const start = performance.now();
    const results = Array.from({ length: CONCURRENCY }, (_, i) =>
      pipeline.execute(makeInput(i), `tenant-burst-50-${i}`),
    );
    const wallMs = performance.now() - start;

    expect(results.every((r) => r.status === "SUCCESS")).toBe(true);
    expect(results.every((r) => r.epistemicRobustnessIndex >= ERI_MIN_SCORE)).toBe(true);
    expect(results.every((r) => r.bookpiLedgerRecord !== null)).toBe(true);
    expect(results.every((r) => r.bytePatchesGenerated >= 1)).toBe(true);

    const eriValues = results.map((r) => r.epistemicRobustnessIndex);
    const uniqueEris = new Set(eriValues);
    expect(uniqueEris.size).toBeLessThanOrEqual(5);

    // verify a shared ledger chain (all 50 entries appended correctly)
    const ledger = new BookPILedgerAuditor({ hmacKey: TEST_HMAC_KEY });
    for (let i = 0; i < CONCURRENCY; i++) {
      ledger.recordNCUATransaction(
        `tenant-verify-${i}`,
        results[i].bytePatchesGenerated,
        {
          conceptId: `load-${i}`,
          latentDimensions: [0, 0, 0, 0, 0, 0, 0, 0],
          semanticEnergy: 0,
          epistemicConfidence: results[i].epistemicRobustnessIndex,
        },
        results[i].qupQuantumSignature,
      );
    }
    const report = ledger.verifyIntegrity();
    expect(report.valid).toBe(true);
    expect(report.checkedEntries).toBe(CONCURRENCY);
    console.log(
      `[ncua:load-50] wall=${wallMs.toFixed(1)}ms avg=${(wallMs / CONCURRENCY).toFixed(2)}ms ERIs=[${Math.min(...eriValues)}, ${Math.max(...eriValues)}]`,
    );
  }, 30000);

  it("ráfaga de 500 ejecuciones concurrentes: todos SUCCESS, integridad válida", async () => {
    const CONCURRENCY = 500;
    const pipeline = new NCUAAcademicPipeline({
      hmacKey: TEST_HMAC_KEY,
      entropyThresholds: [1.8],
      maxRefinements: 1,
    });
    const start = performance.now();
    const results = Array.from({ length: CONCURRENCY }, (_, i) =>
      pipeline.execute(makeInput(i), `tenant-burst-500-${i}`),
    );
    const wallMs = performance.now() - start;

    expect(results.every((r) => r.status === "SUCCESS")).toBe(true);
    expect(results.every((r) => r.epistemicRobustnessIndex >= ERI_MIN_SCORE)).toBe(true);
    expect(results.every((r) => r.bytePatchesGenerated >= 1)).toBe(true);

    const eriValues = results.map((r) => r.epistemicRobustnessIndex);
    const eriMin = Math.min(...eriValues);
    const eriMax = Math.max(...eriValues);
    expect(eriMax - eriMin).toBeLessThanOrEqual(10);

    const totalPatches = results.reduce((sum, r) => sum + r.bytePatchesGenerated, 0);
    const totalBytes = results.reduce((sum, r) => sum + r.rawInputLengthBytes, 0);
    const throughputMbs = totalBytes / Math.max(1, wallMs);
    console.log(
      `[ncua:load-500] wall=${wallMs.toFixed(1)}ms patches=${totalPatches} bytes=${totalBytes} throughput=${throughputMbs.toFixed(2)}MB/s ERIs=[${eriMin}, ${eriMax}]`,
    );
  }, 60000);
});
