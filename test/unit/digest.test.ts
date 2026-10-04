import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex } from "@/lib/digest";

/**
 * Contrato del digest SHA-256 (test/unit/digest.test.ts)
 * Vectores oficiales FIPS 180-4 / NIST y paridad bit a bit con node:crypto,
 * para que el digest mostrado al usuario sea reproducible de forma independiente.
 */

const VECTORS: Array<[string, string]> = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
  [
    "The quick brown fox jumps over the lazy dog",
    "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
  ],
];

describe("sha256Hex", () => {
  it.each(VECTORS)("vector FIPS para %j", (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it("produce 64 caracteres hex en minúsculas", () => {
    expect(sha256Hex("Isabella")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("coincide con node:crypto en entradas UTF-8 reales", () => {
    const samples = [
      "Isabella Villaseñor AI — Nodo Cero, Real del Monte",
      "ñáéíóú ü ñÑ 中文 🌐",
      "x".repeat(55),
      "y".repeat(56),
      "z".repeat(63),
      "w".repeat(64),
      "v".repeat(65),
      "u".repeat(1000),
    ];
    for (const sample of samples) {
      const expected = createHash("sha256").update(sample, "utf8").digest("hex");
      expect(sha256Hex(sample), `mismatch para longitud ${sample.length}`).toBe(expected);
    }
  });

  it("coincide con node:crypto en bloques de 64 bytes exactos (caso límite de padding)", () => {
    for (let n = 0; n <= 200; n += 1) {
      const sample = "a".repeat(n);
      const expected = createHash("sha256").update(sample, "utf8").digest("hex");
      expect(sha256Hex(sample), `n=${n}`).toBe(expected);
    }
  });
});
