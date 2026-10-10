import { describe, expect, it } from "vitest";

import {
  columnProfile,
  contentRuns,
  extractStripFrames,
  fitToCell,
  mirrorFrames,
  normalizeCells,
  singleFrame,
  validateExtractedFrames,
} from "../../../src/lib/media/frames.server";
import { CELL_HEIGHT, CELL_WIDTH } from "../../../src/lib/media/constants.server";
import { createRgba, getBbox } from "../../../src/lib/media/pixels.server";

import { baseLook, fillRect, poseStrip, rgbAt, solid } from "./fixtures";

describe("media frame extraction", () => {
  it("finds contiguous content runs in a column profile", () => {
    const profile = [0, 0, 5, 9, 0, 0, 7, 0];
    expect(contentRuns(profile)).toEqual([
      [2, 4],
      [6, 7],
    ]);
    expect(contentRuns([0, 1, 2])).toEqual([]);
  });

  it("averages alpha per column", () => {
    const image = solid(4, 4, [255, 255, 255], 0);
    fillRect(image, { left: 0, top: 0, right: 2, bottom: 4 }, [255, 255, 255], 200);
    expect(columnProfile(image)).toEqual([200, 200, 0, 0]);
  });

  it("slices a padded strip into the requested frames", () => {
    const strip = poseStrip(4);

    const frames = extractStripFrames(strip, 4);

    expect(frames).toHaveLength(4);
    for (const frame of frames) {
      expect(frame.width).toBe(CELL_WIDTH);
      expect(frame.height).toBe(CELL_HEIGHT);
      expect(getBbox(frame)).not.toBeNull();
    }
  });

  it("keeps raw frame coordinates when fit is disabled", () => {
    const frames = extractStripFrames(poseStrip(3), 3, { fit: false });

    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      expect(frame.height).toBe(120);
      expect(frame.width).toBeLessThan(100);
    }
  });

  it("refuses to slice touching poses when clean gutters are required", () => {
    const touching = solid(400, 120, [255, 0, 255]);
    fillRect(touching, { left: 20, top: 20, right: 380, bottom: 100 }, [40, 90, 200]);

    expect(() => extractStripFrames(touching, 4, { method: "components" })).toThrow(
      /could not segment 4 padded sprites/,
    );
  });

  it("rejects frames that are empty or double-pose", () => {
    const blank = createRgba(CELL_WIDTH, CELL_HEIGHT);
    expect(() => validateExtractedFrames([blank], 1)).toThrow(/frame 0 is empty/);
    expect(() => validateExtractedFrames([blank], 2)).toThrow(/expected 2 frames/);
  });

  it("centers a sprite into a finished cell", () => {
    const source = createRgba(400, 300);
    fillRect(source, { left: 160, top: 100, right: 240, bottom: 200 }, [10, 20, 30]);

    const cell = fitToCell(source);
    const bbox = getBbox(cell);

    expect(cell.width).toBe(CELL_WIDTH);
    expect(cell.height).toBe(CELL_HEIGHT);
    expect(bbox).not.toBeNull();
    if (bbox === null) return;
    expect(Math.abs((bbox.left + bbox.right) / 2 - CELL_WIDTH / 2)).toBeLessThanOrEqual(1);
    expect(bbox.right - bbox.left).toBeLessThanOrEqual(CELL_WIDTH - 20);
  });

  it("fits a standalone base image into a cell", () => {
    const cell = singleFrame(baseLook());
    expect(cell.width).toBe(CELL_WIDTH);
    expect(cell.height).toBe(CELL_HEIGHT);
    expect(getBbox(cell)).not.toBeNull();
  });

  it("mirrors frames per frame, preserving frame order", () => {
    const frame = solid(10, 6, [255, 0, 255]);
    fillRect(frame, { left: 0, top: 0, right: 4, bottom: 6 }, [7, 7, 7]);

    const [mirrored] = mirrorFrames([frame]);

    expect(mirrored.width).toBe(10);
    expect(rgbAt(mirrored, 9, 0)).toEqual([7, 7, 7]);
    expect(rgbAt(mirrored, 0, 0)).toEqual([255, 0, 255]);
  });
});

describe("media cell normalization", () => {
  it("registers every state into 192x208 cells", () => {
    const makeFrame = (offset: number) => {
      const frame = createRgba(120, 90);
      fillRect(
        frame,
        { left: 30 + offset, top: 10, right: 80 + offset, bottom: 80 },
        [60, 120, 200],
      );
      return frame;
    };

    const cells = normalizeCells({ idle: [makeFrame(0), makeFrame(4)], running: [makeFrame(2)] });

    expect(Object.keys(cells).sort()).toEqual(["idle", "running"]);
    expect(cells.idle).toHaveLength(2);
    expect(cells.running).toHaveLength(1);
    for (const frames of Object.values(cells)) {
      for (const frame of frames) {
        expect(frame.width).toBe(CELL_WIDTH);
        expect(frame.height).toBe(CELL_HEIGHT);
        expect(getBbox(frame)).not.toBeNull();
      }
    }
  });

  it("emits blank cells for a state with no visible pixels", () => {
    const cells = normalizeCells({ failed: [createRgba(40, 40), createRgba(40, 40)] });

    expect(cells.failed).toHaveLength(2);
    expect(getBbox(cells.failed[0])).toBeNull();
  });
});
