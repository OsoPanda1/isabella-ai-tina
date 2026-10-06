/**
 * RGBA pixel primitives for the image pipeline — server-only.
 *
 * The Python source drives these operations through PIL; here every per-pixel
 * algorithm runs on a plain RGBA buffer so results are reproducible byte for
 * byte, and `sharp` is used only as the codec (decode any input format, encode
 * PNG / lossless WebP) that PIL's `Image.open` and `Image.save` covered.
 */

import sharp from "sharp";

/** sRGB colour triple, 0-255 per channel. */
export type Rgb = readonly [number, number, number];

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA, four bytes per pixel. */
  readonly data: Uint8Array;
}

/** Pixel box with exclusive right/bottom edges (PIL `getbbox` convention). */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Python's `round()` — ties resolve to the nearest even integer. */
export function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export interface RgbaFill {
  readonly r?: number;
  readonly g?: number;
  readonly b?: number;
  readonly alpha?: number;
}

/** Allocate a canvas; omitted channels default to 0 (fully transparent). */
export function createRgba(width: number, height: number, fill: RgbaFill = {}): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  const r = fill.r ?? 0;
  const g = fill.g ?? 0;
  const b = fill.b ?? 0;
  const alpha = fill.alpha ?? 0;
  if (r === 0 && g === 0 && b === 0 && alpha === 0) return { width, height, data };
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = alpha;
  }
  return { width, height, data };
}

export function cloneRgba(image: RgbaImage): RgbaImage {
  return { width: image.width, height: image.height, data: image.data.slice() };
}

/** Bounding box of pixels with any non-zero channel; `null` when fully empty. */
export function getBbox(image: RgbaImage): Rect | null {
  const { width, height, data } = image;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const i = row + x * 4;
      if ((data[i] | data[i + 1] | data[i + 2] | data[i + 3]) === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

/** Copy a rectangle out of an image, clipping it to the source bounds. */
export function cropImage(image: RgbaImage, rect: Rect): RgbaImage {
  const left = Math.max(0, Math.min(image.width, rect.left));
  const top = Math.max(0, Math.min(image.height, rect.top));
  const right = Math.max(left, Math.min(image.width, rect.right));
  const bottom = Math.max(top, Math.min(image.height, rect.bottom));
  const width = right - left;
  const height = bottom - top;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const source = ((top + y) * image.width + left) * 4;
    data.set(image.data.subarray(source, source + width * 4), y * width * 4);
  }
  return { width, height, data };
}

/** Nearest-neighbour resample — keeps hard pixel-art edges crisp. */
export function resizeNearest(image: RgbaImage, width: number, height: number): RgbaImage {
  const targetWidth = Math.max(1, width);
  const targetHeight = Math.max(1, height);
  if (targetWidth === image.width && targetHeight === image.height) return cloneRgba(image);
  const data = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(
      image.height - 1,
      Math.floor(((y + 0.5) * image.height) / targetHeight),
    );
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(
        image.width - 1,
        Math.floor(((x + 0.5) * image.width) / targetWidth),
      );
      const from = (sourceY * image.width + sourceX) * 4;
      const to = (y * targetWidth + x) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = image.data[from + 3];
    }
  }
  return { width: targetWidth, height: targetHeight, data };
}

/**
 * Source-over `dest = src over dest`, clipped to the destination bounds.
 *
 * Fully transparent sources leave the destination untouched, and compositing
 * onto an empty canvas is an exact copy — the invariant every fit, normalize
 * and compose step relies on.
 */
export function alphaComposite(
  destination: RgbaImage,
  source: RgbaImage,
  dx: number,
  dy: number,
): void {
  for (let sy = 0; sy < source.height; sy += 1) {
    const ty = dy + sy;
    if (ty < 0 || ty >= destination.height) continue;
    for (let sx = 0; sx < source.width; sx += 1) {
      const tx = dx + sx;
      if (tx < 0 || tx >= destination.width) continue;
      const from = (sy * source.width + sx) * 4;
      const sa = source.data[from + 3];
      if (sa === 0) continue;
      const to = (ty * destination.width + tx) * 4;
      const da = destination.data[to + 3];
      if (da === 0) {
        destination.data[to] = source.data[from];
        destination.data[to + 1] = source.data[from + 1];
        destination.data[to + 2] = source.data[from + 2];
        destination.data[to + 3] = sa;
        continue;
      }
      const kept = (da * (255 - sa)) / 255;
      const outAlpha = Math.min(255, Math.round(sa + kept));
      for (let channel = 0; channel < 3; channel += 1) {
        const blended = source.data[from + channel] * sa + destination.data[to + channel] * kept;
        destination.data[to + channel] = Math.max(0, Math.min(255, Math.round(blended / outAlpha)));
      }
      destination.data[to + 3] = outAlpha;
    }
  }
}

/** Zero the RGB of fully transparent pixels so no coloured halo survives. */
export function clearTransparentRgb(image: RgbaImage): RgbaImage {
  const data = image.data.slice();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0) continue;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  }
  return { width: image.width, height: image.height, data };
}

/** Decode encoded image bytes (or a local file path) into RGBA. */
export async function decodeRgba(input: Uint8Array | string): Promise<RgbaImage> {
  const { data, info } = await sharp(input)
    .toColourspace("srgb")
    .ensureAlpha()
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) {
    throw new Error(`expected 4 channels after ensureAlpha, got ${String(info.channels)}`);
  }
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

/** Encode RGBA as a PNG buffer (the format drafts are hardened to). */
export async function encodePng(image: RgbaImage): Promise<Buffer> {
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

/** Encode RGBA as lossless WebP — the on-disk spritesheet format. */
export async function encodeWebpLossless(image: RgbaImage): Promise<Buffer> {
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .webp({ lossless: true, quality: 100, effort: 6, exact: true })
    .toBuffer();
}
