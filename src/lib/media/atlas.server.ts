/**
 * Atlas composition and validation — server-only.
 *
 * Port of the pack half of `agent/pet/generate/atlas.py`: normalized cells are
 * laid into the 9-row sheet, and `validateAtlas` checks geometry, per-state
 * occupancy, size invariants and zero-RGB transparency before anything ships.
 */

import { ATLAS_HEIGHT, ATLAS_WIDTH, CELL_HEIGHT, CELL_WIDTH, ROW_SPECS } from "./constants.server";
import {
  alphaComposite,
  clearTransparentRgb,
  cloneRgba,
  createRgba,
  cropImage,
  encodeWebpLossless,
  getBbox,
  type RgbaImage,
} from "./pixels.server";
import { fitToCell } from "./frames.server";

export interface AtlasValidation {
  readonly ok: boolean;
  readonly width: number;
  readonly height: number;
  readonly errors: string[];
  readonly warnings: string[];
  readonly filledStates: string[];
}

/**
 * Pack per-state frame lists into the Hermes atlas (RGBA, residue-cleared).
 *
 * Missing/short states leave their trailing cells transparent; extra frames
 * beyond a state's spec are dropped.
 */
export function composeAtlas(
  framesByState: Readonly<Record<string, readonly RgbaImage[]>>,
): RgbaImage {
  const atlas = createRgba(ATLAS_WIDTH, ATLAS_HEIGHT);
  for (const spec of ROW_SPECS) {
    const frames = framesByState[spec.state] ?? [];
    const used = Math.min(frames.length, spec.frames);
    for (let col = 0; col < used; col += 1) {
      let cell = cloneRgba(frames[col]);
      if (cell.width !== CELL_WIDTH || cell.height !== CELL_HEIGHT) cell = fitToCell(cell);
      alphaComposite(atlas, cell, col * CELL_WIDTH, spec.row * CELL_HEIGHT);
    }
  }
  return clearTransparentRgb(atlas);
}

/** Encode an atlas to lossless WebP bytes (the on-disk pet format). */
export async function atlasToWebpBytes(atlas: RgbaImage): Promise<Uint8Array> {
  return encodeWebpLossless(atlas);
}

/**
 * Check geometry, per-cell occupancy, and transparency invariants.
 *
 * Errors are blockers (wrong size, empty atlas, collapsed sprites, RGB
 * residue); warnings are soft (a whole state row blank — generation dropped a
 * row).
 */
export function validateAtlas(atlas: RgbaImage): AtlasValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (atlas.width !== ATLAS_WIDTH || atlas.height !== ATLAS_HEIGHT) {
    errors.push(`expected ${ATLAS_WIDTH}x${ATLAS_HEIGHT}, got ${atlas.width}x${atlas.height}`);
    return {
      ok: false,
      width: atlas.width,
      height: atlas.height,
      errors,
      warnings,
      filledStates: [],
    };
  }

  const filledStates: string[] = [];
  const boxesByState = new Map<string, number[][]>();
  for (const spec of ROW_SPECS) {
    let rowPixels = 0;
    const boxes: number[][] = [];
    for (let col = 0; col < spec.frames; col += 1) {
      const cell = cropImage(atlas, {
        left: col * CELL_WIDTH,
        top: spec.row * CELL_HEIGHT,
        right: (col + 1) * CELL_WIDTH,
        bottom: (spec.row + 1) * CELL_HEIGHT,
      });
      for (let i = 3; i < cell.data.length; i += 4) {
        if (cell.data[i] > 0) rowPixels += 1;
      }
      const bbox = getBbox(cell);
      if (bbox !== null) boxes.push([bbox.left, bbox.top, bbox.right, bbox.bottom]);
    }
    if (rowPixels > 0) {
      filledStates.push(spec.state);
      boxesByState.set(spec.state, boxes);
    } else {
      warnings.push(`state '${spec.state}' has no frames`);
    }
  }

  if (filledStates.length === 0) errors.push("atlas is empty — no state produced any frames");

  // A visually valid pet must occupy the cell: one bad row can otherwise poison
  // global normalization and shrink every state to a postage stamp while still
  // passing a naive "non-empty cells" check.
  const allWidths: number[] = [];
  const allHeights: number[] = [];
  for (const boxes of boxesByState.values()) {
    for (const [left, top, right, bottom] of boxes) {
      allWidths.push(right - left);
      allHeights.push(bottom - top);
    }
  }
  allWidths.sort((a, b) => a - b);
  allHeights.sort((a, b) => a - b);
  let globalMedianWidth = 0;
  let globalMedianHeight = 0;
  if (allWidths.length > 0 && allHeights.length > 0) {
    globalMedianWidth = allWidths[Math.floor(allWidths.length / 2)];
    const medianHeight = allHeights[Math.floor(allHeights.length / 2)];
    globalMedianHeight = medianHeight;
    const minHeight = Math.max(56, Math.round(CELL_HEIGHT * 0.28));
    if (medianHeight < minHeight) {
      errors.push(
        `atlas sprites are too small after normalization (median frame height ${medianHeight}px)`,
      );
    }
  }

  for (const [state, boxes] of boxesByState) {
    if (boxes.length <= 1) continue;
    const widths = boxes.map(([left, , right]) => right - left).sort((a, b) => a - b);
    const heights = boxes.map(([, top, , bottom]) => bottom - top).sort((a, b) => a - b);
    const medianWidth = Math.max(1, widths[Math.floor(widths.length / 2)]);
    const medianHeight = Math.max(1, heights[Math.floor(heights.length / 2)]);
    const maxWidth = widths[widths.length - 1];
    const maxHeight = heights[heights.length - 1];
    if (maxWidth > Math.max(medianWidth * 3, medianWidth + 96) && maxHeight <= medianHeight * 1.6) {
      errors.push(`state '${state}' contains a multi-pose frame outlier`);
    }
    if (globalMedianWidth && globalMedianHeight) {
      const minStateWidth = Math.max(32, Math.round(globalMedianWidth * 0.42));
      const minStateHeight = Math.max(40, Math.round(globalMedianHeight * 0.5));
      if (medianWidth < minStateWidth || medianHeight < minStateHeight) {
        errors.push(
          `state '${state}' appears collapsed (median ${medianWidth}x${medianHeight}px, global median ${globalMedianWidth}x${globalMedianHeight}px)`,
        );
      }
    }
  }

  let residue = 0;
  for (let i = 0; i < atlas.data.length; i += 4) {
    if (
      atlas.data[i + 3] === 0 &&
      (atlas.data[i] !== 0 || atlas.data[i + 1] !== 0 || atlas.data[i + 2] !== 0)
    ) {
      residue += 1;
    }
  }
  if (residue > 0) errors.push(`${residue} transparent pixels retain RGB residue`);

  return {
    ok: errors.length === 0,
    width: atlas.width,
    height: atlas.height,
    errors,
    warnings,
    filledStates,
  };
}
