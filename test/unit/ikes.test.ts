import { describe, expect, it } from "vitest";
import {
  classifyDocument,
  createDocumentIdentity,
  evaluateAdmission,
  filterKnowledgeClaims,
  sanitizeKnowledgeContent,
} from "@/lib/ikes";

const base = { id: "doc-1", title: "Programa X", domain: "product", topic: "capabilities" };

describe("IKES knowledge identity", () => {
  it("preserves a changed version as enrichment instead of deleting it", () => {
    const first = createDocumentIdentity({
      ...base,
      content: "Soporta 12 idiomas",
      version: "1.0",
    });
    const second = createDocumentIdentity({
      ...base,
      id: "doc-2",
      content: "Soporta 47 idiomas y traducción simultánea",
      version: "2.0",
    });
    const result = classifyDocument(second, [first]);
    expect(result.decision).toBe("UPDATE");
    expect(result.entityId).toBe(result.document.entityId);
  });

  it("detects exact binary duplicates", () => {
    const first = createDocumentIdentity({ ...base, content: "same" });
    const second = createDocumentIdentity({ ...base, id: "doc-2", content: "same" });
    expect(classifyDocument(second, [first]).decision).toBe("EXACT_DUPLICATE");
  });
});

describe("IKES admission and retrieval", () => {
  it("requires independent corroboration before validation", () => {
    const claim = {
      id: "claim-1",
      entityId: "entity-1",
      statement: "A fact",
      type: "FACT" as const,
      temporalStatus: "current" as const,
      sourceDocumentIds: ["doc-1"],
      evidenceLevel: "primary" as const,
    };
    const sources = [{ id: "s1", type: "OFFICIAL_DOC" as const, publisher: "A", verified: true }];
    expect(evaluateAdmission({ claim, sources }).status).toBe("PENDING");
    expect(
      evaluateAdmission({
        claim,
        sources: [...sources, { ...sources[0], id: "s2", publisher: "B" }],
      }).status,
    ).toBe("CORROBORATED");
  });

  it("filters current claims by temporal validity", () => {
    const claims = [
      {
        id: "c",
        entityId: "e",
        statement: "old",
        type: "FACT" as const,
        status: "VALIDATED" as const,
        temporalStatus: "historical" as const,
        validFrom: "2024-01-01",
        validUntil: "2025-01-01",
        sourceDocumentIds: [],
        evidenceLevel: "primary" as const,
        confidenceScore: 0.9,
      },
    ];
    expect(filterKnowledgeClaims(claims, { asOf: "2026-01-01" })).toHaveLength(0);
  });
});

describe("IKES sanitization", () => {
  it("redacts credentials while preserving surrounding meaning", () => {
    const result = sanitizeKnowledgeContent("Usa API_KEY=super-secret para el servicio.");
    expect(result.redactions).toBe(1);
    expect(result.content).toContain("[REDACTED_SECRET]");
    expect(result.content).toContain("para el servicio");
  });
});
