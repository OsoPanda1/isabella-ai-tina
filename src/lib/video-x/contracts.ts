/**
 * ISABELLA-ENGINE-VIDEO X Contracts & Mathematical Operations
 * -------------------------------------------------------------
 * Provides formal contracts, rational time arithmetic, narrative impact calculation,
 * Shot Card selection, Model Routing, Multimodal QA scoring, and C2PA provenance signing.
 */

import type {
  RationalTime,
  NarrativeGraph,
  ImpactAnalysisResult,
  ShotCardX,
  TargetFormat,
  InferenceRequest,
  ModelRouteChoice,
  QualityReport,
  RemediationPlan,
  C2PAManifest,
  VideoProject,
  ITSGTimeline,
} from "./types";

/* RATIONAL TIME HELPERS */

export function createRationalTime(
  numerator: bigint | number,
  denominator: bigint | number = 1n,
): RationalTime {
  return {
    numerator: BigInt(numerator),
    denominator: BigInt(denominator),
  };
}

export function rationalTimeToSeconds(rt: RationalTime): number {
  if (rt.denominator === 0n) return 0;
  return Number(rt.numerator) / Number(rt.denominator);
}

export function frameToRationalTime(frameIndex: number, fps: number = 24): RationalTime {
  return createRationalTime(BigInt(frameIndex), BigInt(fps));
}

/* NARRATIVE GRAPH IMPACT ENGINE */

export function calculateNarrativeImpact(
  graph: NarrativeGraph,
  modifiedNodeId: string,
): ImpactAnalysisResult {
  const node = graph.nodes.find((n) => n.id === modifiedNodeId);
  const affectedShotsSet = new Set<string>();
  const invalidAssetsSet = new Set<string>();
  const requiredWorkersSet = new Set<string>();

  if (!node) {
    return {
      modifiedNodeId,
      affectedShots: [],
      invalidAssets: [],
      requiredWorkers: [],
      estimatedGpuSeconds: 0,
      estimatedCostUsd: 0,
      requiresApproval: false,
    };
  }

  // Traverse connected nodes using BFS
  const visited = new Set<string>([modifiedNodeId]);
  const queue = [modifiedNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const adjacentEdges = graph.edges.filter((e) => e.from === currentId || e.to === currentId);

    for (const edge of adjacentEdges) {
      const neighborId = edge.from === currentId ? edge.to : edge.from;
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push(neighborId);
        const neighborNode = graph.nodes.find((n) => n.id === neighborId);
        if (neighborNode) {
          if (neighborNode.type === "Shot") {
            affectedShotsSet.add(neighborNode.id);
          } else if (neighborNode.type === "Asset") {
            invalidAssetsSet.add(neighborNode.id);
          }
        }
      }
    }
  }

  // Determine required workers and estimated cost
  if (node.type === "Character" || node.type === "StoryWorld") {
    requiredWorkersSet.add("VideoWorker_ComfyUI");
    requiredWorkersSet.add("MattingWorker");
    requiredWorkersSet.add("MultimodalQAWorker");
  } else if (node.type === "Dialogue" || node.type === "Emotion") {
    requiredWorkersSet.add("AudioWorker_TTS");
    requiredWorkersSet.add("AudioWorker_Dubbing");
    requiredWorkersSet.add("RenderWorker_FFmpeg");
  } else {
    requiredWorkersSet.add("VideoWorker_ComfyUI");
    requiredWorkersSet.add("RenderWorker_FFmpeg");
  }

  const shotCount = affectedShotsSet.size || 1;
  const estimatedGpuSeconds = shotCount * 45; // 45 seconds per shot estimate
  const estimatedCostUsd = Math.round(estimatedGpuSeconds * 0.008 * 100) / 100;

  return {
    modifiedNodeId,
    affectedShots: Array.from(affectedShotsSet),
    invalidAssets: Array.from(invalidAssetsSet),
    requiredWorkers: Array.from(requiredWorkersSet),
    estimatedGpuSeconds,
    estimatedCostUsd,
    requiresApproval:
      node.type === "Character" || node.type === "StoryWorld" || estimatedCostUsd > 2.5,
  };
}

/* SHOT CARDS X LIBRARY */

export const DEFAULT_SHOT_CARDS: ShotCardX[] = [
  {
    id: "sc-discovery-01",
    name: "Revelación Panorámica en Humo Azulado",
    category: "discovery",
    semanticTags: ["blue_hour", "fog", "revelation", "historical"],
    emotionalUse: ["wonder", "mystery", "contemplation"],
    narrativeFunctions: ["introduce_location", "reveal_secret"],
    compatibleSubjects: ["architecture", "landscape", "avatar"],
    cameraModel: {
      shotSize: "wide",
      lensMm: 35,
      heightM: 2.1,
      movement: "slow_dolly_in",
      angle: "eye_level",
      composition: "leading_lines",
    },
    blockingModel: { actorPosition: "center_background", movementVector: "forward_slow" },
    lightingModel: {
      keyLight: "blue_hour_ambient",
      colorTemperatureK: 6500,
      mood: "cinematic_cool",
    },
    editModel: {
      transitionIn: "cross_fade",
      transitionOut: "hard_cut",
      beatAlignment: "music_bar_4",
    },
    generationPrompt:
      "High detailed cinematic shot, Mineral del Monte at blue hour with light fog, lantern glowing warmly",
    negativePrompt: "deformed, noise, modern signs, neon, text watermark",
    continuityRequirements: ["location_token_loc-8f91", "weather_light_fog"],
    qualityTests: ["identity >= 0.85", "no_unmasked_text = true"],
  },
  {
    id: "sc-character-entrance-02",
    name: "Entrada Heroica de Personaje Mediano-Cerca",
    category: "character_reveal",
    semanticTags: ["character_focus", "medium_close_up", "heroic"],
    emotionalUse: ["confidence", "revelation", "dignity"],
    narrativeFunctions: ["introduce_character", "dramatic_shift"],
    compatibleSubjects: ["avatar", "protagonist"],
    cameraModel: {
      shotSize: "medium_close_up",
      lensMm: 85,
      heightM: 1.6,
      movement: "handheld_subtle",
      angle: "low_angle",
      composition: "rule_of_thirds_left",
    },
    blockingModel: { actorPosition: "foreground_left", movementVector: "turn_head_to_camera" },
    lightingModel: { keyLight: "warm_rim_light", colorTemperatureK: 3200, mood: "dramatic_warm" },
    editModel: { transitionIn: "hard_cut", transitionOut: "match_cut", beatAlignment: null },
    generationPrompt:
      "Close-up portrait of character looking towards camera, soft backlight, realistic facial texture",
    negativePrompt: "blur, face distortion, extra limbs",
    continuityRequirements: ["character_identity_pack_v3", "wardrobe_state_locked"],
    qualityTests: ["face_similarity >= 0.88"],
  },
  {
    id: "sc-tension-close-03",
    name: "Primer Plano de Tensión Dramática",
    category: "tension",
    semanticTags: ["extreme_close_up", "eyes", "suspense"],
    emotionalUse: ["fear", "suspense", "determination"],
    narrativeFunctions: ["conflict_peak", "internal_monologue"],
    compatibleSubjects: ["avatar", "antagonist"],
    cameraModel: {
      shotSize: "extreme_close_up",
      lensMm: 100,
      heightM: 1.5,
      movement: "static",
      angle: "eye_level",
      composition: "centered",
    },
    blockingModel: { actorPosition: "centered", movementVector: "micro_expression" },
    lightingModel: { keyLight: "high_contrast_side", colorTemperatureK: 4500, mood: "intense" },
    editModel: { transitionIn: "hard_cut", transitionOut: "hard_cut", beatAlignment: null },
    generationPrompt:
      "Macro shot of eyes reflecting flickering lantern light, high detail skin, dramatic shadows",
    negativePrompt: "out of focus, plastic skin",
    continuityRequirements: ["character_identity_pack_v3"],
    qualityTests: ["sharpness >= 0.85"],
  },
];

export function selectShotCard(
  category: ShotCardX["category"],
  _emotionalIntensity: number,
  _format: TargetFormat,
  _maxCostUsd: number,
): ShotCardX {
  const matches = DEFAULT_SHOT_CARDS.filter((c) => c.category === category);
  if (matches.length > 0) {
    return matches[0];
  }
  return DEFAULT_SHOT_CARDS[0];
}

/* MODEL ROUTER */

export function routeModel(request: InferenceRequest): ModelRouteChoice {
  if (request.privacy === "restricted" || request.task === "matting") {
    return {
      modelId: "isabella-comfyui-local-v3",
      provider: "comfyui_local",
      estimatedLatencyMs: 12000,
      estimatedCostUsd: 0.05,
      privacyMatch: true,
      score: 0.94,
    };
  }

  if (request.quality === "master" || request.task === "t2v") {
    return {
      modelId: "cloud-veo2-master-v1",
      provider: "cloud_farm",
      estimatedLatencyMs: 28000,
      estimatedCostUsd: 0.35,
      privacyMatch: true,
      score: 0.98,
    };
  }

  return {
    modelId: "isabella-fast-i2v-v2",
    provider: "partner_api",
    estimatedLatencyMs: 8000,
    estimatedCostUsd: 0.12,
    privacyMatch: true,
    score: 0.89,
  };
}

/* MULTIMODAL QA SCORING & REMEDIATION PLANNER */

export function evaluateMultimodalQA(params: {
  technical: number;
  visual: number;
  identity: number;
  temporal: number;
  audio: number;
  text: number;
  narrative: number;
  safety: number;
  detectedUnexpectedText?: boolean;
}): QualityReport {
  const {
    technical,
    visual,
    identity,
    temporal,
    audio,
    text,
    narrative,
    safety,
    detectedUnexpectedText,
  } = params;

  const totalScore =
    technical * 0.15 +
    visual * 0.18 +
    identity * 0.15 +
    temporal * 0.15 +
    audio * 0.12 +
    text * 0.1 +
    narrative * 0.1 +
    safety * 0.05;

  let decision: QualityReport["decision"] = "pass";
  let remediationPlan: RemediationPlan | undefined = undefined;

  if (safety < 0.9) {
    decision = "block";
  } else if (identity < 0.85) {
    decision = "regenerate";
    remediationPlan = {
      failure: "identity_drift",
      severity: "high",
      range: [0, 5],
      action: "regenerate_shot",
      preserveOriginal: false,
      requiresApproval: true,
      estimatedCost: { gpuSeconds: 45, usd: 0.36 },
    };
  } else if (detectedUnexpectedText || text < 0.9) {
    decision = "review";
    remediationPlan = {
      failure: "unexpected_text_watermark",
      severity: "medium",
      range: [2.5, 4.0],
      action: "inpaint_region",
      preserveOriginal: true,
      requiresApproval: true,
      estimatedCost: { gpuSeconds: 15, usd: 0.12 },
    };
  } else if (totalScore < 0.8) {
    decision = "review";
  }

  return {
    technical,
    visual,
    identity,
    temporal,
    audio,
    text,
    narrative,
    safety,
    decision,
    remediationPlan,
  };
}

/* C2PA MANIFEST BUILDER */

export function buildC2PAManifest(
  project: VideoProject,
  timeline: ITSGTimeline,
  inputAssets: Array<{ assetId: string; role: string; sha256: string }>,
): C2PAManifest {
  const manifestId = `c2pa-${project.id}-${Date.now()}`;
  const workflowDigest = `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`;
  const timestamp = new Date().toISOString();

  // Create cryptographic simulation signature
  const signature = `SIG_HMAC_SHA3_512_C2PA_${manifestId.slice(-8)}_${project.version.replace(/\./g, "")}`;

  return {
    manifestId,
    projectId: project.id,
    title: project.title,
    timelineVersion: timeline.version,
    rendererVersion: "isabella-renderer-2.1.3",
    video: {
      width: 3840,
      height: 2160,
      fpsNum: timeline.timebase.fps,
      fpsDen: 1,
      pixelFormat: "yuv420p10le",
      colorPrimaries: "bt2020",
    },
    audio: {
      sampleRate: timeline.timebase.audioSampleRate,
      channels: 2,
    },
    inputs: inputAssets.map((a) => ({
      assetId: a.assetId,
      role: a.role,
      sha256: a.sha256,
    })),
    determinism: {
      seed: 412903,
      workflowHash: workflowDigest,
      modelHashes: ["sha256:9a8b7c6d...", "sha256:1f2e3d4c..."],
      containerDigest: "sha256:container_isabella_video_x_v2",
    },
    signature,
    signedAt: timestamp,
  };
}
