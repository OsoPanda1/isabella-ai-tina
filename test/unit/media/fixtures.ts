/**
 * Synthetic image fixtures for the media pipeline tests.
 *
 * Everything here is programmatically generated RGBA — flat chroma-key strips,
 * single poses, opaque blocks — never real product art. `toPng` / `toWebp`
 * round-trip through sharp so providers can be faked with real encoded bytes.
 */

import type { RgbaImage, Rect, Rgb } from "../../../src/lib/media/pixels.server";
import { createRgba, encodePng, encodeWebpLossless } from "../../../src/lib/media/pixels.server";

/** Pure magenta — the chroma key the row prompts ask for. */
export const MAGENTA: Rgb = [255, 0, 255];

/** Flat opaque canvas. */
export function solid(width: number, height: number, rgb: Rgb, alpha = 255): RgbaImage {
  return createRgba(width, height, { r: rgb[0], g: rgb[1], b: rgb[2], alpha });
}

/** Paint a rectangle into an existing buffer (exclusive right/bottom edges). */
export function fillRect(image: RgbaImage, rect: Rect, rgb: Rgb, alpha = 255): void {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(image.width, rect.right);
  const bottom = Math.min(image.height, rect.bottom);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const at = (y * image.width + x) * 4;
      image.data[at] = rgb[0];
      image.data[at + 1] = rgb[1];
      image.data[at + 2] = rgb[2];
      image.data[at + 3] = alpha;
    }
  }
}

/** Alpha at a pixel, for assertions. */
export function alphaAt(image: RgbaImage, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3];
}

/** RGB triple at a pixel, for assertions. */
export function rgbAt(image: RgbaImage, x: number, y: number): Rgb {
  const at = (y * image.width + x) * 4;
  return [image.data[at], image.data[at + 1], image.data[at + 2]];
}

export interface PoseStripOptions {
  /** Pose width in pixels (default 50). */
  readonly poseWidth?: number;
  /** Pose height in pixels (default 70). */
  readonly poseHeight?: number;
  /** Strip height in pixels (default 120). */
  readonly stripHeight?: number;
  /** Background colour (default magenta). */
  readonly background?: Rgb;
}

/**
 * A row strip: `count` identical poses, each centred in its own equal slot,
 * separated by real chroma gutters — the shape the prompts ask the model for.
 */
export function poseStrip(count: number, options: PoseStripOptions = {}): RgbaImage {
  const poseWidth = options.poseWidth ?? 50;
  const poseHeight = options.poseHeight ?? 70;
  const height = options.stripHeight ?? 120;
  const background = options.background ?? MAGENTA;
  const slotWidth = count * 100;
  const strip = solid(slotWidth, height, background);
  for (let i = 0; i < count; i += 1) {
    const slotLeft = i * 100;
    const left = slotLeft + Math.round((100 - poseWidth) / 2);
    const top = Math.round((height - poseHeight) / 2);
    fillRect(strip, { left, top, right: left + poseWidth, bottom: top + poseHeight }, [
      40 + i * 20,
      90,
      200,
    ]);
  }
  return strip;
}

/** Encode RGBA as PNG bytes (what a provider would hand back). */
export async function toPng(image: RgbaImage): Promise<Uint8Array> {
  const buffer = await encodePng(image);
  return new Uint8Array(buffer);
}

/** Encode RGBA as lossless WebP bytes. */
export async function toWebp(image: RgbaImage): Promise<Uint8Array> {
  const buffer = await encodeWebpLossless(image);
  return new Uint8Array(buffer);
}

/** A standalone "base look" image: magenta backdrop with one centred subject. */
export function baseLook(width = 128, height = 128): RgbaImage {
  const image = solid(width, height, MAGENTA);
  const left = Math.round((width - 60) / 2);
  const top = Math.round((height - 72) / 2);
  fillRect(image, { left, top, right: left + 60, bottom: top + 72 }, [30, 160, 90]);
  return image;
}
