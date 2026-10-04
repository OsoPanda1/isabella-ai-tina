/**
 * NCUA v2.0 — Byte Entropy Patcher (tokenless).
 *
 * Segmenta texto crudo (UTF-8) en parches dinámicos gobernados por entropía de
 * Shannon sobre ventanas de bytes, sin vocabulario BPE ni tokenizador externo.
 * Derivación espacial T-Free: vector hash disperso determinista por parche.
 */

import * as crypto from "node:crypto";

export interface BytePatch {
  id: string;
  bytes: Uint8Array;
  rawText: string;
  entropy: number;
  boundaryType: "LOW_ENTROPY" | "HIGH_ENTROPY_BOUNDARY" | "CONCEPT_SHIFT";
  hashVector: number[];
}

export const NCUA_WINDOW_BYTES = 4;
export const NCUA_ENTROPY_THRESHOLD = 1.8;
export const NCUA_BYTES_PER_TOKEN_ESTIMATE = 4;

export function calculateByteEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const frequencies = new Map<number, number>();
  for (const byte of bytes) {
    frequencies.set(byte, (frequencies.get(byte) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / bytes.length;
    entropy -= probability * Math.log2(probability);
  }
  return parseFloat(entropy.toFixed(4));
}

export function generateSparseHashVector(text: string, dimensions = 16): number[] {
  const digest = crypto.createHash("sha256").update(text).digest();
  const vector: number[] = new Array(dimensions).fill(0);
  for (let i = 0; i < dimensions; i++) {
    const byteValue = digest[i % digest.length];
    vector[i] = parseFloat((byteValue / 127.5 - 1).toFixed(4));
  }
  return vector;
}

export function averagePatchEntropy(patches: readonly BytePatch[]): number {
  if (patches.length === 0) return 0;
  let total = 0;
  for (const patch of patches) {
    if (Number.isFinite(patch.entropy)) total += patch.entropy;
  }
  return parseFloat((total / patches.length).toFixed(4));
}

export function estimateTokensAfterPatching(patches: readonly BytePatch[]): number {
  const totalBytes = patches.reduce((sum, patch) => sum + patch.bytes.length, 0);
  return Math.round(totalBytes / NCUA_BYTES_PER_TOKEN_ESTIMATE);
}

export interface ByteEntropyPatcherOptions {
  windowSize?: number;
  entropyThreshold?: number;
}

export class ByteEntropyPatcher {
  private readonly windowSize: number;
  private readonly entropyThreshold: number;

  constructor(
    windowSizeOrOptions: number | ByteEntropyPatcherOptions = NCUA_WINDOW_BYTES,
    entropyThreshold = NCUA_ENTROPY_THRESHOLD,
  ) {
    this.windowSize =
      typeof windowSizeOrOptions === "number"
        ? windowSizeOrOptions
        : (windowSizeOrOptions.windowSize ?? NCUA_WINDOW_BYTES);
    this.entropyThreshold =
      typeof windowSizeOrOptions === "number"
        ? entropyThreshold
        : (windowSizeOrOptions.entropyThreshold ?? NCUA_ENTROPY_THRESHOLD);
  }

  public getWindowSize(): number {
    return this.windowSize;
  }

  public getEntropyThreshold(): number {
    return this.entropyThreshold;
  }

  public segmentIntoBytePatches(input: string): BytePatch[] {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8");
    const rawBytes = encoder.encode(input);
    const patches: BytePatch[] = [];
    let currentPatchBytes: number[] = [];
    const maxPatchLen = Math.max(4, Math.min(32, Math.round(this.entropyThreshold * 6)));

    for (let i = 0; i < rawBytes.length; i++) {
      currentPatchBytes.push(rawBytes[i]);
      const windowStart = Math.max(0, i - this.windowSize + 1);
      const currentWindow = Uint8Array.from(rawBytes.slice(windowStart, i + 1));
      const entropy = calculateByteEntropy(currentWindow);

      const isBoundary =
        (entropy >= this.entropyThreshold && currentPatchBytes.length >= 2) ||
        rawBytes[i] === 32 ||
        i === rawBytes.length - 1;

      if (isBoundary || currentPatchBytes.length >= maxPatchLen) {
        const patchBytes = Uint8Array.from(currentPatchBytes);
        const patchText = decoder.decode(patchBytes);
        const idSuffix = crypto.createHash("sha256").update(patchText).digest("hex").slice(0, 6);
        patches.push({
          id: `patch_${patches.length}_${idSuffix}`,
          bytes: patchBytes,
          rawText: patchText,
          entropy,
          boundaryType: entropy >= this.entropyThreshold ? "HIGH_ENTROPY_BOUNDARY" : "LOW_ENTROPY",
          hashVector: generateSparseHashVector(patchText),
        });
        currentPatchBytes = [];
      }
    }

    return patches;
  }
}

export { ByteEntropyPatcher as TunableByteEntropyPatcher };
