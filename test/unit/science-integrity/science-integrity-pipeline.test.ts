/**
 * Science Integrity — B3: pipeline de decisión + rail Hypercore gobernado
 * -----------------------------------------------------------------------
 * Reglas de decisión del manual §4.2: agregación ponderada, umbrales 0.70/0.90,
 * banderas críticas y fail-closed. El rail Hypercore corre con adaptadores reales
 * y evidencia honesta (sin conectores, grounding=0 → evidencia no verifica).
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NCUAAcademicPipeline, type NcuaAcademicOutput } from "@/lib/ncua/academic-pipeline";
import {
  InMemoryScienceIntegrityStore,
  ScienceIntegrityLedger,
} from "@/lib/science-integrity/ledger";
import {
  runScienceIntegrityPipeline,
  SCIENCE_PIPELINE_VERSION,
} from "@/lib/science-integrity/pipeline";
import {
  AGGREGATE_AUTO_VERIFIED,
  AGGREGATE_HUMAN_REVIEW,
  DECISION_WAIGHTS,
} from "@/lib/science-integrity/contracts";
import {
  runScienceHypercoreVerify,
  createScienceIntegrityHypercoreAdapters,
} from "@/lib/science-integrity/hypercore";
import type { ScientificDocument } from "@/lib/science-integrity/contracts";

const ORCID = "0009-0008-5050-1539";

function buildDocument(overrides: Record<string, unknown> = {}): ScientificDocument {
  return {
    schema: "isabella.scientific-document.v1",
    docId: "doc-pipe-0001",
    title: "Muestreo hidrológico auditado de Real del Monte",
    authors: [{ name: "Edwin Oswaldo Castillo Trejo", orcid: ORCID }],
    domains: ["territorial"],
    abstract:
      "Protocolo de muestreo de manantiales con registro cronológico, sellado hash y " +
      "reproducibilidad en sandbox; los datos abiertos se publican sin alteraciones.",
    claims: [
      {
        assertionId: "123e4567-e89b-12d3-a456-426614174000",
        assertion: "El protocolo de muestreo es reproducible y auditable.",
        citedSources: [{ sourceType: "doi", value: "10.5281/zenodo.20606361" }],
      },
    ],
    artifacts: [
      { artifactId: "a1", name: "muestras.csv", mimeType: "text/csv", content: "id,pH\n1,7.2" },
    ],
    createdAt: "2026-10-03T10:00:00Z",
    tenantId: "nodo_cero_real_del_monte",
    ...overrides,
  };
}

class StubNcua extends NCUAAcademicPipeline {
  private readonly eri: number;
  private readonly halted: boolean;

  constructor(eri: number, halted = false) {
    super();
    this.eri = eri;
    this.halted = halted;
  }

  override execute(): NcuaAcademicOutput {
    return {
      status: this.halted ? "SOVCON_HALT" : "SUCCESS",
      haltingReason: this.halted ? "stub" : null,
      rawInputLengthBytes: 3,
      bytePatchesGenerated: 1,
      continuousConceptsProcessed: 1,
      epistemicRobustnessIndex: this.eri,
      eriBreakdown: { entropyPenalty: 0, fragmentationPenalty: 0, biasPenalty: 0, evidenceBonus: 0 },
      evidence: {
        level: this.halted ? 0 : 2,
        label: this.halted ? "E4" : "E1",
        score: this.halted ? 0 : 80,
        observances: [],
      },
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
}

function makeRuntime(
  ledger: ScienceIntegrityLedger,
  ncua: NCUAAcademicPipeline,
) {
  return { ledger, ncua };
}

describe("Science Integrity B3 — reglas de decisión (§4.2)", () => {
  it("los pesos suman 1.0 y los umbrales son estrictos", () => {
    const sum =
      DECISION_WAIGHTS.similarity +
      DECISION_WAIGHTS.refResolution +
      DECISION_WAIGHTS.repro +
      DECISION_WAIGHTS.statistics +
      DECISION_WAIGHTS.nlpClaims;
    expect(sum).toBeCloseTo(1.0, 6);
    expect(AGGREGATE_HUMAN_REVIEW).toBe(0.7);
    expect(AGGREGATE_AUTO_VERIFIED).toBe(0.9);
    expect(AGGREGATE_HUMAN_REVIEW).toBeLessThan(AGGREGATE_AUTO_VERIFIED);
  });

  it("con grounding perfecto y señales externas altas el agregado alcanza AUTO", () => {
    const aggregate =
      DECISION_WAIGHTS.similarity * (1 - 0.02) +
      DECISION_WAIGHTS.refResolution * 1.0 +
      DECISION_WAIGHTS.repro * 1.0 +
      DECISION_WAIGHTS.statistics * 1.0 +
      DECISION_WAIGHTS.nlpClaims * 1.0;
    expect(aggregate).toBeGreaterThanOrEqual(AGGREGATE_AUTO_VERIFIED);
  });

  it("señales externas completas y altas → revisión humana (no AUTO sin grounding)", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const result = await runScienceIntegrityPipeline(
      {
        document: buildDocument(),
        verification: { similarityIndex: 0.05, refResolutionRate: 1, reproScore: 1, statisticsPassRate: 1 },
      },
      makeRuntime(ledger, new StubNcua(100)),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schema).toBe(SCIENCE_PIPELINE_VERSION);
    expect(result.value.path).toBe("HUMAN_REVIEW");
    expect(result.value.status).toBe("PENDING_HUMAN_REVIEW");
    expect(result.value.provisionalLevel).toBe(3);
    expect(result.value.decision.missingSignals).toHaveLength(0);
    expect(result.value.aggregateScore).toBeGreaterThanOrEqual(AGGREGATE_HUMAN_REVIEW);
    expect(result.value.aggregateScore).toBeLessThan(AGGREGATE_AUTO_VERIFIED);

    const events = await ledger.history("doc-pipe-0001");
    expect(events.map((event) => event.eventType)).toEqual([
      "ingest_event",
      "verification_event",
      "verification_event",
      "pipeline_run",
    ]);
    const integrity = await ledger.verifyChain();
    expect(integrity.valid).toBe(true);
  });

  it("sin señales externas → REJECTED_INSUFFICIENT_SIGNALS (fail-closed)", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const result = await runScienceIntegrityPipeline(
      { document: buildDocument() },
      makeRuntime(ledger, new StubNcua(100)),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("REJECTED_INSUFFICIENT_SIGNALS");
    expect(result.value.path).toBe("REJECTED");
    expect(result.value.provisionalLevel).toBe(0);
    expect(result.value.decision.missingSignals.sort()).toEqual([
      "refResolutionRate",
      "reproScore",
      "similarityIndex",
      "statisticsPassRate",
    ]);
  });

  it("bandera crítica de similitud → REJECTED_EVIDENCE", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const result = await runScienceIntegrityPipeline(
      {
        document: buildDocument(),
        verification: { similarityIndex: 0.4, refResolutionRate: 1, reproScore: 1, statisticsPassRate: 1 },
      },
      makeRuntime(ledger, new StubNcua(100)),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("REJECTED_EVIDENCE");
    expect(result.value.path).toBe("REJECTED");
    expect(result.value.provisionalLevel).toBe(0);
    expect(result.value.decision.criticalFlags[0]).toContain("SIMILARITY_INDEX=0.400");
  });

  it("NCUA ERI en halt → REJECTED_EVIDENCE sin importar las señales", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const result = await runScienceIntegrityPipeline(
      {
        document: buildDocument(),
        verification: { similarityIndex: 0.05, refResolutionRate: 1, reproScore: 1, statisticsPassRate: 1 },
      },
      makeRuntime(ledger, new StubNcua(40, true)),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("REJECTED_EVIDENCE");
    expect(result.value.components.eri.halted).toBe(true);
  });

  it("rechaza documento inválido antes de tocar el ledger", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const result = await runScienceIntegrityPipeline(
      { document: buildDocument({ schema: "bogus" }) },
      makeRuntime(ledger, new StubNcua(100)),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.startsWith("invalid_scientific_document")).toBe(true);
    expect(await ledger.history()).toHaveLength(0);
  });
});

describe("Science Integrity B3 — rail Hypercore gobernado", () => {
  it("corre el flujo completo y falla cerrado sin adaptadores de evidencia", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const request = {
      requestId: `req_${randomUUID()}`,
      tenantId: "nodo_cero_real_del_monte",
      userId: "test-principal",
      prompt: JSON.stringify(buildDocument()),
      risk: "medium",
      deadlineMs: 20000,
      maxOutputTokens: 4000,
      allowSpeculativeDraft: false,
    };
    const result = await runScienceHypercoreVerify(
      request,
      { ledger, ncua: new NCUAAcademicPipeline() },
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.checks.evidence.ok).toBe(false);
    expect(result.checks.input.ok).toBe(true);
    // Sin conectores, el pipeline escribió sus 4 eventos y NINGUNA duplicación.
    expect(await ledger.history()).toHaveLength(4);
    const integrity = await ledger.verifyChain();
    expect(integrity.valid).toBe(true);
  });

  it("el memo evita duplicar la corrida del pipeline en el ledger", async () => {
    const ledger = new ScienceIntegrityLedger(new InMemoryScienceIntegrityStore());
    const request = {
      requestId: `req_${randomUUID()}`,
      tenantId: "nodo_cero_real_del_monte",
      prompt: JSON.stringify(buildDocument()),
      risk: "medium",
      deadlineMs: 20000,
    };
    const { adapters, memo } = createScienceIntegrityHypercoreAdapters({
      ledger,
      ncua: new NCUAAcademicPipeline(),
    });
    await adapters.generate(request, [], new AbortController().signal, "CRUISE", {
      schema: "isabella.hypercore.decision.v1",
      mode: "CRUISE",
      turbos: [],
      activatedNitro: [],
      mandatoryGateRequired: true,
      earlyExitAllowed: false,
      governanceInvariant: "PRESERVED",
      reason: "test",
    });
    await adapters.generate(request, [], new AbortController().signal, "CRUISE", {
      schema: "isabella.hypercore.decision.v1",
      mode: "CRUISE",
      turbos: [],
      activatedNitro: [],
      mandatoryGateRequired: true,
      earlyExitAllowed: false,
      governanceInvariant: "PRESERVED",
      reason: "test",
    });
    expect(memo.get(request.requestId)).toBeDefined();
    expect(await ledger.history()).toHaveLength(4);
  });
});