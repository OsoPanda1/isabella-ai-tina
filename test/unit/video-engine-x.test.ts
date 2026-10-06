import { describe, it, expect } from "vitest";
import {
  createRationalTime,
  rationalTimeToSeconds,
  calculateNarrativeImpact,
  selectShotCard,
  routeModel,
  evaluateMultimodalQA,
  buildC2PAManifest,
} from "@/lib/video-x/contracts";
import {
  videoEngineXManager,
  INITIAL_DEMO_PROJECT,
  INITIAL_DEMO_NARRATIVE_GRAPH,
  INITIAL_DEMO_TIMELINE,
  PROJECT_STATUS_FLOW,
} from "@/lib/video-x/engine";

describe("Isabella-Engine-Video X Unit Test Suite", () => {
  it("calculates rational time accurately with bigint precision", () => {
    const rt24 = createRationalTime(24n, 1n);
    expect(rationalTimeToSeconds(rt24)).toBe(24);

    const rtHalfSec = createRationalTime(12n, 24n);
    expect(rationalTimeToSeconds(rtHalfSec)).toBe(0.5);

    const rtZeroDenom = createRationalTime(100n, 0n);
    expect(rationalTimeToSeconds(rtZeroDenom)).toBe(0);
  });

  it("calculates narrative impact correctly for character node modifications", () => {
    const impact = calculateNarrativeImpact(INITIAL_DEMO_NARRATIVE_GRAPH, "char-isabella");

    expect(impact.modifiedNodeId).toBe("char-isabella");
    expect(impact.affectedShots).toContain("shot-04-001");
    expect(impact.affectedShots).toContain("shot-04-002");
    expect(impact.requiredWorkers).toContain("VideoWorker_ComfyUI");
    expect(impact.estimatedGpuSeconds).toBeGreaterThan(0);
    expect(impact.requiresApproval).toBe(true);
  });

  it("selects appropriate shot cards based on category", () => {
    const discoveryCard = selectShotCard("discovery", 0.7, "16:9_master", 5.0);
    expect(discoveryCard.category).toBe("discovery");
    expect(discoveryCard.cameraModel.lensMm).toBeDefined();

    const charCard = selectShotCard("character_reveal", 0.8, "9:16_vertical", 5.0);
    expect(charCard.category).toBe("character_reveal");
  });

  it("routes inference requests according to privacy and task constraints", () => {
    const localChoice = routeModel({
      task: "matting",
      quality: "production",
      privacy: "restricted",
      latencyBudgetMs: 15000,
      costBudgetUsd: 1.0,
      requiredCapabilities: [],
    });
    expect(localChoice.provider).toBe("comfyui_local");

    const cloudChoice = routeModel({
      task: "t2v",
      quality: "master",
      privacy: "public",
      latencyBudgetMs: 30000,
      costBudgetUsd: 10.0,
      requiredCapabilities: [],
    });
    expect(cloudChoice.provider).toBe("cloud_farm");
  });

  it("scores multimodal QA and recommends remediation plans when issues arise", () => {
    const passQA = evaluateMultimodalQA({
      technical: 0.98,
      visual: 0.95,
      identity: 0.92,
      temporal: 0.9,
      audio: 0.96,
      text: 0.98,
      narrative: 0.94,
      safety: 0.99,
    });
    expect(passQA.decision).toBe("pass");
    expect(passQA.remediationPlan).toBeUndefined();

    const textQA = evaluateMultimodalQA({
      technical: 0.98,
      visual: 0.95,
      identity: 0.92,
      temporal: 0.9,
      audio: 0.96,
      text: 0.75, // unexpected watermark or text
      narrative: 0.94,
      safety: 0.99,
      detectedUnexpectedText: true,
    });
    expect(textQA.decision).toBe("review");
    expect(textQA.remediationPlan?.action).toBe("inpaint_region");
  });

  it("builds a cryptographically signed C2PA manifest", () => {
    const manifest = buildC2PAManifest(INITIAL_DEMO_PROJECT, INITIAL_DEMO_TIMELINE, [
      { assetId: "asset-char-v3", role: "character_identity", sha256: "sha256:abc123" },
    ]);

    expect(manifest.projectId).toBe(INITIAL_DEMO_PROJECT.id);
    expect(manifest.signature).toContain("SIG_HMAC_SHA3_512_C2PA");
    expect(manifest.inputs.length).toBe(1);
    expect(manifest.video.width).toBe(3840);
  });

  it("manages project lifecycle in videoEngineXManager", () => {
    const newProj = videoEngineXManager.createProject("Test Film", "Test Premise", "Ficción");
    expect(newProj.status).toBe("BRIEF_NORMALIZED");

    const advanced = videoEngineXManager.advanceProjectStatus(newProj.id);
    expect(advanced?.status).toBe("NARRATIVE_PLANNED");

    const regen = videoEngineXManager.regenerateShot(INITIAL_DEMO_PROJECT.id, "shot-04-001");
    expect(regen?.shotId).toBe("shot-04-001");
    expect(regen?.newSeed).toBeGreaterThan(0);

    const qa = videoEngineXManager.runMultimodalQA(INITIAL_DEMO_PROJECT.id);
    expect(qa?.decision).toBe("pass");
  });
});
