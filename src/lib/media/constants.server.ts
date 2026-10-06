/**
 * Spritesheet geometry for the Hermes/Codex petdex atlas — server-only.
 *
 * Port of `agent/pet/generate/atlas.py` (ROW_SPECS, cell metrics) and
 * `agent/pet/constants.py` (FRAME_W / FRAME_H). The row order and per-row
 * frame counts are part of the petdex contract: the renderer keys frames as
 * rows = states, cols = frames, so reordering ROW_SPECS breaks every pet.
 */

/** Native cell width in pixels (petdex/Codex standard). */
export const FRAME_WIDTH = 192;

/** Native cell height in pixels (petdex/Codex standard). */
export const FRAME_HEIGHT = 208;

/** Alias used while composing a sheet: one cell of the atlas grid. */
export const CELL_WIDTH = FRAME_WIDTH;

/** Alias used while composing a sheet: one cell of the atlas grid. */
export const CELL_HEIGHT = FRAME_HEIGHT;

export interface RowSpec {
  /** Animation state this row drives (renderer row key). */
  readonly state: string;
  /** Zero-based row index in the atlas. */
  readonly row: number;
  /** Frames the petdex spec reserves for this row; short rows stay transparent. */
  readonly frames: number;
}

export const ROW_SPECS: readonly RowSpec[] = [
  { state: "idle", row: 0, frames: 6 },
  { state: "running-right", row: 1, frames: 8 },
  { state: "running-left", row: 2, frames: 8 },
  { state: "waving", row: 3, frames: 4 },
  { state: "jumping", row: 4, frames: 5 },
  { state: "failed", row: 5, frames: 8 },
  { state: "waiting", row: 6, frames: 6 },
  { state: "running", row: 7, frames: 6 },
  { state: "review", row: 8, frames: 6 },
];

export const ROWS = ROW_SPECS.length;

export const COLUMNS = ROW_SPECS.reduce((max, spec) => Math.max(max, spec.frames), 0);

export const ATLAS_WIDTH = COLUMNS * CELL_WIDTH;

export const ATLAS_HEIGHT = ROWS * CELL_HEIGHT;

/** Frames reserved per state, keyed in ROW_SPECS order (stable iteration). */
export const FRAME_COUNTS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(ROW_SPECS.map((spec) => [spec.state, spec.frames])),
);

/** Alpha at/below which a pixel counts as background for component detection. */
export const ALPHA_FLOOR = 16;

/** Cell padding kept around a fitted sprite so poses never touch the edge. */
export const CELL_PAD = 10;

/** Padding for the normalized pass — small, so cells fill like real petdex pets. */
export const NORMALIZE_PAD = 14;

/** Side-lobe cutoff when dropping neighbour-bleed slivers (mass ratio). */
export const SIDE_LOBE_RATIO = 0.18;
