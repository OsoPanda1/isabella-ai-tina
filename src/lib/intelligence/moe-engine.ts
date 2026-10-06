/**
 * Legacy entry point kept for backwards compatibility.
 *
 * The implementation moved to the canonical `src/lib/intelligence/moe/` module
 * (F2 unification); this file now only re-exports the historic names so
 * `src/lib/intelligence/router.ts` keeps compiling unchanged.
 */
export { createMoERoute, executeMoE } from "./moe/router";
export type { MoEExpert, MoERoute, MoERunResult } from "./moe/contracts";
