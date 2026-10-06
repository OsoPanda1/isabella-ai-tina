/**
 * Sprite generation orchestration — server-only.
 *
 * Port of `agent/pet/generate/orchestrate.py` + the transparency half of
 * `imagegen.py`: two steps mirroring the UX — `generateBaseDrafts` (a handful
 * of prompt-only "what should this pet look like" variants the user picks
 * between) and `hatchPet` (grounded row strip per state → frames → atlas →
 * validation).
 *
 * The model is injected: this module never holds credentials, never imports a
 * provider, and never opens a socket. Callers pass a `SpriteGenerationProvider`
 * that turns a prompt into image bytes.
 */

import { readFile, unlink, writeFile } from "node:fs/promises";

import {
  atlasToWebpBytes,
  composeAtlas,
  validateAtlas,
  type AtlasValidation,
} from "./atlas.server";
import { ROW_SPECS } from "./constants.server";
import { extractStripFrames, mirrorFrames, normalizeCells, singleFrame } from "./frames.server";
import { removeBackground } from "./background.server";
import { buildBasePrompt, buildRowPrompt, BASE_VARIATIONS } from "./prompts.server";
import { clearTransparentRgb, decodeRgba, encodePng, type RgbaImage } from "./pixels.server";

/** One image generation: prompt in, encoded image bytes out. */
export interface SpriteGenerationProvider {
  generateImage(request: SpriteGenerationRequest): Promise<Uint8Array>;
}

export interface SpriteGenerationRequest {
  readonly prompt: string;
  /** Grounding images (the chosen base for rows, user references for drafts). */
  readonly referenceImages?: readonly Uint8Array[];
  /** Strip rows need the wide canvas so poses leave real gutters. */
  readonly aspectRatio?: "square" | "landscape" | "portrait";
}

/** A generation failure worth surfacing to the user as a sentence. */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

/** `(event, detail)` progress — e.g. `("row", "idle:1:9")`, `("compose", "")`. */
export type ProgressFn = (event: string, detail: string) => void;

/**
 * Image generations are independent calls, so we fan them out instead of
 * blocking on each in turn; capped so we don't hammer the rate limit.
 */
const MAX_PARALLEL_GENERATIONS = 4;

/** Retry budget per row: strict gutters twice, then one lenient pass. */
const ROW_GEN_ATTEMPTS = 3;

const MIN_FILLED_STATES = 6;

const REQUIRED_STATES: readonly string[] = ["idle", "running-right", "waving"];

/**
 * Key out any solid backdrop the provider painted and return RGBA PNG bytes.
 *
 * `background=transparent` is requested on every call, but image models honor
 * it inconsistently — some still paint a flat backdrop. Best-effort: an
 * undecodable input is returned untouched.
 */
export async function hardenTransparency(image: Uint8Array): Promise<Uint8Array> {
  try {
    const keyed = await decodeRgba(image);
    const cleaned = clearTransparentRgb(removeBackground(keyed));
    return await encodePng(cleaned);
  } catch {
    return image;
  }
}

/**
 * `hardenTransparency` for a file on disk: the PNG stands in for the draft,
 * and a provider-returned non-PNG original is deleted so the cache doesn't
 * grow a shadow copy. Returns the path to read afterwards.
 */
export async function hardenTransparencyFile(path: string): Promise<string> {
  try {
    const source = await readFile(path);
    const png = await hardenTransparency(source);
    const out = path.toLowerCase().endsWith(".png") ? path : path.replace(/\.[^./\\]+$/, ".png");
    await writeFile(out, png);
    if (out !== path) {
      try {
        await unlink(path);
      } catch {
        // Best-effort: a leftover original only costs cache space.
      }
    }
    return out;
  } catch {
    return path;
  }
}

/** Turn a raw provider error into a friendly, actionable sentence. */
export function humanizeImageError(error: string): string {
  const low = error.toLowerCase();
  if (
    ["moderation_blocked", "safety system", "content policy", "content_policy"].some((needle) =>
      low.includes(needle),
    )
  ) {
    return (
      "The image provider blocked this prompt — its safety filter rejects " +
      "trademarked characters and real people. Try an original description."
    );
  }
  if (["api key", "unauthorized", "401", "auth"].some((needle) => low.includes(needle))) {
    return "The image provider rejected the request — check your API key in Settings → Providers.";
  }
  if (low.includes("rate limit") || low.includes("429")) {
    return "The image provider is rate-limiting — wait a moment and try again.";
  }
  const firstLine = error.split(/\r?\n/)[0] ?? "";
  return firstLine.trim().slice(0, 200);
}

/** The representative reason a draft round produced nothing, humanized. */
export function draftsFailedReason(errors: readonly string[]): string {
  if (errors.length === 0) return "image generation produced no usable drafts";
  const counts = new Map<string, number>();
  for (const error of errors) counts.set(error, (counts.get(error) ?? 0) + 1);
  let representative = errors[0];
  let best = 0;
  for (const [error, count] of counts) {
    if (count > best) {
      best = count;
      representative = error;
    }
  }
  return humanizeImageError(representative);
}

export interface GenerateBaseDraftsOptions {
  readonly concept: string;
  /** How many candidate looks to draft (default 4). */
  readonly count?: number;
  readonly style?: string;
  /** User reference images grounding every draft. */
  readonly referenceImages?: readonly Uint8Array[];
  readonly provider?: SpriteGenerationProvider;
  /** Fires as each draft finishes so callers can stream previews. */
  readonly onDraft?: (index: number, image: Uint8Array) => void;
  /** Polled cooperatively: unstarted drafts are skipped, results dropped. */
  readonly isCancelled?: () => boolean;
}

/**
 * Generate `count` candidate base looks for a concept.
 *
 * Drafts run concurrently (one image to wait for, not N), each with a distinct
 * variation nudge so the options aren't near-duplicates, and every draft is
 * hardened to a transparent cutout. A single failing draft doesn't sink the
 * set; if nothing survives, the representative failure is thrown.
 */
export async function generateBaseDrafts(
  options: GenerateBaseDraftsOptions,
): Promise<Uint8Array[]> {
  const provider = requireProvider(options.provider);
  const count = options.count ?? 4;
  const cancelled = options.isCancelled ?? ((): boolean => false);
  const references = options.referenceImages?.length ? options.referenceImages : undefined;

  const results = new Map<number, Uint8Array>();
  const errors: string[] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (cancelled()) return;
      const index = next;
      next += 1;
      if (index >= count) return;
      const variation = BASE_VARIATIONS[index % BASE_VARIATIONS.length];
      try {
        const produced = await provider.generateImage({
          prompt: buildBasePrompt(options.concept, { style: options.style, variation }),
          referenceImages: references,
        });
        if (cancelled()) return;
        if (produced.byteLength === 0) {
          errors.push("the image provider returned no image");
          continue;
        }
        const hardened = await hardenTransparency(produced);
        results.set(index, hardened);
        if (cancelled()) return;
        if (options.onDraft) {
          try {
            options.onDraft(index, hardened);
          } catch {
            // Progress is best-effort.
          }
        }
      } catch (error) {
        errors.push(messageOf(error));
      }
    }
  };

  const workers = Math.max(1, Math.min(count, MAX_PARALLEL_GENERATIONS));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  const drafts: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const draft = results.get(index);
    if (draft) drafts.push(draft);
  }
  if (drafts.length === 0 && !cancelled()) throw new GenerationError(draftsFailedReason(errors));
  return drafts;
}

export interface HatchPetOptions {
  /** The approved base look, as encoded image bytes. */
  readonly baseImage: Uint8Array;
  readonly slug: string;
  readonly displayName?: string;
  readonly concept?: string;
  readonly style?: string;
  readonly provider?: SpriteGenerationProvider;
  readonly onProgress?: ProgressFn;
  readonly isCancelled?: () => boolean;
}

export interface HatchResult {
  readonly slug: string;
  readonly displayName: string;
  /** Lossless WebP spritesheet bytes, ready to store. */
  readonly spritesheet: Uint8Array;
  readonly atlas: RgbaImage;
  readonly states: string[];
  readonly validation: AtlasValidation;
}

/**
 * Turn an approved base image into a full spritesheet.
 *
 * Generates a grounded row strip per state (concurrently, `running-left` is
 * mirrored from `running-right`), slices each into frames, normalizes every
 * cell with one shared scale/baseline, composes the atlas, validates it, and
 * returns the sheet. The idle row falls back to the base look so a pet always
 * renders. Throws `GenerationError` on failure.
 *
 * Isabella has no local pet store, so the caller owns persistence: this
 * returns bytes instead of registering a pet (the Python original's
 * `store.register_local_pet`).
 */
export async function hatchPet(options: HatchPetOptions): Promise<HatchResult> {
  const provider = requireProvider(options.provider);
  const cancelled = options.isCancelled ?? ((): boolean => false);
  const progress: ProgressFn = options.onProgress ?? ((): void => undefined);
  const label = options.concept?.trim() || options.displayName?.trim() || options.slug;

  let base: RgbaImage;
  try {
    base = await decodeRgba(options.baseImage);
  } catch {
    throw new GenerationError("base image could not be decoded");
  }

  const framesByState: Record<string, RgbaImage[]> = {};
  const totalRows = ROW_SPECS.length;
  const generatedSpecs = ROW_SPECS.filter((spec) => spec.state !== "running-left");
  let done = 0;

  const generateRow = async (state: string, count: number): Promise<RgbaImage[] | null> => {
    let lastError: Error = new GenerationError("row generation failed");
    for (let attempt = 0; attempt < ROW_GEN_ATTEMPTS; attempt += 1) {
      if (cancelled()) return null;
      try {
        const strip = await provider.generateImage({
          prompt: buildRowPrompt(state, count, label, { style: options.style }),
          referenceImages: [options.baseImage],
          aspectRatio: "landscape",
        });
        const image = await decodeRgba(strip);
        // Strict attempts demand clean per-pose gutters; only the last is
        // lenient so a stubborn row still yields *something*.
        const method = attempt < ROW_GEN_ATTEMPTS - 1 ? "components" : "auto";
        return extractStripFrames(image, count, { method, fit: false });
      } catch (error) {
        lastError = error instanceof Error ? error : new GenerationError(String(error));
      }
    }
    throw lastError;
  };

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= generatedSpecs.length) return;
      const spec = generatedSpecs[index];
      if (cancelled()) return;
      try {
        const frames = await generateRow(spec.state, spec.frames);
        if (cancelled() || !frames) return;
        framesByState[spec.state] = frames;
      } catch {
        // One bad row is tolerated; idle is guaranteed below.
      }
      done += 1;
      progress("row", `${spec.state}:${done}:${totalRows}`);
    }
  };
  const workers = Math.max(1, Math.min(generatedSpecs.length, MAX_PARALLEL_GENERATIONS));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  if (cancelled()) throw new GenerationError("hatch cancelled");

  // Derive running-left from the approved running-right row: per-frame mirror
  // preserves frame order and timing (never a whole-strip reverse).
  const right = framesByState["running-right"];
  if (right && right.length > 0) {
    done += 1;
    progress("row", `running-left:${done}:${totalRows}`);
    framesByState["running-left"] = mirrorFrames(right);
  }

  // Idle is the resting state the renderer falls back to — guarantee it.
  if (!framesByState["idle"] || framesByState["idle"].length === 0) {
    progress("row", "idle-fallback");
    framesByState["idle"] = [singleFrame(base, { fit: false })];
  }

  progress("compose", "");
  const sheet = composeAtlas(normalizeCells(framesByState));
  const validation = validateAtlas(sheet);
  assertHatchAcceptable(validation);

  const spritesheet = await atlasToWebpBytes(sheet);
  return {
    slug: options.slug,
    displayName: options.displayName?.trim() || options.slug,
    spritesheet,
    atlas: sheet,
    states: validation.filledStates,
    validation,
  };
}

/**
 * The blockers a composed atlas must clear before it can ship: validation
 * errors, a missing required row, and fewer usable rows than the minimum.
 *
 * @throws {GenerationError} describing the first blocker found.
 */
export function assertHatchAcceptable(validation: AtlasValidation): void {
  if (!validation.ok) {
    throw new GenerationError(validation.errors.join("; ") || "atlas validation failed");
  }
  const filled = new Set(validation.filledStates);
  const missing = REQUIRED_STATES.filter((state) => !filled.has(state)).sort();
  if (missing.length > 0) {
    throw new GenerationError(`missing required animation row(s): ${missing.join(", ")}`);
  }
  if (filled.size < MIN_FILLED_STATES) {
    throw new GenerationError(
      `only ${filled.size}/${ROW_SPECS.length} animation rows were usable; regenerate`,
    );
  }
}

function requireProvider(provider: SpriteGenerationProvider | undefined): SpriteGenerationProvider {
  if (!provider) {
    throw new GenerationError("no image generation provider is configured for this request");
  }
  return provider;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
