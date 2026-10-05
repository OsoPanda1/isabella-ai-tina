import { createRequire } from "node:module";

/**
 * Dual-mode require for native/CJS-only modules (e.g. better-sqlite3).
 * Works under tsx (ESM), Vercel functions, and the esbuild CJS bundle,
 * where import.meta is an empty object and import.meta.url is undefined.
 */
export const nodeRequire = createRequire(
  typeof import.meta !== "undefined" && import.meta.url ? import.meta.url : __filename,
);
