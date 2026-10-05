/**
 * ISABELLA-ENGINE-VIDEO X Core Engine
 * -------------------------------------
 * Manages project lifecycle state machine, narrative graph mutations,
 * partial DAG execution recovery, multimodal QA checks, and C2PA signing.
 */

import type {
  VideoProject,
  ProjectStatus,
  NarrativeGraph,
  ITSGTimeline,
  CharacterIdentityPack,
  QualityReport,
  C2PAManifest,
  ImpactAnalysisResult,
} from "./types";
import { calculateNarrativeImpact, evaluateMultimodalQA, buildC2PAManifest } from "./contracts";

export const PROJECT_STATUS_FLOW: ProjectStatus[] = [
  "IDEA",
  "BRIEF_NORMALIZED",
  "NARRATIVE_PLANNED",
  "SCRIPT_DRAFTED",
  "SCRIPT_APPROVED",
  "VISUAL_BIBLE_LOCKED",
  "STORYBOARD_READY",
  "ASSETS_GENERATED",
  "SHOTS_GENERATED",
  "SHOTS_QA",
  "AUDIO_READY",
  "EDIT_ASSEMBLED",
  "MULTIFORMAT_RENDERED",
  "MASTER_QA",
  "PROVENANCE_SIGNED",
  "PUBLISHED",
];

export const INITIAL_DEMO_PROJECT: VideoProject = {
  id: "proj-isabella-mineral-01",
  version: "1.0.0",
  title: "Isabella: Sombras y Luz en Mineral del Monte",
  brief: {
    title: "Isabella: Sombras y Luz en Mineral del Monte",
    premise:
      "Isabella explora el patrimonio minero de Mineral del Monte al atardecer, revelando historias olvidadas a través de una linterna histórica.",
    genre: "Documental Histórico & Ficción Cinematográfica",
    targetAudience: "Audiencia Cultural & Turística Global",
    targetDurationSeconds: 60,
    keyCharacters: ["Isabella Villaseñor"],
    keyLocations: ["Mineral del Monte Centro", "Mina de Acosta"],
    styleKeywords: ["blue_hour", "light_fog", "cinematic_lighting", "historical_lantern"],
    historicalAccuracyMode: true,
  },
  narrativeGraphId: "ng-isabella-mineral-01",
  timelineId: "tl-isabella-mineral-01",
  visualBibleId: "vb-isabella-mineral-01",
  targetFormats: ["16:9_master", "9:16_vertical"],
  policyProfile: {
    allowedModels: ["isabella-comfyui-local-v3", "cloud-veo2-master-v1"],
    maxGpuBudgetUsd: 15.0,
    c2paSigningRequired: true,
    humanApprovalThreshold: "assisted",
    watermarkPolicy: "allow_historical",
  },
  budget: {
    maxCostUsd: 25.0,
    spentCostUsd: 4.85,
    maxGpuSeconds: 1800,
    spentGpuSeconds: 320,
  },
  approvalMode: "assisted",
  status: "SHOTS_QA",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const INITIAL_DEMO_NARRATIVE_GRAPH: NarrativeGraph = {
  id: "ng-isabella-mineral-01",
  projectId: "proj-isabella-mineral-01",
  version: "1.0.0",
  nodes: [
    {
      id: "char-isabella",
      type: "Character",
      properties: {
        name: "Isabella Villaseñor",
        identity_pack: "identity/isabella/v3",
        role: "narrator_protagonist",
        canonical_age: "adult",
      },
    },
    {
      id: "loc-mineral-monte",
      type: "Location",
      properties: {
        name: "Mineral del Monte",
        time_of_day: "blue_hour",
        weather: "light_fog",
        coordinates: "20.1417,-98.6739",
      },
    },
    {
      id: "scene-04",
      type: "Scene",
      properties: {
        name: "Escena 4: El Revelado de la Linterna",
        dramatic_function: "revelation",
        emotional_intensity: 0.74,
      },
    },
    {
      id: "event-lantern",
      type: "Event",
      properties: {
        action: "Isabella descubre una linterna histórica de minero que emite luz dorada",
      },
    },
    {
      id: "shot-04-001",
      type: "Shot",
      properties: {
        name: "Toma 01: Plano General de la Calle Niebla",
        duration_frames: 120,
      },
    },
    {
      id: "shot-04-002",
      type: "Shot",
      properties: {
        name: "Toma 02: Primer Plano de Isabella al Descubrir la Luz",
        duration_frames: 144,
      },
    },
    {
      id: "asset-char-v3",
      type: "Asset",
      properties: {
        name: "Pack de Identidad de Isabella v3.2",
        status: "verified",
        sha256: "sha256:8f32a0b1c2d3...",
      },
    },
  ],
  edges: [
    { from: "char-isabella", type: "appears_in", to: "scene-04" },
    { from: "scene-04", type: "located_at", to: "loc-mineral-monte" },
    { from: "scene-04", type: "contains", to: "event-lantern" },
    { from: "shot-04-001", type: "visualizes", to: "event-lantern" },
    { from: "shot-04-002", type: "visualizes", to: "event-lantern" },
    { from: "shot-04-002", type: "references", to: "asset-char-v3" },
  ],
};

export const INITIAL_DEMO_TIMELINE: ITSGTimeline = {
  id: "tl-isabella-mineral-01",
  projectId: "proj-isabella-mineral-01",
  sequenceId: "seq-main-01",
  version: "1.0.0",
  timebase: {
    fps: 24,
    audioSampleRate: 48000,
    dropFrame: false,
  },
  shots: [
    {
      id: "shot-04-001",
      in: "00:00:00:00",
      out: "00:00:05:00",
      durationFrames: 120,
      purpose: "introduce_location",
      characters: [],
      camera: {
        shotSize: "wide",
        lensMm: 35,
        heightM: 2.0,
        movement: "slow_dolly_in",
        angle: "eye_level",
        composition: "leading_lines",
      },
      performance: { emotion: "awe", gaze: "forward", intensity: 0.6 },
      visualStyle: { palette: ["#18324A", "#E5A84B"], contrast: 0.4, grain: 0.08 },
      generation: {
        mode: "text_to_video",
        referenceAssets: ["loc-mineral-monte"],
        seed: 412901,
        controlnet: ["depth"],
        negativeConstraints: ["distortion", "modern cars"],
      },
      audio: {
        dialogue: null,
        ambience: "mountain-wind-night",
        sfx: ["footsteps_cobblestone"],
        musicCue: "intro_mystic_theme",
      },
      edit: {
        transitionIn: "dip_to_black",
        transitionOut: "hard_cut",
        beatAlignment: "music_bar_1",
      },
      acceptanceTests: ["technical == pass", "no_unmasked_text = true"],
    },
    {
      id: "shot-04-002",
      in: "00:00:05:00",
      out: "00:00:11:00",
      durationFrames: 144,
      purpose: "character_revelation",
      characters: ["isabella"],
      camera: {
        shotSize: "medium_close_up",
        lensMm: 85,
        heightM: 1.6,
        movement: "handheld_subtle",
        angle: "low_angle",
        composition: "rule_of_thirds_left",
      },
      performance: { emotion: "wonder", gaze: "toward_lantern", intensity: 0.78 },
      visualStyle: { palette: ["#18324A", "#E5A84B", "#D7D1C5"], contrast: 0.45, grain: 0.08 },
      generation: {
        mode: "image_to_video",
        referenceAssets: ["asset-char-v3"],
        seed: 412903,
        controlnet: ["depth", "openpose"],
        negativeConstraints: ["face deformation", "extra fingers"],
      },
      audio: {
        dialogue: "En estas calles de piedra, la memoria nunca se apaga.",
        ambience: "mountain-wind-night",
        sfx: ["lantern_clink"],
        musicCue: "theme_reveal_02",
      },
      edit: { transitionIn: "hard_cut", transitionOut: "match_cut", beatAlignment: "music_bar_4" },
      acceptanceTests: ["character_identity >= 0.88", "face_integrity = true"],
    },
  ],
  audioTracks: [
    {
      id: "audio-dialogue-01",
      type: "dialogue",
      assetId: "asset-vox-isabella-01",
      startSample: 240000n, // at 5 sec
      durationSamples: 288000n, // 6 sec
      volumeDb: 0.0,
    },
    {
      id: "audio-music-01",
      type: "music",
      assetId: "asset-mus-mineral-theme",
      startSample: 0n,
      durationSamples: 528000n,
      volumeDb: -12.0,
    },
  ],
  graphicsOverlay: [
    {
      id: "gfx-lower-third-01",
      type: "lower_third",
      content: "Mineral del Monte, Hidalgo • Nodo Cero",
      startFrame: 24,
      endFrame: 96,
      position: { x: 50, y: 880 },
    },
  ],
};

export const INITIAL_DEMO_IDENTITY: CharacterIdentityPack = {
  characterId: "isabella-v3",
  identityVersion: "3.2.0",
  canonicalPortraits: ["/assets/isabella_canonical_portrait.png"],
  expressionSheet: ["wonder", "determination", "serenity", "contemplation"],
  wardrobeState: "historical_coat_dark_blue",
  voiceId: "voice-isabella-sovereign-es-mx",
  identityThresholds: {
    faceSimilarity: 0.88,
    bodyConsistency: 0.82,
    voiceSimilarity: 0.9,
  },
  consent: {
    status: "granted",
    scope: ["fictional_narration", "cultural_documentary", "isabella_engine_v4"],
    expiresAt: null,
  },
};

class VideoEngineXManager {
  private projects: Map<string, VideoProject> = new Map();
  private narrativeGraphs: Map<string, NarrativeGraph> = new Map();
  private timelines: Map<string, ITSGTimeline> = new Map();
  private qaReports: Map<string, QualityReport> = new Map();
  private manifests: Map<string, C2PAManifest> = new Map();

  constructor() {
    this.projects.set(INITIAL_DEMO_PROJECT.id, INITIAL_DEMO_PROJECT);
    this.narrativeGraphs.set(INITIAL_DEMO_NARRATIVE_GRAPH.id, INITIAL_DEMO_NARRATIVE_GRAPH);
    this.timelines.set(INITIAL_DEMO_TIMELINE.id, INITIAL_DEMO_TIMELINE);

    // Initial QA evaluation
    const initialQA = evaluateMultimodalQA({
      technical: 0.98,
      visual: 0.92,
      identity: 0.91,
      temporal: 0.89,
      audio: 0.95,
      text: 0.96,
      narrative: 0.9,
      safety: 0.99,
    });
    this.qaReports.set(INITIAL_DEMO_PROJECT.id, initialQA);
  }

  public getProjects(): VideoProject[] {
    return Array.from(this.projects.values());
  }

  public getProject(id: string): VideoProject | undefined {
    return this.projects.get(id);
  }

  public getNarrativeGraph(id: string): NarrativeGraph | undefined {
    return this.narrativeGraphs.get(id);
  }

  public getTimeline(id: string): ITSGTimeline | undefined {
    return this.timelines.get(id);
  }

  public getQAReport(projectId: string): QualityReport | undefined {
    return this.qaReports.get(projectId);
  }

  public getC2PAManifest(projectId: string): C2PAManifest | undefined {
    return this.manifests.get(projectId);
  }

  public createProject(title: string, premise: string, genre: string): VideoProject {
    const id = `proj-${Date.now().toString(36)}`;
    const ngId = `ng-${id}`;
    const tlId = `tl-${id}`;

    const newProject: VideoProject = {
      id,
      version: "1.0.0",
      title,
      brief: {
        title,
        premise,
        genre,
        targetAudience: "General Audiovisual Audience",
        targetDurationSeconds: 60,
        keyCharacters: ["Isabella"],
        keyLocations: ["Studio Environment"],
        styleKeywords: ["cinematic", "verified"],
        historicalAccuracyMode: false,
      },
      narrativeGraphId: ngId,
      timelineId: tlId,
      visualBibleId: `vb-${id}`,
      targetFormats: ["16:9_master"],
      policyProfile: {
        allowedModels: ["isabella-comfyui-local-v3"],
        maxGpuBudgetUsd: 10.0,
        c2paSigningRequired: true,
        humanApprovalThreshold: "assisted",
        watermarkPolicy: "strict",
      },
      budget: {
        maxCostUsd: 15.0,
        spentCostUsd: 0.0,
        maxGpuSeconds: 1200,
        spentGpuSeconds: 0,
      },
      approvalMode: "assisted",
      status: "BRIEF_NORMALIZED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newGraph: NarrativeGraph = {
      id: ngId,
      projectId: id,
      version: "1.0.0",
      nodes: [
        { id: `char-${id}-isabella`, type: "Character", properties: { name: "Isabella" } },
        { id: `scene-${id}-01`, type: "Scene", properties: { name: "Escena Principal" } },
      ],
      edges: [{ from: `char-${id}-isabella`, type: "appears_in", to: `scene-${id}-01` }],
    };

    const newTimeline: ITSGTimeline = {
      id: tlId,
      projectId: id,
      sequenceId: "seq-01",
      version: "1.0.0",
      timebase: { fps: 24, audioSampleRate: 48000, dropFrame: false },
      shots: [],
      audioTracks: [],
      graphicsOverlay: [],
    };

    this.projects.set(id, newProject);
    this.narrativeGraphs.set(ngId, newGraph);
    this.timelines.set(tlId, newTimeline);

    return newProject;
  }

  public advanceProjectStatus(id: string): VideoProject | undefined {
    const project = this.projects.get(id);
    if (!project) return undefined;

    const currentIndex = PROJECT_STATUS_FLOW.indexOf(project.status);
    if (currentIndex >= 0 && currentIndex < PROJECT_STATUS_FLOW.length - 1) {
      project.status = PROJECT_STATUS_FLOW[currentIndex + 1];
      project.updatedAt = new Date().toISOString();

      if (project.status === "PROVENANCE_SIGNED") {
        const timeline = this.timelines.get(project.timelineId);
        if (timeline) {
          const manifest = buildC2PAManifest(project, timeline, [
            { assetId: "asset-char-v3", role: "character_identity", sha256: "sha256:8f32a..." },
            { assetId: "asset-master-wav", role: "audio_master", sha256: "sha256:44c8d..." },
          ]);
          this.manifests.set(id, manifest);
        }
      }
    }
    return project;
  }

  public mutateGraphNode(
    projectId: string,
    modifiedNodeId: string,
    newProperties: Record<string, unknown>,
  ): ImpactAnalysisResult | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    const graph = this.narrativeGraphs.get(project.narrativeGraphId);
    if (!graph) return undefined;

    const node = graph.nodes.find((n) => n.id === modifiedNodeId);
    if (node) {
      node.properties = { ...node.properties, ...newProperties };
    }

    return calculateNarrativeImpact(graph, modifiedNodeId);
  }

  public regenerateShot(
    projectId: string,
    shotId: string,
  ): { shotId: string; newSeed: number; regeneratedAt: string; costUsd: number } | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    const timeline = this.timelines.get(project.timelineId);
    if (!timeline) return undefined;

    const shot = timeline.shots.find((s) => s.id === shotId);
    if (shot) {
      shot.generation.seed = (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000) + 100000;
      project.budget.spentGpuSeconds += 45;
      project.budget.spentCostUsd = Math.round((project.budget.spentCostUsd + 0.36) * 100) / 100;
      project.updatedAt = new Date().toISOString();

      return {
        shotId,
        newSeed: shot.generation.seed,
        regeneratedAt: new Date().toISOString(),
        costUsd: 0.36,
      };
    }
    return undefined;
  }

  public runMultimodalQA(projectId: string): QualityReport | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    const report = evaluateMultimodalQA({
      technical: 0.97,
      visual: 0.94,
      identity: 0.92,
      temporal: 0.91,
      audio: 0.96,
      text: 0.98,
      narrative: 0.93,
      safety: 0.99,
    });

    this.qaReports.set(projectId, report);
    return report;
  }
}

export const videoEngineXManager = new VideoEngineXManager();
