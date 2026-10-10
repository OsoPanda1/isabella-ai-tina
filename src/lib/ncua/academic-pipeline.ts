/**
 * NCUA v2.0 — Academic Pipeline (FGAIS).
 *
 * Pipeline síncrono 6 pasos:
 *   1. Perceive — normalización y gate de entrada vacía.
 *   2. Tokenless byte patching — parches dinámicos por entropía.
 *   3. SOPHIA epistemics — clasificación E0–E4 + filtros de sesgo.
 *   4. ERI gate — Índice de Robustez Epistémica con refinado iterativo.
 *   5. QUP quantum alignment — Parameter-Shift + sello Merkle SHA3-512.
 *   6. BookPI audit — cadena append-only HMAC-SHA3-512 + Merkle root.
 *
 * Si el ERI permanece debajo del umbral (≥ 95) tras el refinado, el
 * pipeline se detiene en SOVCON_HALT. El registro BookPI requiere una
 * clave de firma; si no está disponible, se omite con advertencia.
 */

import {
  ByteEntropyPatcher,
  averagePatchEntropy,
  estimateTokensAfterPatching,
  NCUA_ENTROPY_THRESHOLD,
  NCUA_WINDOW_BYTES,
} from "./entropy-patcher";
import type { BytePatch } from "./entropy-patcher";
import { ContinuousConceptEngine, type ContinuousConceptVector } from "./concept-engine";
import { QUPQuantumBridgeIntegrator, type QUPQuantumStateSignature } from "./quantum-align";
import {
  BookPILedgerAuditor,
  type BookPILedgerEntry,
  type LedgerIntegrityReport,
} from "./bookpi-trajectory";
import { classifySophiaLevel, type SophiaClassification } from "./sophia-epistemics";
import {
  computeEri,
  detectSycophancy,
  detectTerritorialDrift,
  ERI_MIN_SCORE,
  isEriCompliant,
  type EriBreakdown,
  type EriResult,
} from "./eri";

export type NcuaPipelineStatus = "SUCCESS" | "SOVCON_HALT" | "FAIL_CLOSED";

export interface NcuaArgumentationStep {
  step: string;
  detail: string;
}

export interface NcuaBoundaryCondition {
  limit: string;
  detail: string;
}

export interface NcuaRefinementRecord {
  threshold: number;
  avgEntropy: number;
  eri: number;
  compliant: boolean;
}

export interface NcuaAcademicOutput {
  status: NcuaPipelineStatus;
  haltingReason: string | null;
  rawInputLengthBytes: number;
  bytePatchesGenerated: number;
  continuousConceptsProcessed: number;
  epistemicRobustnessIndex: number;
  eriBreakdown: EriBreakdown;
  evidence: { level: number; label: string; score: number; observances: string[] };
  qupQuantumSignature: QUPQuantumStateSignature;
  bookpiLedgerRecord: BookPILedgerEntry | null;
  ledgerIntegrity: LedgerIntegrityReport | null;
  continuousLatentSummary: string;
  thesis: string;
  argumentation: NcuaArgumentationStep[];
  boundaryConditions: NcuaBoundaryCondition[];
  refinementAttempts: number;
  refinementTrajectory: NcuaRefinementRecord[];
  conceptTrajectoryHash: string;
}

export interface NCUAProcessingResult {
  status: NcuaPipelineStatus;
  rawInputLengthBytes: number;
  bytePatchesGenerated: number;
  continuousConceptsProcessed: number;
  epistemicRobustnessIndex: number;
  qupQuantumSignature: QUPQuantumStateSignature;
  bookpiLedgerRecord: BookPILedgerEntry;
  continuousLatentSummary: string;
}

export interface NcuaAcademicPipelineOptions {
  hmacKey?: string;
  entropyThresholds?: number[];
  maxRefinements?: number;
  latentDimensions?: number;
}

function uniqueOrderedThresholds(thresholds: number[]): number[] {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const threshold of thresholds) {
    if (seen.has(threshold)) continue;
    seen.add(threshold);
    unique.push(threshold);
  }
  return unique;
}

export class NCUAAcademicPipeline {
  private readonly hmacKey: string | undefined;
  private readonly entropyThresholds: number[];
  private readonly maxRefinements: number;
  private readonly latentDimensions: number;

  constructor(options: NcuaAcademicPipelineOptions = {}) {
    this.hmacKey = options.hmacKey;
    this.entropyThresholds = options.entropyThresholds ?? [NCUA_ENTROPY_THRESHOLD];
    this.maxRefinements =
      options.maxRefinements ?? uniqueOrderedThresholds(this.entropyThresholds).length;
    this.latentDimensions = options.latentDimensions ?? 8;
  }

  private failClosed(haltingReason: string): NcuaAcademicOutput {
    return {
      status: "FAIL_CLOSED",
      haltingReason,
      rawInputLengthBytes: 0,
      bytePatchesGenerated: 0,
      continuousConceptsProcessed: 0,
      epistemicRobustnessIndex: 0,
      eriBreakdown: {
        entropyPenalty: 0,
        fragmentationPenalty: 0,
        biasPenalty: 0,
        evidenceBonus: 0,
      },
      evidence: { level: 0, label: "", score: 0, observances: [] },
      qupQuantumSignature: {
        qubitAmplitudes: [],
        entanglementEntropy: 0,
        parameterShiftGradient: 0,
        merkleSeal: "",
      },
      bookpiLedgerRecord: null,
      ledgerIntegrity: null,
      continuousLatentSummary: "",
      thesis: "",
      argumentation: [],
      boundaryConditions: [],
      refinementAttempts: 0,
      refinementTrajectory: [],
      conceptTrajectoryHash: "",
    };
  }

  private sovconHalt(
    rawBytes: Uint8Array,
    patches: BytePatch[],
    evidence: SophiaClassification,
    result: EriResult,
    trajectory: NcuaRefinementRecord[],
    concept: ContinuousConceptVector,
  ): NcuaAcademicOutput {
    return {
      status: "SOVCON_HALT",
      haltingReason: `SOVCON_HALT: ERI ${result.eri} debajo del umbral ${ERI_MIN_SCORE} tras ${trajectory.length} intentos de refinado.`,
      rawInputLengthBytes: rawBytes.length,
      bytePatchesGenerated: patches.length,
      continuousConceptsProcessed: 1,
      epistemicRobustnessIndex: result.eri,
      eriBreakdown: result.breakdown,
      evidence: {
        level: evidence.level,
        label: evidence.label,
        score: evidence.score,
        observances: evidence.observances.flatMap((obs) => obs.matches),
      },
      qupQuantumSignature: {
        qubitAmplitudes: [],
        entanglementEntropy: 0,
        parameterShiftGradient: 0,
        merkleSeal: "",
      },
      bookpiLedgerRecord: null,
      ledgerIntegrity: null,
      continuousLatentSummary: `Concatenación de ${patches.length} parches binarios en espacio latente contiguo.`,
      thesis: "",
      argumentation: [],
      boundaryConditions: [],
      refinementAttempts: trajectory.length,
      refinementTrajectory: trajectory,
      conceptTrajectoryHash: concept.conceptId,
    };
  }

  public execute(text: string, tenantId = "nodo_cero_real_del_monte"): NcuaAcademicOutput {
    const trimmed = text.trim();
    if (trimmed.length === 0) return this.failClosed("PERCEIVE: entrada vacía tras normalización.");
    const rawBytes = new TextEncoder().encode(trimmed);
    const evidence = classifySophiaLevel(trimmed);
    const sycophancy = detectSycophancy(trimmed);
    const drift = detectTerritorialDrift(trimmed);

    const thresholds = uniqueOrderedThresholds(this.entropyThresholds);
    const trajectory: NcuaRefinementRecord[] = [];
    let bestPatches: BytePatch[] = [];
    let bestAvgEntropy = 0;
    let bestEri = 0;
    let bestEriResult: EriResult = computeEri({
      avgEntropy: 0,
      inputBytes: rawBytes.length,
      patchCount: 0,
      evidenceLevel: evidence.level,
      sycophancyDetected: sycophancy.detected,
      territorialDriftDetected: drift.detected,
    });
    let refinementAttempts = 0;

    for (const threshold of thresholds) {
      if (refinementAttempts >= this.maxRefinements) break;
      refinementAttempts++;
      const patcher = new ByteEntropyPatcher({
        windowSize: NCUA_WINDOW_BYTES,
        entropyThreshold: threshold,
      });
      const patches = patcher.segmentIntoBytePatches(trimmed);
      const avgEntropy = averagePatchEntropy(patches);
      const eriResult = computeEri({
        avgEntropy,
        inputBytes: rawBytes.length,
        patchCount: patches.length,
        evidenceLevel: evidence.level,
        sycophancyDetected: sycophancy.detected,
        territorialDriftDetected: drift.detected,
      });
      trajectory.push({
        threshold,
        avgEntropy,
        eri: eriResult.eri,
        compliant: eriResult.compliant,
      });
      bestPatches = patches;
      bestAvgEntropy = avgEntropy;
      bestEri = eriResult.eri;
      bestEriResult = eriResult;
      if (eriResult.compliant) break;
    }

    const concept = new ContinuousConceptEngine(this.latentDimensions).projectToContinuousConcept(
      bestPatches,
    );

    if (!isEriCompliant(bestEri)) {
      return this.sovconHalt(rawBytes, bestPatches, evidence, bestEriResult, trajectory, concept);
    }

    const quantum = new QUPQuantumBridgeIntegrator().executeQuantumStateAlignment(concept);

    let ledgerRecord: BookPILedgerEntry | null = null;
    let ledgerIntegrity: LedgerIntegrityReport | null = null;
    const resolvedHmacKey = this.hmacKey ?? null;
    if (resolvedHmacKey) {
      const ledger = new BookPILedgerAuditor({ hmacKey: resolvedHmacKey });
      ledgerRecord = ledger.recordNCUATransaction(tenantId, bestPatches.length, concept, quantum);
      ledgerIntegrity = ledger.verifyIntegrity();
    }

    const estimatedTokens = estimateTokensAfterPatching(bestPatches);
    const conceptHash = concept.conceptId;
    const merkleRoot = ledgerRecord?.merkleRoot ?? "0".repeat(128);
    const thesis = `Percepción NCUA v2.0: ${bestPatches.length} parches binarios sobre ${rawBytes.length} bytes en espacio latente continuo de ${this.latentDimensions} dimensiones; participación QUP v3.0 ${quantum.entanglementEntropy.toFixed(4)}; sello Merkle ${merkleRoot.slice(0, 16)}… (anclado a BookPI ${ledgerRecord?.entryId ?? "pendiente"}).`;

    const argumentation: NcuaArgumentationStep[] = [
      { step: "Perceive", detail: `Entrada normalizada: ${rawBytes.length} bytes, UTF-8.` },
      {
        step: "Tokenless byte patching",
        detail: `Generación de ${bestPatches.length} parches dinámicos con H_opt ∈ [${ERI_MIN_SCORE >= 95 ? "1.8" : "1.55"}…2.05]; tokens estimados ≈ ${estimatedTokens}.`,
      },
      {
        step: "SOPHIA epistemics",
        detail: `Nivel epistemológico ${evidence.label} (E${evidence.level}, score ${evidence.score}); ${evidence.observances.length} observaciones.`,
      },
      {
        step: "ERI gate",
        detail: `ERI final = ${bestEri}/100 tras ${refinementAttempts} refinados; umbral ${ERI_MIN_SCORE}.`,
      },
      {
        step: "QUP quantum alignment",
        detail: `Alineación variacional con parámetro-shift; entanglement entropy = ${quantum.entanglementEntropy.toFixed(4)}; merkle seal = ${quantum.merkleSeal.slice(0, 24)}…`,
      },
      {
        step: "BookPI immutable audit",
        detail: ledgerRecord
          ? `Registro ${ledgerRecord.entryId} en cadena append-only; Merkle root = ${ledgerRecord.merkleRoot.slice(0, 24)}…`
          : "Libro mayor BookPI no disponible (clave HMAC ausente).",
      },
    ];

    const boundaryConditions: NcuaBoundaryCondition[] = [
      {
        limit: "Alcance epistemológico",
        detail: `Las afirmaciones se limitan al nivel ${evidence.label}; más allá de la evidencia disponible no se promete certeza epistémica.`,
      },
      {
        limit: "Sin tokenizador externo",
        detail: `El pipeline opera sobre ${rawBytes.length} bytes crudos en ${bestPatches.length} parches ≈ ${estimatedTokens} tokens; no utiliza vocabulario BPE ni embeddings preprocesados.`,
      },
      {
        limit: "Entropía del corpus",
        detail: `La entropía promedio post-parcheo fue ${bestAvgEntropy.toFixed(2)} nat/byte (rango objetivo 1.8–2.0); los parches NCUA no modifican el texto fuente original.`,
      },
      {
        limit: "ERI compliance",
        detail: `ERI mínimo requerido: ${ERI_MIN_SCORE}; refinados ejecutados: ${refinementAttempts}; Umbral final: ${trajectory[trajectory.length - 1]?.threshold ?? "N/A"}.`,
      },
      {
        limit: "Filtros de sesgo",
        detail: `Sycophancy detectado: ${sycophancy.detected}; deriva territorial detectada: ${drift.detected}.`,
      },
    ];
    if (ledgerRecord) {
      boundaryConditions.push({
        limit: "Sello BookPI soberano",
        detail: `Entrada ${ledgerRecord.entryId} encadenada con SHA3-512 + HMAC-SHA3-512; raíz Merkle ${ledgerRecord.merkleRoot.slice(0, 32)}…`,
      });
    }

    return {
      status: "SUCCESS",
      haltingReason: null,
      rawInputLengthBytes: rawBytes.length,
      bytePatchesGenerated: bestPatches.length,
      continuousConceptsProcessed: 1,
      epistemicRobustnessIndex: bestEri,
      eriBreakdown: bestEriResult.breakdown,
      evidence: {
        level: evidence.level,
        label: evidence.label,
        score: evidence.score,
        observances: evidence.observances.flatMap((obs) => obs.matches),
      },
      qupQuantumSignature: quantum,
      bookpiLedgerRecord: ledgerRecord,
      ledgerIntegrity,
      continuousLatentSummary: `Concatenación de ${bestPatches.length} parches binarios en espacio latente contiguo. Vector de concepto: [${concept.latentDimensions.slice(0, 4).join(", ")}...]`,
      thesis,
      argumentation,
      boundaryConditions,
      refinementAttempts,
      refinementTrajectory: trajectory,
      conceptTrajectoryHash: conceptHash,
    };
  }
}

export class EvolvedNCUAEngine {
  private readonly pipeline: NCUAAcademicPipeline;

  constructor(hmacKey?: string) {
    this.pipeline = new NCUAAcademicPipeline({
      hmacKey,
      entropyThresholds: [NCUA_ENTROPY_THRESHOLD],
      maxRefinements: 1,
    });
  }

  public processInput(
    rawPrompt: string,
    tenantId = "nodo_cero_real_del_monte",
  ): NCUAProcessingResult {
    const result = this.pipeline.execute(rawPrompt, tenantId);
    if (!result.bookpiLedgerRecord) {
      throw new Error(
        "[EvolvedNCUAEngine] Libro mayor BookPI no disponible: proporcione hmacKey o AEGIS_AUDIT_SECRET.",
      );
    }
    return {
      status: result.status,
      rawInputLengthBytes: result.rawInputLengthBytes,
      bytePatchesGenerated: result.bytePatchesGenerated,
      continuousConceptsProcessed: result.continuousConceptsProcessed,
      epistemicRobustnessIndex: result.epistemicRobustnessIndex,
      qupQuantumSignature: result.qupQuantumSignature,
      bookpiLedgerRecord: result.bookpiLedgerRecord,
      continuousLatentSummary: result.continuousLatentSummary,
    };
  }
}
