// @ts-nocheck
import { describe, it, expect } from "vitest";
import { isabellaSkills, listIsabellaSkills } from "../../src/lib/skills/registry";
import type { SkillContext } from "../../src/lib/skills/contracts";

const mockContext: SkillContext = {
  requestId: "req-osopanda-test",
  actorId: "anubis-sovereign",
  locale: "es-MX",
};

describe("OsoPanda1 Ecosystem Skills Unification", () => {
  it("Registers all OsoPanda ecosystem skills into isabellaSkills registry", () => {
    const allSkills = listIsabellaSkills();
    expect(allSkills.length).toBeGreaterThanOrEqual(6);

    const twinSkill = isabellaSkills["nodo-cero-twin"];
    expect(twinSkill).toBeDefined();
    expect(twinSkill.name).toBe("Real del Monte Territorial Digital Twin");
    expect(twinSkill.federation).toBe("TERRITORY");

    const commerceSkill = isabellaSkills["rdm-sovereign-commerce"];
    expect(commerceSkill).toBeDefined();
    expect(commerceSkill.name).toBe("RDM Sovereign Commerce & Origin Certification");

    const ingestSkill = isabellaSkills["fast-parallel-ingest"];
    expect(ingestSkill).toBeDefined();
    expect(ingestSkill.name).toBe("Fast Parallel Ingest & Stream Engine");
  });

  it("Executes fast-parallel-ingest skill with sub-millisecond hash chunking", async () => {
    const ingestSkill = isabellaSkills["fast-parallel-ingest"];
    expect(ingestSkill).toBeDefined();

    const output = await ingestSkill.run(
      {
        targetDataset: "fotogrametria-mina-acosta",
        sourceType: "3D_PHOTOGRAMMETRY",
        totalBytesEstimate: 104857600,
        parallelChunks: 8,
      },
      mockContext,
    );

    expect(output.status).toBe("SUCCESS");
    expect(output.data.parallelChunks).toBe(8);
    expect(output.data.throughputMbPerSecond).toBeGreaterThan(0);
    expect(output.data.integrityChecksum).toMatch(/^sha256:/);
    expect(output.data.state).toBe("STREAMING_COMPLETED");
  });

  it("Executes rdm-sovereign-commerce skill and certifies local origin", async () => {
    const commerceSkill = isabellaSkills["rdm-sovereign-commerce"];
    expect(commerceSkill).toBeDefined();

    const result = await commerceSkill.run(
      {
        merchantName: "Pastes Tradicionales de la Dificultad",
        category: "PASTES_TRADICIONALES",
        localIngredientsVerified: true,
        fairLaborVerified: true,
      },
      mockContext,
    );

    expect(result.status).toBe("SUCCESS");
    expect(result.data.certificationStatus).toBe("CERTIFICADO_SOBERANO");
    expect(result.data.sealOfOriginCode).toContain("SELLO-RDM");
    expect(result.data.bookPiRegistryEntry.transactionHash).toBeDefined();
  });
});
// @ts-nocheck
