/**
 * Canonical MoE surface (F2 unification).
 *
 * Single barrel for every MoE concern: contracts, expert registry, aggregation,
 * policy gate, telemetry and routing. `src/lib/intelligence/moe-engine.ts` and
 * `src/lib/intelligence/tri-hepta/*` are thin re-export facades of this module.
 */
export * from "./contracts";
export * from "./expert-registry";
export * from "./aggregator";
export * from "./policy-gate";
export * from "./telemetry";
export * from "./router";
