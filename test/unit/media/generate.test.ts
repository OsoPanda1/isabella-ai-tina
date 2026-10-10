import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AtlasValidation } from "../../../src/lib/media/atlas.server";
import { ATLAS_HEIGHT, ATLAS_WIDTH } from "../../../src/lib/media/constants.server";
import {
  assertHatchAcceptable,
  draftsFailedReason,
  generateBaseDrafts,
  GenerationError,
  hardenTransparency,
  hardenTransparencyFile,
  hatchPet,
  humanizeImageError,
  type SpriteGenerationProvider,
} from "../../../src/lib/media/generate.server";
import { decodeRgba, type RgbaImage } from "../../../src/lib/media/pixels.server";

import { alphaAt, baseLook, poseStrip, toPng, toWebp } from "./fixtures";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function emptyValidation(): AtlasValidation {
  return {
    ok: true,
    width: ATLAS_WIDTH,
    height: ATLAS_HEIGHT,
    errors: [],
    warnings: [],
    filledStates: [],
  };
}

/** Provider that answers each row prompt with a prebuilt strip for that frame count. */
function stripProvider(seen: SpriteGenerationRequestLog): SpriteGenerationProvider {
  const strips = new Map<number, RgbaImage>();
  for (const count of [4, 5, 6, 8]) strips.set(count, poseStrip(count));
  return {
    generateImage: async (request) => {
      seen.prompts.push(request.prompt);
      seen.referenceCounts.push(request.referenceImages?.length ?? 0);
      seen.aspectRatios.push(request.aspectRatio ?? "square");
      const match = /strip of (\d+) animation frames/.exec(request.prompt);
      const strip = match ? strips.get(Number(match[1])) : undefined;
      if (!strip) throw new Error(`unexpected prompt: ${request.prompt.slice(0, 60)}`);
      return toPng(strip);
    },
  };
}

interface SpriteGenerationRequestLog {
  readonly prompts: string[];
  readonly referenceCounts: number[];
  readonly aspectRatios: string[];
}

function log(): SpriteGenerationRequestLog {
  return { prompts: [], referenceCounts: [], aspectRatios: [] };
}

describe("media generation errors", () => {
  it("humanizes the errors that actually happen", () => {
    expect(humanizeImageError("Error: moderation_blocked by provider")).toMatch(/safety filter/);
    expect(humanizeImageError("401 Unauthorized: bad api key")).toMatch(/API key in Settings/);
    expect(humanizeImageError("HTTP 429 too many requests")).toMatch(/rate-limiting/);
    expect(humanizeImageError("weird\nstack\ntrace")).toBe("weird");
    expect(humanizeImageError("x".repeat(400))).toHaveLength(200);
  });

  it("reports the most common draft failure, humanized", () => {
    expect(draftsFailedReason([])).toBe("image generation produced no usable drafts");
    expect(draftsFailedReason(["rate limit", "rate limit", "401 Unauthorized"])).toMatch(
      /rate-limiting/,
    );
  });

  it("fails closed when no provider is configured", async () => {
    await expect(generateBaseDrafts({ concept: "a clockwork fox" })).rejects.toBeInstanceOf(
      GenerationError,
    );
    await expect(
      hatchPet({ baseImage: new Uint8Array([1, 2, 3]), slug: "fox" }),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("rejects a base image it cannot decode", async () => {
    await expect(
      hatchPet({
        baseImage: new Uint8Array([1, 2, 3]),
        slug: "fox",
        provider: stripProvider(log()),
      }),
    ).rejects.toThrow(/base image could not be decoded/);
  });
});

describe("media base drafts", () => {
  it("drafts distinct variants and streams them as they finish", async () => {
    const seen = { prompts: [] as string[] };
    const provider: SpriteGenerationProvider = {
      generateImage: async (request) => {
        seen.prompts.push(request.prompt);
        return toPng(baseLook());
      },
    };
    const streamed: number[] = [];

    const drafts = await generateBaseDrafts({
      concept: "a clockwork fox",
      count: 4,
      provider,
      onDraft: (index) => streamed.push(index),
    });

    expect(drafts).toHaveLength(4);
    expect([...streamed].sort()).toEqual([0, 1, 2, 3]);
    expect(new Set(seen.prompts).size).toBe(4);
    expect(drafts.every((draft) => draft.byteLength > 0)).toBe(true);
  });

  it("surfaces a representative failure when every draft fails", async () => {
    const provider: SpriteGenerationProvider = {
      generateImage: async () => {
        throw new Error("moderation_blocked: safety system refused");
      },
    };

    await expect(generateBaseDrafts({ concept: "minion", provider })).rejects.toThrow(
      /safety filter rejects/,
    );
  });

  it("returns nothing when already cancelled", async () => {
    const provider: SpriteGenerationProvider = {
      generateImage: async () => toPng(baseLook()),
    };

    const drafts = await generateBaseDrafts({
      concept: "a clockwork fox",
      provider,
      isCancelled: () => true,
    });

    expect(drafts).toEqual([]);
  });
});

describe("media transparency hardening", () => {
  it("keys a solid backdrop out of encoded bytes", async () => {
    const raw = await toPng(baseLook());

    const hardened = await hardenTransparency(raw);
    const decoded = await decodeRgba(hardened);

    expect(alphaAt(decoded, 1, 1)).toBe(0);
    expect(alphaAt(decoded, 64, 64)).toBe(255);
  });

  it("keeps the original bytes when the input cannot be decoded", async () => {
    const junk = new Uint8Array([1, 2, 3, 4]);
    expect(await hardenTransparency(junk)).toBe(junk);
  });

  it("hardens a file in place for PNG and swaps the suffix otherwise", async () => {
    const dir = await mkdtemp(join(tmpdir(), "isabella-media-"));
    tempDirs.push(dir);

    const pngPath = join(dir, "draft.png");
    await writeFile(pngPath, await toPng(baseLook()));
    const samePath = await hardenTransparencyFile(pngPath);
    const png = await decodeRgba(await readFile(samePath));
    expect(samePath).toBe(pngPath);
    expect(alphaAt(png, 1, 1)).toBe(0);

    const webpPath = join(dir, "draft2.webp");
    await writeFile(webpPath, await toWebp(baseLook()));
    const swapped = await hardenTransparencyFile(webpPath);
    expect(swapped).toBe(join(dir, "draft2.png"));
    const swappedImage = await decodeRgba(await readFile(swapped));
    expect(alphaAt(swappedImage, 1, 1)).toBe(0);

    await expect(readFile(webpPath)).rejects.toThrow();
  });
});

describe("media hatch acceptance", () => {
  it("accepts a validated atlas with every required row", () => {
    const validation: AtlasValidation = {
      ...emptyValidation(),
      filledStates: [
        "idle",
        "running-right",
        "running-left",
        "waving",
        "jumping",
        "failed",
        "waiting",
        "running",
        "review",
      ],
    };
    expect(() => assertHatchAcceptable(validation)).not.toThrow();
  });

  it("blocks validation errors, missing required rows and thin row counts", () => {
    expect(() =>
      assertHatchAcceptable({ ...emptyValidation(), ok: false, errors: ["nope"] }),
    ).toThrow(GenerationError);
    expect(() => assertHatchAcceptable({ ...emptyValidation(), filledStates: ["idle"] })).toThrow(
      /missing required animation row\(s\): running-right, waving/,
    );
    expect(() =>
      assertHatchAcceptable({
        ...emptyValidation(),
        filledStates: ["idle", "running-right", "waving", "jumping"],
      }),
    ).toThrow(/only 4\/9 animation rows were usable/);
  });
});

describe("media hatch", () => {
  it("produces a validated atlas from grounded row strips", async () => {
    const seen = log();
    const progress: string[] = [];

    const result = await hatchPet({
      baseImage: await toPng(baseLook()),
      slug: "clockwork-fox",
      displayName: "Clockwork Fox",
      concept: "a clockwork fox",
      provider: stripProvider(seen),
      onProgress: (event, detail) => progress.push(`${event}:${detail}`),
    });

    expect(result.slug).toBe("clockwork-fox");
    expect(result.displayName).toBe("Clockwork Fox");
    expect(result.validation.ok).toBe(true);
    expect(result.states).toEqual(
      expect.arrayContaining(["idle", "running-right", "running-left", "waving"]),
    );
    expect(result.atlas.width).toBe(ATLAS_WIDTH);
    expect(result.atlas.height).toBe(ATLAS_HEIGHT);
    expect(result.spritesheet.byteLength).toBeGreaterThan(0);
    expect(progress).toContain("compose:");
    expect(seen.prompts).toHaveLength(8);
    expect(seen.referenceCounts.every((count) => count === 1)).toBe(true);
    expect(seen.aspectRatios.every((ratio) => ratio === "landscape")).toBe(true);

    const sheet = await decodeRgba(result.spritesheet);
    expect(sheet.width).toBe(ATLAS_WIDTH);
    expect(sheet.height).toBe(ATLAS_HEIGHT);
  });

  it("falls back to the base look for idle, then blocks an unusable hatch", async () => {
    const provider: SpriteGenerationProvider = {
      generateImage: async () => {
        throw new Error("HTTP 429 rate limit");
      },
    };

    await expect(
      hatchPet({ baseImage: await toPng(baseLook()), slug: "broken", provider }),
    ).rejects.toThrow(/missing required animation row\(s\)/);
  });

  it("aborts before composing when cancelled", async () => {
    await expect(
      hatchPet({
        baseImage: await toPng(baseLook()),
        slug: "cancelled",
        provider: stripProvider(log()),
        isCancelled: () => true,
      }),
    ).rejects.toThrow(/hatch cancelled/);
  });
});
