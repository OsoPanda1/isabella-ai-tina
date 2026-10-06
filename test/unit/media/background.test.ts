import { describe, expect, it } from "vitest";

import {
  defringe,
  dominantCornerColor,
  hasTransparency,
  removeBackground,
  repairInternalAlphaHoles,
} from "../../../src/lib/media/background.server";
import { createRgba } from "../../../src/lib/media/pixels.server";

import { alphaAt, fillRect, rgbAt, solid } from "./fixtures";

describe("media background keying", () => {
  it("keys out a flat magenta backdrop and keeps the subject opaque", () => {
    const strip = solid(64, 64, [255, 0, 255]);
    fillRect(strip, { left: 16, top: 16, right: 48, bottom: 48 }, [40, 90, 200]);

    const keyed = removeBackground(strip);

    expect(alphaAt(keyed, 2, 2)).toBe(0);
    expect(rgbAt(keyed, 2, 2)).toEqual([0, 0, 0]);
    expect(alphaAt(keyed, 32, 32)).toBe(255);
    expect(rgbAt(keyed, 32, 32)).toEqual([40, 90, 200]);
  });

  it("keeps interior pixels that only look like a desaturated backdrop", () => {
    const strip = solid(64, 64, [240, 240, 240]);
    fillRect(strip, { left: 16, top: 16, right: 48, bottom: 48 }, [20, 20, 20]);
    fillRect(strip, { left: 30, top: 30, right: 34, bottom: 34 }, [240, 240, 240]);

    const keyed = removeBackground(strip, { chromaKey: [240, 240, 240] });

    expect(alphaAt(keyed, 2, 2)).toBe(0);
    expect(alphaAt(keyed, 32, 32)).toBe(255);
    expect(rgbAt(keyed, 32, 32)).toEqual([240, 240, 240]);
  });

  it("detects a real alpha background and repairs enclosed holes", () => {
    const image = solid(24, 24, [0, 0, 0], 0);
    fillRect(image, { left: 4, top: 4, right: 20, bottom: 20 }, [200, 40, 40], 255);
    fillRect(image, { left: 10, top: 10, right: 14, bottom: 14 }, [1, 2, 3], 0);

    expect(hasTransparency(image)).toBe(true);
    const repaired = removeBackground(image);
    expect(alphaAt(repaired, 12, 12)).toBe(255);
    expect(rgbAt(repaired, 12, 12)).toEqual([200, 40, 40]);
    expect(alphaAt(repaired, 1, 1)).toBe(0);
  });

  it("treats an opaque image as having no alpha background", () => {
    expect(hasTransparency(solid(32, 32, [10, 12, 14]))).toBe(false);
    expect(hasTransparency(createRgba(32, 32))).toBe(true);
  });

  it("fills an enclosed alpha hole with the neighbours' average colour", () => {
    const image = solid(16, 16, [255, 0, 0]);
    fillRect(image, { left: 7, top: 7, right: 9, bottom: 9 }, [9, 9, 9], 0);

    const repaired = repairInternalAlphaHoles(image);

    expect(alphaAt(repaired, 7, 7)).toBe(255);
    expect(rgbAt(repaired, 7, 7)).toEqual([255, 0, 0]);
  });

  it("reads the dominant opaque corner colour", () => {
    const image = solid(20, 20, [12, 200, 64]);
    expect(dominantCornerColor(image)).toEqual([12, 200, 64]);

    const empty = createRgba(8, 8);
    expect(dominantCornerColor(empty)).toEqual([0, 255, 0]);
  });

  it("erodes alpha by one pixel to shave the antialiased key ring", () => {
    const image = solid(8, 8, [0, 0, 0], 0);
    fillRect(image, { left: 2, top: 2, right: 6, bottom: 6 }, [255, 255, 255], 255);

    const eroded = defringe(image);

    expect(alphaAt(eroded, 2, 2)).toBe(0);
    expect(alphaAt(eroded, 3, 3)).toBe(255);
  });
});
