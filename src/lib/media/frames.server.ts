/**
 * Frame extraction, cell normalization and mirroring — server-only.
 *
 * Port of the frame half of `agent/pet/generate/atlas.py`: a generated row
 * strip is keyed, segmented into exactly N frames (component detection first,
 * even slots as fallback), fitted or registered into 192x208 cells, and
 * mirrored for the leftward walk cycle. The model never owns the grid.
 */

import { removeBackground } from "./background.server";
import {
  ALPHA_FLOOR,
  CELL_HEIGHT,
  CELL_PAD,
  CELL_WIDTH,
  NORMALIZE_PAD,
  SIDE_LOBE_RATIO,
} from "./constants.server";
import {
  alphaComposite,
  cloneRgba,
  createRgba,
  cropImage,
  getBbox,
  resizeNearest,
  roundHalfToEven,
  type Rgb,
  type RgbaImage,
  type Rect,
} from "./pixels.server";

export type FramesByState = Readonly<Record<string, readonly RgbaImage[]>>;

export interface ExtractStripFramesOptions {
  /** Explicit chroma key for the strip backdrop. */
  readonly chromaKey?: Rgb;
  /** `"components"` demands clean per-pose gutters; `"auto"` may fall back. */
  readonly method?: "auto" | "components";
  /** Fit each frame into a finished 192x208 cell (hatching passes `false`). */
  readonly fit?: boolean;
}

interface Component {
  readonly box: Rect;
  readonly mass: number;
}

/** Per-column alpha mass — the column projection every segmenter pass uses. */
export function columnProfile(image: RgbaImage): number[] {
  const { width, height, data } = image;
  const profile: number[] = new Array<number>(width);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y < height; y += 1) sum += data[(y * width + x) * 4 + 3];
    profile[x] = roundHalfToEven(sum / height);
  }
  return profile;
}

/** Contiguous column spans whose alpha mass exceeds `threshold`. */
export function contentRuns(profile: readonly number[], threshold = 2): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start: number | null = null;
  const values = [...profile, 0];
  for (let x = 0; x < values.length; x += 1) {
    if (values[x] > threshold) {
      if (start === null) start = x;
    } else if (start !== null) {
      runs.push([start, x]);
      start = null;
    }
  }
  return runs;
}

/**
 * Drop tiny separated left/right lobes (neighbour-pose bleed) before fitting,
 * keeping any lobe at least `SIDE_LOBE_RATIO` of the strongest one so real
 * limbs and wide poses survive.
 */
export function dropSideBleed(image: RgbaImage): RgbaImage {
  const rgba = cloneRgba(image);
  const runs = contentRuns(columnProfile(rgba));
  if (runs.length < 2) return rgba;
  const masses = runs.map(([left, right]) => {
    let sum = 0;
    for (let x = left; x < right; x += 1) sum += columnValue(rgba, x);
    return sum;
  });
  const keepMass = Math.max(...masses) * SIDE_LOBE_RATIO;
  const kept = runs.filter((_run, index) => masses[index] >= keepMass);
  if (kept.length === runs.length) return rgba;

  const out = cloneRgba(rgba);
  let previous = 0;
  for (const [left, right] of kept) {
    if (left > previous) zeroColumns(out, previous, left);
    previous = right;
  }
  if (previous < rgba.width) zeroColumns(out, previous, rgba.width);
  return out;
}

function columnValue(image: RgbaImage, x: number): number {
  let sum = 0;
  for (let y = 0; y < image.height; y += 1) sum += image.data[(y * image.width + x) * 4 + 3];
  return sum;
}

function zeroColumns(image: RgbaImage, from: number, to: number): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = from; x < to; x += 1) {
      const at = (y * image.width + x) * 4;
      image.data[at] = 0;
      image.data[at + 1] = 0;
      image.data[at + 2] = 0;
      image.data[at + 3] = 0;
    }
  }
}

function zeroRows(image: RgbaImage, from: number, to: number): void {
  for (let y = from; y < to; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const at = (y * image.width + x) * 4;
      image.data[at] = 0;
      image.data[at + 1] = 0;
      image.data[at + 2] = 0;
      image.data[at + 3] = 0;
    }
  }
}

/** Remove thin rows/columns that span nearly the whole strip (guide lines). */
export function eraseLongAxisLines(image: RgbaImage): RgbaImage {
  const out = cloneRgba(image);
  const { width, height, data } = out;
  const wideRows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    let opaque = 0;
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_FLOOR) opaque += 1;
    }
    if (opaque >= width * 0.85) wideRows.push(y);
  }
  const tallColumns: number[] = [];
  for (let x = 0; x < width; x += 1) {
    let opaque = 0;
    for (let y = 0; y < height; y += 1) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_FLOOR) opaque += 1;
    }
    if (opaque >= height * 0.85) tallColumns.push(x);
  }
  for (const [top, bottom] of thinGroups(wideRows)) zeroRows(out, top, bottom);
  for (const [left, right] of thinGroups(tallColumns)) zeroColumns(out, left, right);
  return out;
}

/** Contiguous index runs of length ≤ 4 — only those are erased. */
function thinGroups(indices: readonly number[]): Array<[number, number]> {
  const groups: Array<[number, number]> = [];
  let start: number | null = null;
  let previous: number | null = null;
  const flush = (): void => {
    if (start === null || previous === null) return;
    if (previous - start + 1 <= 4) groups.push([start, previous + 1]);
    start = null;
    previous = null;
  };
  for (const index of indices) {
    if (start === null) {
      start = index;
      previous = index;
      continue;
    }
    if (previous !== null && index === previous + 1) {
      previous = index;
      continue;
    }
    flush();
    start = index;
    previous = index;
  }
  flush();
  return groups;
}

/** Connected opaque components inside the content bbox, with their mass. */
export function componentBoxes(image: RgbaImage): Component[] {
  const bbox = getBbox(image);
  if (bbox === null) return [];
  const width = bbox.right - bbox.left;
  const height = bbox.bottom - bbox.top;
  const visited = new Uint8Array(width * height);
  const alphaAt = (x: number, y: number): number =>
    image.data[((bbox.top + y) * image.width + bbox.left + x) * 4 + 3];
  const components: Component[] = [];

  for (let start = 0; start < width * height; start += 1) {
    const startX = start % width;
    const startY = (start / width) | 0;
    visited[start] = 1;
    if (alphaAt(startX, startY) <= ALPHA_FLOOR) continue;

    const queue: number[] = [start];
    let left = startX;
    let right = startX;
    let top = startY;
    let bottom = startY;
    let mass = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % width;
      const y = (index / width) | 0;
      mass += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      const enqueue = (next: number): void => {
        if (visited[next] !== 0) return;
        visited[next] = 1;
        const nx = next % width;
        const ny = (next / width) | 0;
        if (alphaAt(nx, ny) > ALPHA_FLOOR) queue.push(next);
      };
      if (x + 1 < width) enqueue(index + 1);
      if (x > 0) enqueue(index - 1);
      if (y + 1 < height) enqueue(index + width);
      if (y > 0) enqueue(index - width);
    }
    components.push({
      box: {
        left: bbox.left + left,
        top: bbox.top + top,
        right: bbox.left + right + 1,
        bottom: bbox.top + bottom + 1,
      },
      mass,
    });
  }
  return components;
}

/**
 * Merge disconnected parts that clearly belong to one subject (capes, tails,
 * horns) without bridging the much larger gaps between separate poses.
 */
export function mergeRelatedBoxes(boxes: readonly Rect[]): Rect[] {
  let current: Rect[] = [...boxes];
  let changed = true;
  while (changed) {
    changed = false;
    const merged: Rect[] = [];
    const used = current.map(() => false);
    for (let i = 0; i < current.length; i += 1) {
      if (used[i]) continue;
      let box = current[i];
      used[i] = true;
      for (let j = i + 1; j < current.length; j += 1) {
        if (used[j]) continue;
        const other = current[j];
        const verticalOverlap = Math.max(
          0,
          Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top),
        );
        const minHeight = Math.max(1, Math.min(box.bottom - box.top, other.bottom - other.top));
        const gap = Math.max(0, Math.max(box.left, other.left) - Math.min(box.right, other.right));
        const minWidth = Math.max(1, Math.min(box.right - box.left, other.right - other.left));
        if (verticalOverlap >= minHeight * 0.45 && gap <= Math.max(14, minWidth * 0.22)) {
          box = {
            left: Math.min(box.left, other.left),
            top: Math.min(box.top, other.top),
            right: Math.max(box.right, other.right),
            bottom: Math.max(box.bottom, other.bottom),
          };
          used[j] = true;
          changed = true;
        }
      }
      merged.push(box);
    }
    current = merged;
  }
  return current;
}

/** Keep the slot's real subject; drop detached effects, noise and slivers. */
export function isolateSlotSubject(image: RgbaImage): RgbaImage {
  const cleared = eraseLongAxisLines(image);
  const components = componentBoxes(cleared);
  if (components.length === 0) return cleared;

  let main = components[0];
  for (const component of components) {
    if (component.mass > main.mass) main = component;
  }
  const mainBox = main.box;
  const mainWidth = Math.max(1, mainBox.right - mainBox.left);
  const kept: Rect[] = [];
  for (const component of components) {
    const { box, mass } = component;
    if (
      box.left === mainBox.left &&
      box.top === mainBox.top &&
      box.right === mainBox.right &&
      box.bottom === mainBox.bottom
    ) {
      kept.push(box);
      continue;
    }
    const overlap = Math.max(
      0,
      Math.min(box.right, mainBox.right) - Math.max(box.left, mainBox.left),
    );
    const centerX = (box.left + box.right) / 2;
    const nearMain =
      mainBox.left - mainWidth * 0.25 <= centerX && centerX <= mainBox.right + mainWidth * 0.25;
    if (mass >= Math.max(24, main.mass * 0.035) && (overlap >= mainWidth * 0.3 || nearMain)) {
      kept.push(box);
    }
  }

  const out = createRgba(cleared.width, cleared.height);
  for (const box of kept) {
    alphaComposite(out, cropImage(cleared, box), box.left, box.top);
  }
  return out;
}

/** True when content has empty room on all four edges of the slot. */
export function hasSlotPadding(image: RgbaImage): boolean {
  const bbox = getBbox(image);
  if (bbox === null) return false;
  const { width, height } = image;
  const minX = Math.max(4, Math.min(12, roundHalfToEven(width * 0.025)));
  const minY = Math.max(4, Math.min(16, roundHalfToEven(height * 0.02)));
  return (
    bbox.left >= minX &&
    bbox.top >= minY &&
    width - bbox.right >= minX &&
    height - bbox.bottom >= minY
  );
}

/** Equal column slots for `frameCount` frames across `width` pixels. */
export function slotBounds(width: number, frameCount: number): Array<[number, number]> {
  const bounds: Array<[number, number]> = [];
  for (let i = 0; i < frameCount; i += 1) {
    bounds.push([
      roundHalfToEven((i * width) / frameCount),
      roundHalfToEven(((i + 1) * width) / frameCount),
    ]);
  }
  return bounds;
}

/** Group component boxes into visual rows (top→bottom), each left→right. */
export function groupComponentRows(boxes: readonly Rect[]): Rect[][] {
  if (boxes.length === 0) return [];
  const heights = boxes.map((box) => Math.max(1, box.bottom - box.top)).sort((a, b) => a - b);
  const rowTolerance = Math.max(12, heights[Math.floor(heights.length / 2)] * 0.55);
  const rows: Rect[][] = [];
  const centers: number[] = [];
  const byCenter = [...boxes].sort(
    (a, b) => (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2 || a.top - b.top,
  );
  for (const box of byCenter) {
    const centerY = (box.top + box.bottom) / 2;
    let assigned = false;
    for (let i = 0; i < centers.length; i += 1) {
      if (Math.abs(centerY - centers[i]) > rowTolerance) continue;
      rows[i].push(box);
      centers[i] =
        rows[i].reduce((sum, entry) => sum + (entry.top + entry.bottom) / 2, 0) / rows[i].length;
      assigned = true;
      break;
    }
    if (!assigned) {
      rows.push([box]);
      centers.push(centerY);
    }
  }
  const ordered = rows
    .map((row, index) => ({ row, center: centers[index], index }))
    .sort((a, b) => a.center - b.center || a.index - b.index);
  return ordered.map((entry) =>
    [...entry.row].sort(
      (a, b) => (a.left + a.right) / 2 - (b.left + b.right) / 2 || a.left - b.left,
    ),
  );
}

/** Connected non-background subjects worth treating as poses. */
export function significantSubjectBoxes(image: RgbaImage): Rect[] {
  const components = componentBoxes(image);
  if (components.length === 0) return [];
  const maxMass = Math.max(...components.map((component) => component.mass));
  return mergeRelatedBoxes(
    components
      .filter((component) => component.mass >= Math.max(32, maxMass * 0.12))
      .map((component) => component.box),
  );
}

function componentCrops(
  strip: RgbaImage,
  frameCount: number,
  requirePadding: boolean,
): RgbaImage[] | null {
  const attempt = (source: RgbaImage): RgbaImage[] | null => {
    const components = componentBoxes(source);
    if (components.length === 0) return null;
    const maxMass = Math.max(...components.map((component) => component.mass));
    const subjects = mergeRelatedBoxes(
      components
        .filter((component) => component.mass >= Math.max(64, maxMass * 0.12))
        .map((component) => component.box),
    );
    if (subjects.length < frameCount) return null;

    const rows = groupComponentRows(subjects);
    const ordered = rows.flat().slice(0, frameCount);
    if (ordered.length < frameCount) return null;

    if (requirePadding) {
      const minX = Math.max(4, Math.min(12, roundHalfToEven(source.width * 0.01)));
      const minY = Math.max(4, Math.min(16, roundHalfToEven(source.height * 0.015)));
      for (const box of ordered) {
        if (
          box.left < minX ||
          box.top < minY ||
          source.width - box.right < minX ||
          source.height - box.bottom < minY
        ) {
          return null;
        }
      }
    }

    const multiRow = rows.length > 1;
    return ordered.map((box) => {
      const padX = Math.max(8, roundHalfToEven((box.right - box.left) * 0.08));
      const padY = Math.max(8, roundHalfToEven((box.bottom - box.top) * 0.08));
      let cropBox: Rect;
      if (multiRow) {
        cropBox = {
          left: Math.max(0, box.left - padX),
          top: Math.max(0, box.top - padY),
          right: Math.min(source.width, box.right + padX),
          bottom: Math.min(source.height, box.bottom + padY),
        };
      } else if (frameCount === 1) {
        cropBox = { left: 0, top: 0, right: source.width, bottom: source.height };
      } else {
        cropBox = {
          left: Math.max(0, box.left - padX),
          top: 0,
          right: Math.min(source.width, box.right + padX),
          bottom: source.height,
        };
      }
      const frame = createRgba(cropBox.right - cropBox.left, cropBox.bottom - cropBox.top);
      alphaComposite(frame, cropImage(source, box), box.left - cropBox.left, box.top - cropBox.top);
      return frame;
    });
  };

  return attempt(strip) ?? attempt(eraseLongAxisLines(strip));
}

function severExpectedGutters(strip: RgbaImage, frameCount: number): RgbaImage {
  if (frameCount <= 1) return strip;
  const out = cloneRgba(strip);
  const slot = out.width / frameCount;
  const half = Math.max(3, Math.min(18, roundHalfToEven(slot * 0.06)));
  for (let i = 1; i < frameCount; i += 1) {
    const x = roundHalfToEven(i * slot);
    const from = Math.max(0, x - half);
    const to = Math.min(out.width, x + half + 1);
    for (let gx = from; gx < to; gx += 1) {
      for (let gy = 0; gy < out.height; gy += 1) {
        out.data[(gy * out.width + gx) * 4 + 3] = 0;
      }
    }
  }
  return out;
}

function slotCrops(
  strip: RgbaImage,
  frameCount: number,
  requirePadding: boolean,
): RgbaImage[] | null {
  const frames: RgbaImage[] = [];
  for (const [left, right] of slotBounds(strip.width, frameCount)) {
    const slot = dropSideBleed(
      isolateSlotSubject(cropImage(strip, { left, top: 0, right, bottom: strip.height })),
    );
    if (requirePadding && !hasSlotPadding(slot)) return null;
    frames.push(slot);
  }
  return frames;
}

function frameXRanges(strip: RgbaImage, frameCount: number): Array<[number, number]> | null {
  const profile = columnProfile(strip);
  let runs = contentRuns(profile);
  if (runs.length === 0) return null;

  const masses = runs.map(([left, right]) => {
    let sum = 0;
    for (let x = left; x < right; x += 1) sum += profile[x];
    return sum;
  });
  const floor = Math.max(...masses) * 0.02;
  runs = runs.filter((_run, index) => masses[index] >= floor);
  if (runs.length < frameCount) return null;

  const groups = runs.map(([left, right]) => [left, right]);
  while (groups.length > frameCount) {
    let bestIndex = 0;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < groups.length - 1; i += 1) {
      const gap = groups[i + 1][0] - groups[i][1];
      if (gap < bestGap) {
        bestGap = gap;
        bestIndex = i;
      }
    }
    groups[bestIndex][1] = groups[bestIndex + 1][1];
    groups.splice(bestIndex + 1, 1);
  }
  return groups.map(([left, right]) => [left, right] as [number, number]);
}

/**
 * Reject rows where one "frame" is really several poses, or is empty — hatch
 * regenerates such a row instead of shipping a broken atlas.
 *
 * @throws {Error} when the frames cannot represent `frameCount` clean poses.
 */
export function validateExtractedFrames(frames: readonly RgbaImage[], frameCount: number): void {
  if (frames.length !== frameCount) {
    throw new Error(`expected ${frameCount} frames, got ${frames.length}`);
  }
  const boxes: Rect[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    const bbox = getBbox(frames[i]);
    if (bbox === null) throw new Error(`frame ${i} is empty`);
    const subjects = significantSubjectBoxes(frames[i]);
    if (subjects.length >= 3) throw new Error(`frame ${i} contains multiple separated subjects`);
    boxes.push(bbox);
  }
  if (frameCount <= 1) return;

  const widths = boxes.map((box) => box.right - box.left).sort((a, b) => a - b);
  const heights = boxes.map((box) => box.bottom - box.top).sort((a, b) => a - b);
  const medianWidth = Math.max(1, widths[Math.floor(widths.length / 2)]);
  const medianHeight = Math.max(1, heights[Math.floor(heights.length / 2)]);
  for (let i = 0; i < boxes.length; i += 1) {
    const width = boxes[i].right - boxes[i].left;
    const height = boxes[i].bottom - boxes[i].top;
    if (width > Math.max(medianWidth * 3, medianWidth + 96) && height <= medianHeight * 1.6) {
      throw new Error(`frame ${i} is a multi-pose width outlier`);
    }
  }
}

/** Crop to content, scale to fit a padded cell, and centre on transparent. */
export function fitToCell(image: RgbaImage): RgbaImage {
  const target = createRgba(CELL_WIDTH, CELL_HEIGHT);
  const source = dropSideBleed(image);
  const bbox = getBbox(source);
  if (bbox === null) return target;

  let sprite = cropImage(source, bbox);
  const maxWidth = CELL_WIDTH - CELL_PAD;
  const maxHeight = CELL_HEIGHT - CELL_PAD;
  const scale = Math.min(maxWidth / sprite.width, maxHeight / sprite.height, 1);
  if (scale !== 1) {
    sprite = resizeNearest(
      sprite,
      Math.max(1, roundHalfToEven(sprite.width * scale)),
      Math.max(1, roundHalfToEven(sprite.height * scale)),
    );
  }
  const left = Math.floor((CELL_WIDTH - sprite.width) / 2);
  const top = Math.floor((CELL_HEIGHT - sprite.height) / 2);
  alphaComposite(target, sprite, left, top);
  return target;
}

/**
 * Turn one generated row strip into `frameCount` frames.
 *
 * The backdrop is keyed out, then the requested frame count is the source of
 * truth: real subjects are detected first, known equal slots second, and empty
 * chroma gutters only as a lenient salvage fallback. `fit` (default) centres
 * every frame into a finished cell; hatching passes `fit: false` so
 * `normalizeCells` can register the whole pet at once.
 *
 * @throws {Error} when the strip cannot be segmented (`method: "components"`)
 * or when the extracted frames fail validation.
 */
export function extractStripFrames(
  strip: RgbaImage,
  frameCount: number,
  options: ExtractStripFramesOptions = {},
): RgbaImage[] {
  const method = options.method ?? "auto";
  const fit = options.fit ?? true;
  const keyed = removeBackground(strip, { chromaKey: options.chromaKey });

  let frames =
    componentCrops(keyed, frameCount, true) ?? slotCrops(keyed, frameCount, true) ?? null;
  if (frames === null && method === "components") {
    throw new Error(`could not segment ${frameCount} padded sprites from strip`);
  }
  if (frames === null) frames = componentCrops(keyed, frameCount, false) ?? null;
  if (frames === null) {
    let source = keyed;
    let ranges = frameXRanges(source, frameCount);
    if (ranges === null) {
      source = severExpectedGutters(keyed, frameCount);
      ranges = frameXRanges(source, frameCount);
    }
    if (ranges === null) {
      frames = slotCrops(source, frameCount, false) ?? [];
    } else {
      const height = source.height;
      const pad = Math.max(
        2,
        Math.min(16, roundHalfToEven((source.width / Math.max(1, frameCount)) * 0.04)),
      );
      frames = ranges.map(([left, right]) =>
        dropSideBleed(
          isolateSlotSubject(
            cropImage(source, {
              left: Math.max(0, left - pad),
              top: 0,
              right: Math.min(source.width, right + pad),
              bottom: height,
            }),
          ),
        ),
      );
    }
  }

  validateExtractedFrames(frames, frameCount);
  return fit ? frames.map(fitToCell) : frames;
}

/** One frame from a standalone image (the base look / idle fallback). */
export function singleFrame(image: RgbaImage, options: { readonly fit?: boolean } = {}): RgbaImage {
  const keyed = removeBackground(image);
  return (options.fit ?? true) ? fitToCell(keyed) : dropSideBleed(keyed);
}

/** Horizontally flip each frame in place — derives running-left from right. */
export function mirrorFrames(frames: readonly RgbaImage[]): RgbaImage[] {
  return frames.map((frame) => {
    const { width, height, data } = frame;
    const out = new Uint8Array(data.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const from = (y * width + x) * 4;
        const to = (y * width + (width - 1 - x)) * 4;
        out[to] = data[from];
        out[to + 1] = data[from + 1];
        out[to + 2] = data[from + 2];
        out[to + 3] = data[from + 3];
      }
    }
    return { width, height, data: out };
  });
}

interface PreparedState {
  readonly aligned: RgbaImage[];
  readonly window: Rect;
  readonly poseWidth: number;
  readonly poseHeight: number;
}

/**
 * Register every frame into a 192x208 cell — the anti-jitter math.
 *
 * Each state's frames are cross-correlated against the per-state median column
 * profile to lock the body in place, union-cropped through one shared window,
 * and scaled by a single global factor so the character keeps one on-screen
 * size across every row while a jump's lift still fits.
 */
export function normalizeCells(
  framesByState: FramesByState,
  pad: number = NORMALIZE_PAD,
): Record<string, RgbaImage[]> {
  const out: Record<string, RgbaImage[]> = {};
  const prepared = new Map<string, PreparedState>();
  const targetWidth = CELL_WIDTH - pad;
  const targetHeight = CELL_HEIGHT - pad;

  for (const [state, frames] of Object.entries(framesByState)) {
    const converted = frames.map(cloneRgba);
    if (!converted.some((frame) => getBbox(frame) !== null)) {
      out[state] = frames.map(() => createRgba(CELL_WIDTH, CELL_HEIGHT));
      continue;
    }

    const canvasWidth = Math.max(...converted.map((frame) => frame.width));
    const canvasHeight = Math.max(...converted.map((frame) => frame.height));
    const canvas = converted.map((frame) => {
      if (frame.width === canvasWidth && frame.height === canvasHeight) return frame;
      const padded = createRgba(canvasWidth, canvasHeight);
      alphaComposite(padded, frame, 0, 0);
      return padded;
    });

    const profiles = canvas.map(columnProfile);
    const reference: number[] = new Array<number>(canvasWidth);
    for (let x = 0; x < canvasWidth; x += 1) {
      const column = profiles.map((profile) => profile[x]).sort((a, b) => a - b);
      reference[x] = column[Math.floor(column.length / 2)];
    }
    const window = Math.max(8, Math.floor(canvasWidth / 5));
    const margin = window;
    const aligned = canvas.map((frame, index) => {
      const shifted = createRgba(canvasWidth + 2 * margin, canvasHeight);
      alphaComposite(shifted, frame, margin + bestShift(reference, profiles[index], window), 0);
      return shifted;
    });

    const boxes = aligned.map((frame) => getBbox(frame)).filter((box): box is Rect => box !== null);
    if (boxes.length === 0) continue;
    const union: Rect = {
      left: Math.min(...boxes.map((box) => box.left)),
      top: Math.min(...boxes.map((box) => box.top)),
      right: Math.max(...boxes.map((box) => box.right)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
    const poseWidth = median(boxes.map((box) => box.right - box.left));
    const poseHeight = median(boxes.map((box) => box.bottom - box.top));
    prepared.set(state, { aligned, window: union, poseWidth, poseHeight });
  }

  if (prepared.size === 0) return out;

  let factor = targetHeight;
  for (const state of prepared.values()) {
    const unionWidth = state.window.right - state.window.left;
    const unionHeight = state.window.bottom - state.window.top;
    factor = Math.min(
      factor,
      (targetHeight * state.poseHeight) / Math.max(1, unionHeight),
      (targetWidth * state.poseHeight) / Math.max(1, unionWidth),
    );
  }

  for (const [state, entry] of prepared) {
    const unionWidth = entry.window.right - entry.window.left;
    const unionHeight = entry.window.bottom - entry.window.top;
    const scale = factor / Math.max(1, entry.poseHeight);
    const scaledWidth = Math.max(1, roundHalfToEven(unionWidth * scale));
    const scaledHeight = Math.max(1, roundHalfToEven(unionHeight * scale));
    const offsetX = roundHalfToEven((CELL_WIDTH - scaledWidth) / 2);
    const offsetY = roundHalfToEven(CELL_HEIGHT - Math.floor(pad / 2) - scaledHeight);

    out[state] = entry.aligned.map((frame) => {
      let crop = cropImage(frame, entry.window);
      if (crop.width !== scaledWidth || crop.height !== scaledHeight) {
        crop = resizeNearest(crop, scaledWidth, scaledHeight);
      }
      const cell = createRgba(CELL_WIDTH, CELL_HEIGHT);
      alphaComposite(cell, crop, offsetX, offsetY);
      return cell;
    });
  }
  return out;
}

function median(values: readonly number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

/** Integer shift that best aligns a column profile onto the reference. */
function bestShift(
  reference: readonly number[],
  profile: readonly number[],
  window: number,
): number {
  const length = reference.length;
  let bestScore: number | null = null;
  let best = 0;
  for (let shift = -window; shift <= window; shift += 1) {
    let score = 0;
    const start = Math.max(0, shift);
    const end = Math.min(length, length + shift);
    for (let x = start; x < end; x += 1) score += reference[x] * profile[x - shift];
    if (bestScore === null || score > bestScore) {
      bestScore = score;
      best = shift;
    }
  }
  return best;
}
