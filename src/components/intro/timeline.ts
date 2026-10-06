/**
 * Isabella Cinematic Intro — Timeline & Phase Management
 *
 * Controla las fases de la secuencia de 50 segundos.
 * Usa delta time, no frames fijos.
 */

export type IntroPhase =
  | "VOID"
  | "STELLAR_FIELD"
  | "COMET_PASSAGE"
  | "COGNITIVE_CORE"
  | "LOGO_REVEAL"
  | "HEARTBEAT"
  | "HUMMINGBIRD_ENTRY"
  | "HUMMINGBIRD_ASCENT"
  | "INTERFACE_REVEAL"
  | "ONLINE";

export const TIMELINE = {
  void: [0, 5],
  stars: [5, 12],
  comets: [12, 19],
  core: [19, 26],
  logo: [26, 33],
  heart: [33, 39],
  hummingbirdEntry: [39, 43],
  hummingbirdAscent: [43, 47],
  interface: [47, 50],
} as const;

export const TOTAL_DURATION = 50;

export function resolveIntroPhase(time: number): IntroPhase {
  if (time < 5) return "VOID";
  if (time < 12) return "STELLAR_FIELD";
  if (time < 19) return "COMET_PASSAGE";
  if (time < 26) return "COGNITIVE_CORE";
  if (time < 33) return "LOGO_REVEAL";
  if (time < 39) return "HEARTBEAT";
  if (time < 43) return "HUMMINGBIRD_ENTRY";
  if (time < 47) return "HUMMINGBIRD_ASCENT";
  if (time < 50) return "INTERFACE_REVEAL";
  return "ONLINE";
}

const PHASE_RANGES: Record<string, [number, number]> = {
  VOID: [0, 5],
  STELLAR_FIELD: [5, 12],
  COMET_PASSAGE: [12, 19],
  COGNITIVE_CORE: [19, 26],
  LOGO_REVEAL: [26, 33],
  HEARTBEAT: [33, 39],
  HUMMINGBIRD_ENTRY: [39, 43],
  HUMMINGBIRD_ASCENT: [43, 47],
  INTERFACE_REVEAL: [47, 50],
  ONLINE: [50, 50],
};

export function getPhaseProgress(time: number): number {
  const phase = resolveIntroPhase(time);
  const range = PHASE_RANGES[phase];
  if (!range) return 1;
  if (range[1] === range[0]) return 1;
  return Math.min(1, Math.max(0, (time - range[0]) / (range[1] - range[0])));
}

export interface CameraShot {
  start: number;
  end: number;
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  fov: number;
}

export const CAMERA_SHOTS: CameraShot[] = [
  {
    start: 0,
    end: 12,
    position: { x: 0, y: 0, z: 48 },
    lookAt: { x: 0, y: 0, z: 0 },
    fov: 54,
  },
  {
    start: 12,
    end: 26,
    position: { x: -2, y: 1, z: 43 },
    lookAt: { x: 0, y: 0, z: 0 },
    fov: 52,
  },
  {
    start: 26,
    end: 39,
    position: { x: 0, y: 0, z: 38 },
    lookAt: { x: 0, y: 0.5, z: 0 },
    fov: 50,
  },
  {
    start: 39,
    end: 50,
    position: { x: 1, y: 2, z: 42 },
    lookAt: { x: 0, y: 1, z: 0 },
    fov: 52,
  },
];

export function resolveCameraShot(time: number): CameraShot {
  for (let i = CAMERA_SHOTS.length - 1; i >= 0; i--) {
    const shot = CAMERA_SHOTS[i];
    if (shot && time >= shot.start) return shot;
  }
  return CAMERA_SHOTS[0] as CameraShot;
}

export interface IntroState {
  phase: IntroPhase;
  progress: number;
  elapsed: number;
  cameraShot: CameraShot;
  isReducedMotion: boolean;
  performanceProfile: "high" | "medium" | "low";
}

export function createInitialState(isReducedMotion: boolean): IntroState {
  return {
    phase: "VOID",
    progress: 0,
    elapsed: 0,
    cameraShot: CAMERA_SHOTS[0] as CameraShot,
    isReducedMotion,
    performanceProfile: detectPerformanceProfile(),
  };
}

export function detectPerformanceProfile(): "high" | "medium" | "low" {
  if (typeof navigator === "undefined") return "medium";

  const connection = (navigator as unknown as Record<string, unknown>)["connection"] as
    { effectiveType?: string; saveData?: boolean } | undefined;

  if (connection?.saveData) return "low";
  if (connection?.effectiveType === "2g" || connection?.effectiveType === "slow-2g") return "low";

  const memory = (navigator as unknown as Record<string, unknown>)["deviceMemory"] as
    number | undefined;
  if (memory && memory < 4) return "low";
  if (memory && memory < 8) return "medium";

  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores <= 2) return "low";
  if (cores <= 4) return "medium";

  return "high";
}

export function getPerformanceLimits(profile: "high" | "medium" | "low") {
  switch (profile) {
    case "high":
      return {
        starfield2D: 4000,
        starfield3D: 15000,
        cometParticles: 500,
        bloom: true,
        fog: true,
        hummingbirdDetail: "full" as const,
        pixelRatio: 2,
      };
    case "medium":
      return {
        starfield2D: 2000,
        starfield3D: 6000,
        cometParticles: 300,
        bloom: true,
        fog: true,
        hummingbirdDetail: "simplified" as const,
        pixelRatio: 1.5,
      };
    case "low":
      return {
        starfield2D: 800,
        starfield3D: 1000,
        cometParticles: 100,
        bloom: false,
        fog: false,
        hummingbirdDetail: "sprite" as const,
        pixelRatio: 1,
      };
  }
}
