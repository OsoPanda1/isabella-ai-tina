/**
 * ISABELLA-ENGINE-VIDEO X Domain Types & Contracts
 * --------------------------------------------------
 * Verifiable, deterministic, versioned audiovisual production engine specification.
 */

export type ProjectStatus =
  | "IDEA"
  | "BRIEF_NORMALIZED"
  | "NARRATIVE_PLANNED"
  | "SCRIPT_DRAFTED"
  | "SCRIPT_APPROVED"
  | "VISUAL_BIBLE_LOCKED"
  | "STORYBOARD_READY"
  | "ASSETS_GENERATED"
  | "SHOTS_GENERATED"
  | "SHOTS_QA"
  | "AUDIO_READY"
  | "EDIT_ASSEMBLED"
  | "MULTIFORMAT_RENDERED"
  | "MASTER_QA"
  | "PROVENANCE_SIGNED"
  | "PUBLISHED";

export interface CreativeBrief {
  title: string;
  premise: string;
  genre: string;
  targetAudience: string;
  targetDurationSeconds: number;
  keyCharacters: string[];
  keyLocations: string[];
  styleKeywords: string[];
  historicalAccuracyMode: boolean;
}

export type TargetFormat =
  "16:9_master" | "9:16_vertical" | "1:1_square" | "4:5_social" | "21:9_cinematic";

export interface PolicyProfile {
  allowedModels: string[];
  maxGpuBudgetUsd: number;
  c2paSigningRequired: boolean;
  humanApprovalThreshold: "manual" | "assisted" | "autonomous";
  watermarkPolicy: "strict" | "allow_historical";
}

export interface BudgetPolicy {
  maxCostUsd: number;
  spentCostUsd: number;
  maxGpuSeconds: number;
  spentGpuSeconds: number;
}

export interface VideoProject {
  id: string;
  version: string;
  title: string;
  brief: CreativeBrief;
  narrativeGraphId: string;
  timelineId: string;
  visualBibleId: string;
  targetFormats: TargetFormat[];
  policyProfile: PolicyProfile;
  budget: BudgetPolicy;
  approvalMode: "manual" | "assisted" | "autonomous";
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

/* NARRATIVE GRAPH TYPES */

export type NarrativeNodeType =
  | "Project"
  | "StoryWorld"
  | "Character"
  | "Location"
  | "Scene"
  | "Event"
  | "Object"
  | "Dialogue"
  | "Emotion"
  | "Shot"
  | "Asset"
  | "Constraint"
  | "Evidence"
  | "Decision";

export type NarrativeEdgeType =
  | "appears_in"
  | "wears"
  | "has_emotion"
  | "located_at"
  | "contains"
  | "causes"
  | "uses"
  | "visualizes"
  | "references"
  | "must_follow"
  | "derived_from"
  | "constrains"
  | "supports";

export interface NarrativeNode {
  id: string;
  type: NarrativeNodeType;
  properties: Record<string, unknown>;
}

export interface NarrativeEdge {
  from: string;
  to: string;
  type: NarrativeEdgeType;
  properties?: Record<string, unknown>;
}

export interface NarrativeGraph {
  id: string;
  projectId: string;
  version: string;
  nodes: NarrativeNode[];
  edges: NarrativeEdge[];
}

export interface ImpactAnalysisResult {
  modifiedNodeId: string;
  affectedShots: string[];
  invalidAssets: string[];
  requiredWorkers: string[];
  estimatedGpuSeconds: number;
  estimatedCostUsd: number;
  requiresApproval: boolean;
}

/* TEMPORAL MEDIA CORE & ITSG */

export interface RationalTime {
  numerator: bigint;
  denominator: bigint;
}

export interface TimeRange {
  start: RationalTime;
  end: RationalTime;
}

export interface CameraRecipe {
  shotSize:
    | "extreme_wide"
    | "wide"
    | "medium_wide"
    | "medium"
    | "medium_close_up"
    | "close_up"
    | "extreme_close_up";
  lensMm: number;
  heightM: number;
  movement:
    | "static"
    | "slow_dolly_in"
    | "pan_left"
    | "tilt_up"
    | "handheld_subtle"
    | "crane_shot"
    | "tracking";
  angle: "eye_level" | "low_angle" | "high_angle" | "dutch_angle";
  composition:
    "rule_of_thirds_left" | "rule_of_thirds_right" | "centered" | "leading_lines" | "symmetry";
}

export interface PerformanceRecipe {
  emotion: string;
  gaze: string;
  intensity: number;
}

export interface VisualStyleRecipe {
  palette: string[];
  contrast: number;
  grain: number;
}

export interface GenerationRecipe {
  mode: "text_to_video" | "image_to_video" | "keyframe_interpolation" | "motion_brush";
  referenceAssets: string[];
  seed: number;
  controlnet: string[];
  negativeConstraints: string[];
}

export interface AudioRecipe {
  dialogue: string | null;
  ambience: string | null;
  sfx: string[];
  musicCue: string | null;
}

export interface EditRecipe {
  transitionIn: "hard_cut" | "cross_fade" | "dip_to_black" | "match_cut";
  transitionOut: "hard_cut" | "cross_fade" | "dip_to_black" | "match_cut";
  beatAlignment: string | null;
}

export interface ITSGShot {
  id: string;
  in: string; // Timecode format "00:00:18:12"
  out: string;
  durationFrames: number;
  purpose: string;
  characters: string[];
  camera: CameraRecipe;
  performance: PerformanceRecipe;
  visualStyle: VisualStyleRecipe;
  generation: GenerationRecipe;
  audio: AudioRecipe;
  edit: EditRecipe;
  acceptanceTests: string[];
}

export interface AudioTrackItem {
  id: string;
  type: "dialogue" | "music" | "ambience" | "foley";
  assetId: string;
  startSample: bigint;
  durationSamples: bigint;
  volumeDb: number;
}

export interface GraphicsOverlayItem {
  id: string;
  type: "lower_third" | "title_card" | "map_annotation" | "subtitle" | "c2pa_badge";
  content: string;
  startFrame: number;
  endFrame: number;
  position: { x: number; y: number };
}

export interface ITSGTimeline {
  id: string;
  projectId: string;
  sequenceId: string;
  version: string;
  timebase: {
    fps: number;
    audioSampleRate: number;
    dropFrame: boolean;
  };
  shots: ITSGShot[];
  audioTracks: AudioTrackItem[];
  graphicsOverlay: GraphicsOverlayItem[];
}

/* SHOT CARDS X */

export interface ShotCardX {
  id: string;
  name: string;
  category:
    | "discovery"
    | "character_reveal"
    | "location_reveal"
    | "tension"
    | "intimacy"
    | "transition"
    | "documentary"
    | "action";
  semanticTags: string[];
  emotionalUse: string[];
  narrativeFunctions: string[];
  compatibleSubjects: string[];
  cameraModel: CameraRecipe;
  blockingModel: { actorPosition: string; movementVector: string };
  lightingModel: { keyLight: string; colorTemperatureK: number; mood: string };
  editModel: EditRecipe;
  generationPrompt: string;
  negativePrompt: string;
  continuityRequirements: string[];
  qualityTests: string[];
}

/* CHARACTER IDENTITY PACK */

export interface ConsentProfile {
  status: "required" | "granted" | "revoked";
  scope: string[];
  expiresAt: string | null;
}

export interface CharacterIdentityPack {
  characterId: string;
  identityVersion: string;
  canonicalPortraits: string[];
  expressionSheet: string[];
  wardrobeState: string;
  voiceId: string;
  identityThresholds: {
    faceSimilarity: number;
    bodyConsistency: number;
    voiceSimilarity: number;
  };
  consent: ConsentProfile;
}

/* MODEL ROUTER & EXECUTION FABRIC */

export interface InferenceRequest {
  task: "t2v" | "i2v" | "upscale" | "matting" | "lipsync" | "tts";
  quality: "preview" | "production" | "master";
  privacy: "public" | "internal" | "restricted";
  latencyBudgetMs: number;
  costBudgetUsd: number;
  requiredCapabilities: string[];
}

export interface ModelRouteChoice {
  modelId: string;
  provider: "comfyui_local" | "cloud_farm" | "partner_api";
  estimatedLatencyMs: number;
  estimatedCostUsd: number;
  privacyMatch: boolean;
  score: number;
}

/* MULTIMODAL QA & REMEDIATION */

export type QADecision = "pass" | "review" | "regenerate" | "block";

export interface FrameQAResult {
  frameIndex: number;
  brightness: number;
  sharpness: number;
  faceDetected: boolean;
  identitySimilarity: number;
  unexpectedTextDetected: boolean;
}

export interface RemediationPlan {
  failure: string;
  severity: "low" | "medium" | "high" | "critical";
  range: [number, number];
  action:
    | "accept"
    | "trim"
    | "recolor"
    | "reframe"
    | "retranscribe"
    | "regenerate_audio"
    | "regenerate_shot"
    | "inpaint_region"
    | "replace_asset"
    | "human_review"
    | "block_publish";
  preserveOriginal: boolean;
  requiresApproval: boolean;
  estimatedCost: {
    gpuSeconds: number;
    usd: number;
  };
}

export interface QualityReport {
  technical: number;
  visual: number;
  identity: number;
  temporal: number;
  audio: number;
  text: number;
  narrative: number;
  safety: number;
  decision: QADecision;
  frameDetails?: FrameQAResult[];
  remediationPlan?: RemediationPlan;
}

/* C2PA PROVENANCE & MANIFEST */

export interface C2PAInputAsset {
  assetId: string;
  role: string;
  sha256: string;
}

export interface C2PAManifest {
  manifestId: string;
  projectId: string;
  title: string;
  timelineVersion: string;
  rendererVersion: string;
  video: {
    width: number;
    height: number;
    fpsNum: number;
    fpsDen: number;
    pixelFormat: string;
    colorPrimaries: string;
  };
  audio: {
    sampleRate: number;
    channels: number;
  };
  inputs: C2PAInputAsset[];
  determinism: {
    seed: number;
    workflowHash: string;
    modelHashes: string[];
    containerDigest: string;
  };
  signature: string;
  signedAt: string;
}
