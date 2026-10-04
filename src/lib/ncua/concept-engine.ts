/**
 * NCUA v2.0 — Concept Projection (JEPA / LCM).
 *
 * Proyecta los parches de bytes hacia un espacio latente continuo de conceptos
 * mediante agregación tensorial de vectores dispersos T-Free con normalización
 * hiper-superficial (tanh). El motor continuo calcula la confianza epistémica
 * usando el ERI canónico; el motor de tuning usa una curva gaussiana centrada
 * en H_opt = 1.9 para la selección de umbral.
 */

import * as crypto from "node:crypto";
import type { BytePatch } from "./entropy-patcher";
import { averagePatchEntropy, NCUA_ENTROPY_THRESHOLD } from "./entropy-patcher";
import { computeEri, ENTROPY_TARGET_MIN } from "./eri";

export interface ContinuousConceptVector {
  conceptId: string;
  latentDimensions: number[];
  semanticEnergy: number;
  epistemicConfidence: number;
}

export interface ConceptProjection {
  latentVector: number[];
  avgEntropy: number;
  eriScore: number;
}

export class ContinuousConceptEngine {
  private readonly latentDim: number;

  constructor(latentDim = 8) {
    this.latentDim = latentDim;
  }

  public projectToContinuousConcept(patches: BytePatch[]): ContinuousConceptVector {
    const latentVector: number[] = new Array(this.latentDim).fill(0);
    let totalEntropy = 0;
    let totalBytes = 0;
    for (const patch of patches) {
      totalEntropy += patch.entropy;
      totalBytes += patch.bytes.length;
      for (let d = 0; d < this.latentDim; d++) {
        latentVector[d] += patch.hashVector[d % patch.hashVector.length];
      }
    }
    const patchCount = Math.max(1, patches.length);
    for (let d = 0; d < this.latentDim; d++) {
      latentVector[d] = parseFloat(Math.tanh(latentVector[d] / patchCount).toFixed(4));
    }
    const avgEntropy = totalEntropy / patchCount;
    const eri = computeEri({
      avgEntropy,
      inputBytes: Math.max(1, totalBytes),
      patchCount,
      evidenceLevel: 0,
      sycophancyDetected: false,
      territorialDriftDetected: false,
    });
    const conceptId = `concept_${crypto
      .createHash("sha256")
      .update(latentVector.join("|"))
      .digest("hex")
      .slice(0, 8)}`;
    return {
      conceptId,
      latentDimensions: latentVector,
      semanticEnergy: parseFloat((avgEntropy * 0.42).toFixed(4)),
      epistemicConfidence: eri.eri,
    };
  }
}

export class TunableConceptEngine {
  private readonly latentDim: number;

  constructor(latentDim = 8) {
    this.latentDim = latentDim;
  }

  public projectToContinuousConcept(
    patches: BytePatch[],
    threshold = NCUA_ENTROPY_THRESHOLD,
  ): ConceptProjection {
    const latentVector: number[] = new Array(this.latentDim).fill(0);
    for (const patch of patches) {
      for (let d = 0; d < this.latentDim; d++) {
        latentVector[d] += patch.hashVector[d % patch.hashVector.length];
      }
    }
    const patchCount = Math.max(1, patches.length);
    for (let d = 0; d < this.latentDim; d++) {
      latentVector[d] = parseFloat(Math.tanh(latentVector[d] / patchCount).toFixed(4));
    }
    const avgEntropy = averagePatchEntropy(patches);
    const distanceToOptimum = Math.abs(threshold - ENTROPY_TARGET_MIN - 0.1);
    const eriGauss = 98 * Math.exp(-Math.pow(distanceToOptimum / 0.6, 2));
    const eriScore = Math.min(98, Math.max(50, Math.round(eriGauss)));
    return { latentVector, avgEntropy, eriScore };
  }
}
