/**
 * Prompt builders for sprite generation — server-only.
 *
 * Port of `agent/pet/generate/prompts.py`: one *base* prompt (the canonical
 * look the user picks between) and per-*state* *row* prompts (grounded on the
 * chosen base, producing one horizontal strip of N poses). The identity lock
 * and "one transparent row" framing matter more than flowery description.
 */

import { FRAME_COUNTS } from "./constants.server";

/** What each state should depict — kept short, straight into the row prompt. */
export const STATE_ACTIONS: Readonly<Record<string, string>> = {
  idle: "a calm idle loop: subtle breathing, a tiny blink or gentle bob, no big gestures",
  "running-right":
    "a sideways walk/run locomotion cycle moving to the RIGHT: the character " +
    "faces and travels right with clear directional steps, a smooth gait loop",
  "running-left":
    "a sideways walk/run locomotion cycle moving to the LEFT: the character " +
    "faces and travels left with clear directional steps (the mirror of the " +
    "right-facing run)",
  waving: "a friendly greeting: raising a paw/hand/limb to wave, clear up-and-down gesture",
  jumping: "a happy celebration jump: anticipation, lift off the ground, peak, and land",
  failed: "a sad or deflated reaction: slumped, dejected, small frown — readable but not noisy",
  waiting:
    "an expectant 'waiting on you' pose: looking up/out as if asking for input " +
    "or approval — distinct from idle and review",
  running:
    "focused active work, staying IN PLACE (NOT walking or foot-running): " +
    "leaning in, concentrating, busy 'thinking / processing / typing' energy",
  review: "careful inspection: a focused lean, head tilt, studying something intently",
};

const STYLE_HINTS: Readonly<Record<string, string>> = {
  auto:
    " Style: crisp 16-bit PIXEL-ART game sprite — visible square pixels, a small " +
    "limited palette, clean dark outline, flat cel shading, chunky chibi " +
    "proportions, like a classic SNES/JRPG party member or a petdex.dev mascot. " +
    "Absolutely NOT 3D-rendered, NOT a smooth painted or vector illustration, " +
    "NOT photorealistic — no soft gradients, no realistic lighting, no figurine look.",
  pixel:
    " Render in clean 16-bit pixel-art style with visible square pixels and a limited palette.",
  plush: " Render as a soft plush toy.",
  clay: " Render as a claymation / soft 3D clay figure.",
  sticker: " Render as a glossy die-cut sticker.",
  "flat-vector": " Render in flat vector mascot style.",
  "3d-toy": " Render as a glossy 3D toy.",
  painterly: " Render in a soft painterly style.",
};

const BACKGROUND =
  "Center the character on a SINGLE flat, uniform, high-contrast chroma-key " +
  "background — pure hot magenta #FF00FF (only if magenta appears on the " +
  "character, use pure green #00FF00 instead). The background is ONE continuous " +
  "even color that completely surrounds the character with NO gradient, " +
  "vignette, texture, pattern, scenery, shadow, ground line, frame, border, " +
  "panel, comic cell, gutter line, grid, or divider of any kind, so it keys out " +
  "cleanly. The background color must not appear anywhere on the character. " +
  "No text, no labels, no speech bubbles, no UI.";

/** Style suffix for a named style; unknown styles render with no style clause. */
export function styleHint(style: string | null | undefined): string {
  return STYLE_HINTS[(style ?? "auto").trim().toLowerCase()] ?? "";
}

/**
 * Row strips are generated on the wider landscape canvas — extra width is what
 * lets each pose stay a healthy size AND leave a real gutter.
 */
const ASSUMED_STRIP_WIDTH = 1536;

/**
 * `(poseWidthPx, gapPx)` for a row of `frameCount` poses.
 *
 * Pixel counts alone don't hold — the model fills each slot edge-to-edge with
 * the full wingspan, so neighbors touch even when bodies are spaced. The lever
 * that works is proportional containment on a wide canvas: give each pose its
 * own equal cell and keep the ENTIRE silhouette inside it. On the 1536px
 * landscape strip ~70% occupancy still leaves a generous gutter.
 */
export function spacingSpec(frameCount: number): readonly [number, number] {
  const slots = Math.max(1, frameCount);
  const slotWidth = ASSUMED_STRIP_WIDTH / slots;
  const posePx = roundPython(slotWidth * 0.7);
  const gapPx = Math.max(48, roundPython(slotWidth * 0.3));
  return [posePx, gapPx];
}

/** Python's `round()` — half away from zero for the positive values used here. */
function roundPython(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Per-draft nudges so the base options are actually distinct — models return
 * near-duplicates for a single prompt. Vary the *look*, never the pose, so the
 * chosen base still grounds clean, consistent animation rows.
 */
export const BASE_VARIATIONS: readonly string[] = [
  "",
  "a distinctly different colour palette and markings",
  "a heavier, broader silhouette with sturdier proportions",
  "a different facial structure and expression matching the concept tone, with unique accent/accessory details",
  "a leaner, taller build and an alternate colour scheme",
  "bolder, more saturated colours and a stronger expression matching the concept tone",
];

/** The base look: a single, clean, centered full-body mascot. */
export function buildBasePrompt(
  concept: string,
  options: { readonly style?: string; readonly variation?: string } = {},
): string {
  const trimmed = (concept ?? "").trim() || "a distinctive mascot creature";
  const variation = options.variation ?? "";
  const nudge = variation ? ` Make this design distinct: ${variation}.` : "";
  return (
    `A stylized mascot pet character: ${trimmed}. ` +
    "Honor the requested tone and mood exactly (cute, eerie, scary, menacing, whimsical, etc.) " +
    "while staying non-graphic. " +
    "Compact, whole-body silhouette that reads clearly at small size, " +
    "clear readable facial features, simple consistent palette. " +
    "Neutral front-facing standing pose, upright and symmetric, arms/limbs " +
    "relaxed at the sides, feet together on the ground, any cape/accessories " +
    "hanging straight and still." +
    `${nudge} ` +
    `${BACKGROUND}${styleHint(options.style)}`
  );
}

/**
 * A row strip: `frameCount` poses of the SAME character, left→right.
 *
 * The attached base image is the identity source of truth; the prompt locks
 * species, palette, face, and props to it.
 */
export function buildRowPrompt(
  state: string,
  frameCount: number,
  concept: string,
  options: { readonly style?: string } = {},
): string {
  const action = STATE_ACTIONS[state] ?? "a simple idle pose";
  const [posePx, gapPx] = spacingSpec(frameCount);
  return (
    "Using the attached reference image as the exact same character " +
    "(same species, face, colors, markings, proportions, and props), " +
    "preserving the same emotional tone/mood (e.g., scary stays scary, cute stays cute), " +
    `draw a single WIDE horizontal strip of ${frameCount} animation frames showing ${action}. ` +
    `LAYOUT: arrange ${frameCount} poses in ONE horizontal row at equal spacing, ` +
    "each pose centered in its own imaginary equal region. Draw NO panel borders, " +
    "NO comic cells, NO boxes, NO vertical divider/gutter lines, NO grid, NO frame " +
    "outlines between poses — the backdrop is one unbroken flat field behind all of them. " +
    "Fill the WHOLE strip with the SAME single flat chroma-key color as the attached " +
    "reference image's background (identical hue in every frame, no per-pose color shifts). " +
    `SPACING (critical): draw each pose at a consistent, healthy, clearly ` +
    `visible size (roughly ${posePx}px wide on a ${ASSUMED_STRIP_WIDTH}px ` +
    "strip) — do NOT shrink it tiny — but keep its ENTIRE silhouette " +
    "(wings, tail, halo, horns, cape, every appendage) fully INSIDE its own " +
    `cell. Leave at least ${gapPx}px of empty chroma-key background between ` +
    "neighboring silhouettes at their closest point (wingtip to wingtip), and " +
    "the same empty margin before the first pose and after the last. If a wing, " +
    "cape, or tail would reach into a neighbor, FOLD or angle it inward rather " +
    "than letting it cross the gap. Silhouettes must NEVER touch, overlap, " +
    "share a shadow, share a ground line, share motion trails, or merge into " +
    "one connected shape. " +
    "REGISTRATION (critical): the character is the SAME height and SAME width " +
    "in every frame, drawn at the SAME scale, centered over the SAME point, " +
    "with all feet aligned to the SAME invisible horizontal baseline across the " +
    "whole strip — this baseline is conceptual ONLY: draw NO ground line, floor, " +
    "platform, horizon, or contact shadow beneath the feet. Keep the body's center, size, and stance fixed frame to " +
    "frame — ONLY the limbs/features the action needs may move. Capes, cloaks, " +
    "bags, and scarves stay in the SAME place and shape every frame (no " +
    "swinging, flowing, or drifting) unless the action itself requires it. No " +
    "pose is cropped at the strip edges. " +
    `${BACKGROUND}${styleHint(options.style)}`
  );
}

/** Number of poses a state's row strip must contain. */
export function frameCountFor(state: string): number {
  return FRAME_COUNTS[state] ?? 1;
}
