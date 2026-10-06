import { describe, expect, it } from "vitest";

import { atlasToWebpBytes, composeAtlas, validateAtlas } from "../../../src/lib/media/atlas.server";
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
} from "../../../src/lib/media/constants.server";
import {
  createRgba,
  decodeRgba,
  getBbox,
  type RgbaImage,
} from "../../../src/lib/media/pixels.server";

import { alphaAt, fillRect } from "./fixtures";

function cellWithBlock(): RgbaImage {
  const cell = createRgba(CELL_WIDTH, CELL_HEIGHT);
  fillRect(cell, { left: 56, top: 54, right: 136, bottom: 154 }, [60, 120, 200]);
  return cell;
}

/** Count the cells of one atlas row that hold any visible pixel. */
function filledCellsInRow(atlas: RgbaImage, row: number, columns: number): number {
  let filled = 0;
  for (let col = 0; col < columns; col += 1) {
    let hasContent = false;
    for (let y = 0; y < CELL_HEIGHT && !hasContent; y += 4) {
      for (let x = 0; x < CELL_WIDTH; x += 4) {
        const px = col * CELL_WIDTH + x;
        const py = row * CELL_HEIGHT + y;
        if (alphaAt(atlas, px, py) > 0) {
          hasContent = true;
          break;
        }
      }
    }
    if (hasContent) filled += 1;
  }
  return filled;
}

describe("media atlas composition", () => {
  it("packs cells and reports the rows that were filled", () => {
    const atlas = composeAtlas({ idle: Array.from({ length: 6 }, cellWithBlock) });
    const validation = validateAtlas(atlas);

    expect(atlas.width).toBe(ATLAS_WIDTH);
    expect(atlas.height).toBe(ATLAS_HEIGHT);
    expect(validation.ok).toBe(true);
    expect(validation.filledStates).toEqual(["idle"]);
    expect(validation.warnings).toContain("state 'running-right' has no frames");
    expect(validation.errors).toEqual([]);
  });

  it("drops frames beyond a state's reserved count", () => {
    const atlas = composeAtlas({ idle: Array.from({ length: 8 }, cellWithBlock) });

    expect(filledCellsInRow(atlas, 0, 8)).toBe(6);
  });

  it("fits a frame that is not already cell sized", () => {
    const small = createRgba(60, 40);
    fillRect(small, { left: 0, top: 0, right: 60, bottom: 40 }, [10, 200, 30]);

    const atlas = composeAtlas({ waiting: [small] });
    // waiting is row 6; fitToCell centers a 60x40 sprite in its 192x208 cell.
    const left = 66 + 10;
    const top = 6 * CELL_HEIGHT + 84 + 5;

    expect(alphaAt(atlas, left, top)).toBeGreaterThan(0);
  });

  it("fails closed on the wrong geometry", () => {
    const validation = validateAtlas(createRgba(64, 64));

    expect(validation.ok).toBe(false);
    expect(validation.errors[0]).toMatch(/expected 1536x1872, got 64x64/);
    expect(validation.filledStates).toEqual([]);
  });

  it("rejects an atlas whose transparent pixels keep colour residue", () => {
    const atlas = createRgba(ATLAS_WIDTH, ATLAS_HEIGHT);
    atlas.data[0] = 5;

    const validation = validateAtlas(atlas);

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("; ")).toMatch(/transparent pixels retain RGB residue/);
  });

  it("rejects an atlas with no usable rows at all", () => {
    const validation = validateAtlas(createRgba(ATLAS_WIDTH, ATLAS_HEIGHT));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("atlas is empty — no state produced any frames");
    expect(validation.warnings).toHaveLength(9);
  });

  it("round-trips lossless WebP bytes", async () => {
    const atlas = composeAtlas({ idle: Array.from({ length: 6 }, cellWithBlock) });

    const encoded = await atlasToWebpBytes(atlas);
    const decoded = await decodeRgba(encoded);

    expect(encoded.byteLength).toBeGreaterThan(0);
    expect(decoded.width).toBe(ATLAS_WIDTH);
    expect(decoded.height).toBe(ATLAS_HEIGHT);
    expect(Buffer.from(decoded.data).equals(Buffer.from(atlas.data))).toBe(true);
    expect(getBbox(decoded)).not.toBeNull();
  });
});
