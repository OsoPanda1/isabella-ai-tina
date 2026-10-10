import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateImagePin, extractImages } from "../../scripts/k8s-image-pin.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("k8s image pin (ISA-355)", () => {
  it("falls closed on mutable or missing tags", () => {
    expect(evaluateImagePin("ghcr.io/osopanda1/isabella-ai-genesis:latest").status).toBe("FAIL");
    expect(evaluateImagePin("ghcr.io/osopanda1/isabella-ai-genesis").status).toBe("FAIL");
    expect(evaluateImagePin("").status).toBe("FAIL");
  });

  it("treats a versioned tag as evidence-gated until a digest is pinned", () => {
    const result = evaluateImagePin("ghcr.io/osopanda1/isabella-ai-genesis:4.3.3");
    expect(result.status).toBe("EVIDENCE_GATED");
    expect(result.hasDigest).toBe(false);
  });

  it("passes only with an immutable digest", () => {
    const digest = "a".repeat(64);
    const result = evaluateImagePin(`ghcr.io/osopanda1/isabella-ai-genesis:4.3.3@sha256:${digest}`);
    expect(result.status).toBe("PASS");
    expect(result.hasDigest).toBe(true);
    expect(evaluateImagePin(`ghcr.io/osopanda1/isabella-ai-genesis:latest@sha256:${digest}`).status)
      .toBe("FAIL");
  });

  it("deployment manifest no longer deploys :latest", () => {
    const yaml = readFileSync(join(root, "k8s", "deployment.yaml"), "utf8");
    const images = extractImages(yaml);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(evaluateImagePin(image).status).not.toBe("FAIL");
    }
    expect(yaml).not.toMatch(/:\s*latest\b/);
    expect(yaml).toContain("imagePullPolicy: IfNotPresent");
  });
});
