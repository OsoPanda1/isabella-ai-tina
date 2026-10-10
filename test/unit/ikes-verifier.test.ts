import { describe, expect, it } from "vitest";
import { verifyKnowledgeGraph } from "@/lib/ikes";

const document = {
  id: "doc-1",
  title: "X",
  domain: "product",
  topic: "capabilities",
  retrievalDate: "2026-10-06",
  hash: { sha256: "hash-1" },
  structuralFingerprint: "struct-1",
  semanticFingerprint: "semantic-1",
  entityId: "entity-1",
} as const;
const entity = {
  id: "entity-1",
  title: "X",
  domain: "product",
  topic: "capabilities",
  documentIds: ["doc-1"],
  claimIds: ["claim-1"],
  currentVersion: "1.0.0",
} as const;

it("fails closed when knowledge graph references are broken", () => {
  const result = verifyKnowledgeGraph(
    [document],
    [entity],
    [
      {
        id: "claim-1",
        entityId: "entity-1",
        statement: "X",
        type: "FACT",
        status: "VALIDATED",
        temporalStatus: "current",
        sourceDocumentIds: ["missing"],
        evidenceLevel: "primary",
        confidenceScore: 0.9,
      },
    ],
  );
  expect(result.pass).toBe(false);
  expect(result.findings).toContain("claim_source_missing:claim-1");
});

describe("IKES verifier", () => {
  it("passes a consistent graph", () => {
    const result = verifyKnowledgeGraph(
      [document],
      [entity],
      [
        {
          id: "claim-1",
          entityId: "entity-1",
          statement: "X",
          type: "FACT",
          status: "VALIDATED",
          temporalStatus: "current",
          sourceDocumentIds: ["doc-1"],
          evidenceLevel: "primary",
          confidenceScore: 0.9,
        },
      ],
    );
    expect(result.pass).toBe(true);
    expect(result.manifest.integrityHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
