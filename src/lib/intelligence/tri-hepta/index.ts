/**
 * TRI-HEPTA Turbo MoE — public surface of src/lib/intelligence/tri-hepta.
 *
 * Canonical entry point: executeTriangulatedMoE() plus the TriHepta* contract types.
 * Legacy helpers (createMoERoute, executeMoE, listModels, recordIntelligenceMetric,
 * MoERoute, MoeExpertArtifact, …) are re-exported here under their original names.
 *
 * NOTE for the ../index.ts barrel: those legacy names collide with
 * ../moe-engine.ts (createMoERoute/executeMoE/MoERoute), ../model-registry.ts
 * (listModels) and ../observability.ts (recordIntelligenceMetric), so the barrel
 * re-exports them only under explicit `TriHepta*` aliases.
 */
export * from "./tri-hepta-moe";
