/**
 * TRI-HEPTA Turbo MoE — public surface of src/lib/intelligence/tri-hepta.
 *
 * Canonical entry point: executeTriangulatedMoE() plus the TriHepta* contract types.
 * Every symbol is re-exported from the unified implementation in ../moe, so this
 * barrel and ../moe-engine.ts expose the very same function objects.
 */
export * from "./tri-hepta-moe";
