/**
 * Public surface of the sprite pipeline — server-only.
 *
 * One barrel so callers (server routes, scripts) import from `@/lib/media`
 * without knowing which module owns which stage: constants → pixels →
 * background → frames → atlas → prompts → generation.
 */

export * from "./constants.server";
export * from "./pixels.server";
export * from "./background.server";
export * from "./frames.server";
export * from "./atlas.server";
export * from "./prompts.server";
export * from "./generate.server";
