/**
 * Background removal for generated sprite strips — server-only.
 *
 * Port of `agent/pet/generate/atlas.py`: chroma keying (near-key mask for
 * saturated chroma, border flood-fill for desaturated keys), the 1px defringe
 * pass, and internal alpha-hole repair. Inputs and outputs are RGBA buffers;
 * the Python original drives the same passes through PIL.
 */

import { ALPHA_FLOOR } from "./constants.server";
import { cloneRgba, roundHalfToEven, type Rgb, type RgbaImage } from "./pixels.server";

export interface RemoveBackgroundOptions {
  /** Explicit chroma key; defaults to the dominant opaque corner colour. */
  readonly chromaKey?: Rgb;
  /** Euclidean RGB distance treated as background (Python default 90). */
  readonly threshold?: number;
}

function colorDistance(r: number, g: number, b: number, key: Rgb): number {
  return Math.sqrt((r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2);
}

/** True when the image already carries a real alpha background. */
export function hasTransparency(image: RgbaImage): boolean {
  const { data, width, height } = image;
  let minimum = 255;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < minimum) minimum = data[i];
  }
  if (minimum > ALPHA_FLOOR) return false;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] <= ALPHA_FLOOR) transparent += 1;
  }
  return transparent > width * height * 0.05;
}

/** Most common opaque colour among the four corners (fallback pure green). */
export function dominantCornerColor(image: RgbaImage): Rgb {
  const { width, height, data } = image;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  const seen: Array<{ key: string; rgb: Rgb; count: number }> = [];
  for (const [x, y] of corners) {
    const i = (y * width + x) * 4;
    if (data[i + 3] <= ALPHA_FLOOR) continue;
    const rgb: Rgb = [data[i], data[i + 1], data[i + 2]];
    const existing = seen.find((entry) => entry.key === rgb.join(","));
    if (existing) existing.count += 1;
    else seen.push({ key: rgb.join(","), rgb, count: 1 });
  }
  if (seen.length === 0) return [0, 255, 0];
  return seen.reduce((best, entry) => (entry.count > best.count ? entry : best)).rgb;
}

/**
 * 1px alpha erosion: drops the antialiased key/sprite blend ring that chroma
 * keying leaves behind (PIL `MinFilter(3)` over the alpha channel).
 */
export function defringe(image: RgbaImage): RgbaImage {
  const { width, height, data } = image;
  const out = data.slice();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let minimum = 255;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = Math.max(0, Math.min(height - 1, y + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = Math.max(0, Math.min(width - 1, x + dx));
          const alpha = data[(ny * width + nx) * 4 + 3];
          if (alpha < minimum) minimum = alpha;
        }
      }
      out[(y * width + x) * 4 + 3] = minimum;
    }
  }
  return { width, height, data: out };
}

/**
 * Fill transparent islands fully enclosed by opaque sprite pixels with the
 * average colour of their opaque neighbours; transparency reachable from the
 * image edge stays background (PIL swiss-cheese alpha repair).
 */
export function repairInternalAlphaHoles(image: RgbaImage): RgbaImage {
  const { width, height } = image;
  const out = cloneRgba(image);
  const data = out.data;
  const total = width * height;
  const visited = new Uint8Array(total);
  const transparent = (index: number): boolean => data[index * 4 + 3] <= ALPHA_FLOOR;
  const neighbours = (index: number): number[] => {
    const x = index % width;
    const y = (index / width) | 0;
    const found: number[] = [];
    if (x + 1 < width) found.push(index + 1);
    if (x > 0) found.push(index - 1);
    if (y + 1 < height) found.push(index + width);
    if (y > 0) found.push(index - width);
    return found;
  };

  const markBackground = (start: number): void => {
    const queue: number[] = [start];
    visited[start] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      for (const next of neighbours(queue[head])) {
        if (visited[next] !== 0 || !transparent(next)) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
  };

  for (let x = 0; x < width; x += 1) {
    const top = x;
    const bottom = (height - 1) * width + x;
    if (transparent(top) && visited[top] === 0) markBackground(top);
    if (transparent(bottom) && visited[bottom] === 0) markBackground(bottom);
  }
  for (let y = 0; y < height; y += 1) {
    const left = y * width;
    const right = left + width - 1;
    if (transparent(left) && visited[left] === 0) markBackground(left);
    if (transparent(right) && visited[right] === 0) markBackground(right);
  }

  for (let start = 0; start < total; start += 1) {
    if (visited[start] !== 0 || !transparent(start)) continue;
    const hole: number[] = [start];
    visited[start] = 1;
    for (let head = 0; head < hole.length; head += 1) {
      for (const next of neighbours(hole[head])) {
        if (visited[next] !== 0 || !transparent(next)) continue;
        visited[next] = 1;
        hole.push(next);
      }
    }
    const holeSet = new Set(hole);
    const samples: number[][] = [];
    for (const index of hole) {
      for (const next of neighbours(index)) {
        if (holeSet.has(next)) continue;
        const at = next * 4;
        if (data[at + 3] > ALPHA_FLOOR) samples.push([data[at], data[at + 1], data[at + 2]]);
      }
    }
    let fill: readonly [number, number, number, number] = [0, 0, 0, 255];
    if (samples.length > 0) {
      fill = [average(samples, 0), average(samples, 1), average(samples, 2), 255];
    }
    for (const index of hole) {
      const at = index * 4;
      data[at] = fill[0];
      data[at + 1] = fill[1];
      data[at + 2] = fill[2];
      data[at + 3] = fill[3];
    }
  }
  return out;
}

function average(samples: number[][], channel: number): number {
  let sum = 0;
  for (const sample of samples) sum += sample[channel];
  return roundHalfToEven(sum / samples.length);
}

/**
 * Return the image with its flat backdrop keyed out to transparent.
 *
 * Existing transparency is preserved (and repaired); otherwise the key —
 * explicit or the dominant corner colour — is removed either by a near-key
 * mask (saturated keys such as hot magenta: also clears trapped chroma
 * pockets) or by a border flood-fill (desaturated keys: only backdrop pixels
 * reachable from an edge, so interior highlights matching the key survive).
 * Both paths finish with a one-pixel defringe.
 */
export function removeBackground(
  image: RgbaImage,
  options: RemoveBackgroundOptions = {},
): RgbaImage {
  const rgba = cloneRgba(image);
  if (hasTransparency(rgba)) return repairInternalAlphaHoles(rgba);

  const key = options.chromaKey ?? dominantCornerColor(rgba);
  const threshold = options.threshold ?? 90;
  const saturated = Math.max(...key) - Math.min(...key) >= 120;

  if (saturated) {
    const { data } = rgba;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at + 3] <= ALPHA_FLOOR) continue;
      if (
        Math.abs(data[at] - key[0]) <= 48 &&
        Math.abs(data[at + 1] - key[1]) <= 48 &&
        Math.abs(data[at + 2] - key[2]) <= 48
      ) {
        data[at] = 0;
        data[at + 1] = 0;
        data[at + 2] = 0;
        data[at + 3] = 0;
      }
    }
    return defringe(rgba);
  }

  const { width, height } = rgba;
  const data = rgba.data;
  const isBackground = (index: number): boolean => {
    const at = index * 4;
    return (
      data[at + 3] > ALPHA_FLOOR &&
      colorDistance(data[at], data[at + 1], data[at + 2], key) <= threshold
    );
  };

  const visited = new Uint8Array(width * height);
  const remove = new Uint8Array(width * height);
  const queue: number[] = [];
  const seed = (index: number): void => {
    if (visited[index] !== 0 || !isBackground(index)) return;
    visited[index] = 1;
    queue.push(index);
  };
  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  const enqueue = (next: number): void => {
    if (visited[next] !== 0) return;
    visited[next] = 1;
    if (isBackground(next)) queue.push(next);
  };

  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    remove[index] = 1;
    const x = index % width;
    const y = (index / width) | 0;
    if (x + 1 < width) enqueue(index + 1);
    if (x > 0) enqueue(index - 1);
    if (y + 1 < height) enqueue(index + width);
    if (y > 0) enqueue(index - width);
  }

  const out = cloneRgba(rgba);
  for (let index = 0; index < remove.length; index += 1) {
    if (remove[index] === 0) continue;
    const at = index * 4;
    out.data[at] = 0;
    out.data[at + 1] = 0;
    out.data[at + 2] = 0;
    out.data[at + 3] = 0;
  }
  return defringe(out);
}
