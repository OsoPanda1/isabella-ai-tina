import { describe, expect, it } from "vitest";

import {
  ByteEntropyPatcher,
  TunableByteEntropyPatcher,
  calculateByteEntropy,
  generateSparseHashVector,
  averagePatchEntropy,
  NCUA_BYTES_PER_TOKEN_ESTIMATE,
  type BytePatch,
} from "@/lib/ncua/entropy-patcher";

describe("ncua:entropy-patcher", () => {
  it("calcula entropía de Shannon sobre bytes", () => {
    const uniform = new TextEncoder().encode("aaaa");
    const mixed = new TextEncoder().encode("abcd");
    expect(calculateByteEntropy(uniform)).toBe(0);
    expect(calculateByteEntropy(mixed)).toBeGreaterThan(1.9);
    expect(calculateByteEntropy(new Uint8Array(0))).toBe(0);
  });

  it("genera vectores dispersos deterministas de dimensión fija", () => {
    const a = generateSparseHashVector("test-text");
    const b = generateSparseHashVector("test-text");
    expect(a.length).toBe(16);
    expect(a).toStrictEqual(b);
    expect(a.every((v) => v >= -1 && v <= 1)).toBe(true);
  });

  it("id de parche determinista y formato estable", () => {
    const patcher = new ByteEntropyPatcher(4, 1.8);
    const patches = patcher.segmentIntoBytePatches("hola mundo");
    const a = patches.map((p) => p.id);
    const b = new ByteEntropyPatcher(4, 1.8).segmentIntoBytePatches("hola mundo").map((p) => p.id);
    expect(a).toStrictEqual(b);
    for (const id of a) {
      expect(id).toMatch(/^patch_\d+_[0-9a-f]{6}$/);
    }
  });

  it("promedio de entropía de parches", () => {
    const patches = [
      { entropy: 1.0 } as BytePatch,
      { entropy: 2.0 } as BytePatch,
      { entropy: 3.0 } as BytePatch,
    ];
    expect(averagePatchEntropy(patches)).toBe(2.0);
    expect(averagePatchEntropy([])).toBe(0);
  });

  it("estimación de tokens post-parcheo", () => {
    const bytesA = new Uint8Array(8).fill(0x41);
    const bytesB = new Uint8Array(4).fill(0x42);
    const patches = [
      { bytes: bytesA, entropy: calculateByteEntropy(bytesA) } as BytePatch,
      { bytes: bytesB, entropy: calculateByteEntropy(bytesB) } as BytePatch,
    ];
    expect(averagePatchEntropy(patches)).toBeGreaterThanOrEqual(0);
    expect(Math.round(12 / NCUA_BYTES_PER_TOKEN_ESTIMATE)).toBe(3);
  });

  it("constructores posicionales y de objeto son equivalentes", () => {
    const positional = new ByteEntropyPatcher(4, 1.8);
    const fromOptions = new ByteEntropyPatcher({ windowSize: 4, entropyThreshold: 1.8 });
    const text = "Simular escenario SOVCON 3 con aislamiento estricto.";
    expect(positional.segmentIntoBytePatches(text).length).toBe(
      fromOptions.segmentIntoBytePatches(text).length,
    );
  });

  it("alias TunableByteEntropyPatcher conserva la misma interfaz", () => {
    const patcher = new TunableByteEntropyPatcher(4, 1.8);
    expect(patcher.getEntropyThreshold()).toBe(1.8);
    expect(patcher.segmentIntoBytePatches("test").length).toBeGreaterThanOrEqual(1);
  });

  it("textos vacíos devuelven cero parches", () => {
    const patcher = new ByteEntropyPatcher();
    expect(patcher.segmentIntoBytePatches("")).toHaveLength(0);
  });
});
