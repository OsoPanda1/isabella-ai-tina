/**
 * Science Integrity — B1: nlp_claims sobre claim-radar + B2: clasificadores native-ml
 * -----------------------------------------------------------------------------------
 * Los 100 casos de contrato ejecutan el evaluador REAL con adapterIds vacíos: la
 * recuperación sin adaptadores es "unavailable" honesta (retrieval ≠ proof).
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { verifyNlpClaims, CLAIMS_EVALUATOR_VERSION } from "@/lib/science-integrity/claims";
import { evaluateNativeMlSignals, NATIVE_ML_SIGNALS_VERSION } from "@/lib/science-integrity/classifiers";
import { parseScientificDocument, type ScientificDocument } from "@/lib/science-integrity/contracts";

const ORCID = "0009-0008-5050-1539";

function buildDocument(claims: Array<{ assertionId: string; assertion: string }>): ScientificDocument {
  return {
    schema: "isabella.scientific-document.v1",
    docId: "doc-claims-0001",
    title: "Corpus de afirmaciones territoriales de prueba",
    authors: [{ name: "Edwin Oswaldo Castillo Trejo", orcid: ORCID }],
    domains: ["territorial"] as const,
    abstract:
      "Corpus sintético para ejercitar el verificador nlp_claims sin conectores externos: " +
      "cada afirmación se evalúa contra evidencia y se clasifica su estado epistémico.",
    claims: claims.map((claim) => ({
      ...claim,
      citedSources: [{ sourceType: "doi", value: "10.5281/zenodo.20606361" }],
    })),
    artifacts: [],
    createdAt: "2026-10-02T10:00:00Z",
    tenantId: "nodo_cero_real_del_monte",
  };
}

describe("Science Integrity B1 — contrato nlp_claims (100 casos)", () => {
  it("evalúa 100 afirmaciones sin adaptadores: todas unavailable, grounding 0", async () => {
    const claims = Array.from({ length: 100 }, (_, index) => ({
      assertionId: randomUUID(),
      assertion: `Afirmación contractual ${index + 1}: la procedencia archivística es auditable.`,
    }));
    const doc = buildDocument(claims);
    const result = await verifyNlpClaims(doc, { adapterIds: [], concurrency: 6, maxResults: 5 });

    expect(result.docId).toBe(doc.docId);
    expect(result.summary.checked).toBe(100);
    expect(result.summary.unavailable).toBe(100);
    expect(result.summary.supports).toBe(0);
    expect(result.summary.contradicts).toBe(0);
    expect(result.summary.insufficient).toBe(0);
    expect(result.groundingScore).toBe(0);
    expect(result.evaluatorVersion).toBe(CLAIMS_EVALUATOR_VERSION);
    expect(result.verifiedClaims).toHaveLength(100);

    for (const item of result.verifiedClaims) {
      expect(item.status).toBe("unavailable");
      expect(item.confidence).toBe(0);
    }
  });

  it("el contrato rechaza más de 100 claims (cota máxima)", () => {
    const claims = Array.from({ length: 101 }, (_, index) => ({
      assertionId: randomUUID(),
      assertion: `claim ${index}`,
    }));
    const doc = buildDocument(claims);
    const parsed = parseScientificDocument(doc);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason.startsWith("invalid_scientific_document")).toBe(true);
  });

  it("evalúa documento de 1 afirmación y reporta checked=1", async () => {
    const doc = buildDocument([
      { assertionId: randomUUID(), assertion: "Una afirmación con procedencia." },
    ]);
    const result = await verifyNlpClaims(doc, { adapterIds: [] });
    expect(result.summary.checked).toBe(1);
    expect(result.verifiedClaims[0]!.status).toBe("unavailable");
  });
});

describe("Science Integrity B2 — clasificadores native-ml", () => {
  it("devuelve señales ML con riesgo en [0,1] y metadatos de versión", () => {
    const signals = evaluateNativeMlSignals({
      abstract: "Estudio territorial de procedencia documental hídrica.",
      claims: [
        {
          assertionId: randomUUID(),
          assertion: "Los datos abiertos conservan integridad.",
          citedSources: [],
        },
      ],
      artifactContents: ["datos abiertos con integridad hash"],
      domains: ["territorial"],
    });
    expect(signals.textRisk.riskScore).toBeGreaterThanOrEqual(0);
    expect(signals.textRisk.riskScore).toBeLessThanOrEqual(1);
    expect(typeof signals.modelId).toBe("string");
    expect(signals.drift.triggered).toBe(false);
    expect(signals.fairness.passed).toBe(true);
  });

  it("plagiarismSuspicion sube cuando abstract ≈ contenido del artefacto", () => {
    const shared = "memoria territorial de real del monte con procedencia archivistica";
    const high = evaluateNativeMlSignals({
      abstract: shared,
      claims: [],
      artifactContents: [shared, "más texto que se repite con la memoria territorial"],
      domains: ["academic"],
    });
    const low = evaluateNativeMlSignals({
      abstract: "hipótesis sobre mineralogía de sulfuros en yacimientos profundos",
      claims: [],
      artifactContents: ["receta de pan casero con harina integral y levadura fresca"],
      domains: ["academic"],
    });
    expect(high.plagiarismSuspicion).toBeGreaterThan(low.plagiarismSuspicion);
    expect(low.plagiarismSuspicion).toBe(0);
  });

  it("citationCoverage mide fracción de afirmaciones con fuente citada", () => {
    const signals = evaluateNativeMlSignals({
      abstract: "texto",
      claims: [
        { assertionId: randomUUID(), assertion: "a", citedSources: [{ sourceType: "doi", value: "10.x/1" }] },
        { assertionId: randomUUID(), assertion: "b", citedSources: [] },
        { assertionId: randomUUID(), assertion: "c", citedSources: [{ sourceType: "isbn", value: "978-1-000" }] },
      ],
      artifactContents: [],
      domains: ["academic"],
    });
    expect(signals.citationCoverage).toBeCloseTo(2 / 3, 6);
  });

  it("detectDrift señala deriva cuando el baseline difiere del actual", () => {
    const withBaseline = evaluateNativeMlSignals({
      abstract: "análisis de series temporales climatológicas",
      claims: [],
      artifactContents: [],
      domains: ["academic", "technical"],
      baseline: [0.2, 0.9],
    });
    expect(withBaseline.drift.triggered).toBe(true);
  });

  it("expone versión estable de señales (isabella.native-ml.v1)", () => {
    expect(NATIVE_ML_SIGNALS_VERSION).toBe("isabella.native-ml.v1");
  });
});